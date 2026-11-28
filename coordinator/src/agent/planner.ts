/**
 * Yapay zekâ ajanı (Hafta 11, hackathon): doğal dilde verilen görevi DAG v0 iş akışına çevirir,
 * fiyat teklifini alır ve bütçeyle karşılaştırır. Ödeme ayrı adımdır (POST /agent/approve ya da
 * tarayıcıda Phantom ile); planlayıcı hiçbir zaman kendisi ödeme yapmaz.
 *
 * İki planlayıcı vardır:
 *   - LLM: ANTHROPIC_API_KEY tanımlıysa Claude'a modül listesi ve örnek DAG ile sorulur. Üretilen DAG
 *     şemayla doğrulanır; geçersizse hata mesajıyla bir kez düzeltme istenir.
 *   - Kurallar: anahtar yoksa ya da LLM iki kez geçersiz DAG üretirse anahtar kelimelerden DAG kurulur.
 * Girdi sınırları her iki yolda da kıstırılır (sanitize), böylece LLM aşırı büyük bir iş öneremez.
 */
import { randomUUID } from "node:crypto";
import type { Coordinator, JobOptions, Quote } from "../coordinator.ts";
import { DagError, type Dag, type DagTask } from "../queue/dag.ts";
import { readShared } from "../config.ts";

/** system + user → modelin ham metin yanıtı. Testlerde sahte bir fonksiyon verilir. */
export type LlmFn = (system: string, user: string) => Promise<string>;

export interface Plan {
  planId: string;
  prompt: string;
  maxUsdc: number;
  maxAtomic: number;
  dag: Dag;
  quote: Quote;
  withinBudget: boolean;
  explanation: string;
  planner: "llm" | "rules";
  /** LLM denendi ama geçersiz DAG üretti ya da hata verdi: neden kurallara düşüldü. */
  fallbackReason?: string;
  options: { scheduler: string; verifier: string };
  createdAt: number;
  /** Onaylanıp ödendiyse işin kimliği. */
  jobId?: string;
}

export const LIMITS = { tasks: 24, wh: 256, passes: 5, n: 128, iterations: 200_000 } as const;
const DEFAULT_OPTIONS = { scheduler: "reputation", verifier: "adaptive" };
const MAX_PLANS = 200;

export class AgentPlanner {
  private readonly plans = new Map<string, Plan>();

  private readonly coord: Coordinator;
  private readonly llm: LlmFn | null;

  constructor(coord: Coordinator, llm: LlmFn | null = null) {
    this.coord = coord;
    this.llm = llm;
  }

  get usesLlm(): boolean {
    return this.llm !== null;
  }

  get(planId: string): Plan | undefined {
    return this.plans.get(planId);
  }

  markPaid(planId: string, jobId: string): void {
    const p = this.plans.get(planId);
    if (p) p.jobId = jobId;
  }

  async plan(prompt: string, maxUsdc: number, opts: { scheduler?: string; verifier?: string } = {}): Promise<Plan> {
    const text = String(prompt ?? "").trim();
    if (!text) throw new DagError("görev metni boş");
    if (text.length > 2000) throw new DagError("görev metni çok uzun (en fazla 2000 karakter)");
    if (!(maxUsdc > 0)) throw new DagError("geçersiz bütçe");
    const options = { scheduler: opts.scheduler ?? DEFAULT_OPTIONS.scheduler, verifier: opts.verifier ?? DEFAULT_OPTIONS.verifier };
    const jobOpts: JobOptions = { ...options, source: "agent" };

    let dag: Dag | null = null;
    let explanation = "";
    let planner: Plan["planner"] = "rules";
    let fallbackReason: string | undefined;
    if (this.llm) {
      try {
        const r = await this.llmPlan(text, jobOpts);
        dag = r.dag;
        explanation = r.explanation;
        planner = "llm";
      } catch (e) {
        fallbackReason = e instanceof Error ? e.message : String(e);
      }
    }
    if (!dag) {
      const r = rulePlan(text);
      dag = r.dag;
      explanation = r.explanation;
    }
    const quote = this.coord.quote(dag, jobOpts); // şema + anlamsal doğrulama
    const maxAtomic = Math.round(maxUsdc * 1e6);
    const withinBudget = quote.capAtomic <= maxAtomic;
    const tr = (v: string | number) => String(v).replace(".", ",");
    const budgetNote = withinBudget
      ? `Üst sınır ${tr(quote.cap)} USDC, bütçenin (${tr(maxUsdc)} USDC) içinde. Gerçekleşen maliyet genelde çok daha düşüktür; fark iş bitince iade edilir.`
      : `Üst sınır ${tr(quote.cap)} USDC, bütçeyi (${tr(maxUsdc)} USDC) aşıyor; bu bütçeyle ödeme yapmam. Bütçeyi en az ${tr(quote.cap)} USDC yap ya da görevi küçült.`;
    const plan: Plan = {
      planId: `plan_${randomUUID().slice(0, 8)}`,
      prompt: text, maxUsdc, maxAtomic, dag, quote, withinBudget,
      explanation: [explanation, budgetNote].filter(Boolean).join(" "),
      planner, fallbackReason, options, createdAt: Date.now(),
    };
    this.plans.set(plan.planId, plan);
    if (this.plans.size > MAX_PLANS) this.plans.delete(this.plans.keys().next().value!);
    this.coord.db.log("info", "agent_planned", {
      planId: plan.planId, planner, tasks: dag.tasks.length, capAtomic: quote.capAtomic, maxAtomic, withinBudget,
      ...(fallbackReason ? { fallbackReason } : {}),
    });
    return plan;
  }

  private async llmPlan(prompt: string, jobOpts: JobOptions): Promise<{ dag: Dag; explanation: string }> {
    const system = systemPrompt();
    let user = `Görev: ${prompt}`;
    let lastError = "";
    for (let attempt = 0; attempt < 2; attempt++) {
      const raw = await this.llm!(system, user);
      try {
        const parsed = extractJson(raw) as { dag?: unknown; explanation?: unknown };
        const dag = sanitizeDag(parsed.dag ?? parsed);
        this.coord.quote(dag, jobOpts); // geçersizse DagError
        return { dag, explanation: typeof parsed.explanation === "string" ? parsed.explanation.slice(0, 500) : "" };
      } catch (e) {
        lastError = e instanceof Error ? e.message : String(e);
        user = `Görev: ${prompt}\n\nÖnceki yanıtın geçersizdi: ${lastError}\nYalnızca düzeltilmiş JSON'u ver.`;
      }
    }
    throw new DagError(`LLM geçerli bir DAG üretemedi: ${lastError}`);
  }
}

function systemPrompt(): string {
  const example = readShared("examples/image-pipeline.json");
  return [
    "Sen bir gönüllü hesaplama platformunun iş akışı planlayıcısısın. Kullanıcının görevini DAG v0 JSON'una çevirirsin.",
    "Modüller (tamsayı tabanlı, belirlenimci WASM):",
    `- image_blur {seed:int, w:int ≤${LIMITS.wh}, h:int ≤${LIMITS.wh}, passes:int ≤${LIMITS.passes}}: seed'den üretilen görüntüye 3×3 kutu bulanıklaştırma. Çıktı: {hash}`,
    `- matmul {seed:int, n:int ≤${LIMITS.n}}: seed'den üretilen iki n×n tamsayı matrisin çarpımı. Çıktı: {hash}`,
    `- sha_chain {seed:string, iterations:int ≤${LIMITS.iterations}}: SHA-256 hash zinciri; özet/birleştirme için kullanılır. Çıktı: {hash}`,
    'Bir görevin çıktısı başka görevin girdisine {"$ref": "<görevId>.output.hash"} ile bağlanır; o görev deps listesinde olmalıdır.',
    `En fazla ${LIMITS.tasks} görev. Görev kimlikleri kısa, [a-z0-9_] olsun. Bütçe ayrıca kontrol edilir, sen fiyat hesaplama.`,
    'Yanıtın YALNIZCA şu biçimde tek bir JSON nesnesi olsun: {"explanation": "<Türkçe, tek cümle>", "dag": {"version": 0, "jobId": "...", "tasks": [...]}}',
    `Örnek DAG:\n${JSON.stringify(example)}`,
  ].join("\n");
}

/** Yanıttaki ilk JSON nesnesini çıkarır (```json bloğu ya da düz metin). */
export function extractJson(raw: string): unknown {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  const text = fenced ? fenced[1] : raw;
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) throw new DagError("yanıtta JSON yok");
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch (e) {
    throw new DagError(`JSON ayrıştırılamadı: ${e instanceof Error ? e.message : e}`);
  }
}

const clampInt = (v: unknown, lo: number, hi: number, dflt: number): number => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : dflt;
};

/** LLM ya da kurallarla üretilen DAG'ı sınırlar içine çeker; yapıyı değiştirmez (doğrulama sonra). */
export function sanitizeDag(raw: unknown): Dag {
  if (!raw || typeof raw !== "object") throw new DagError("dag nesnesi yok");
  const d = raw as { jobId?: unknown; tasks?: unknown };
  if (!Array.isArray(d.tasks) || d.tasks.length === 0) throw new DagError("tasks boş");
  if (d.tasks.length > LIMITS.tasks) throw new DagError(`en fazla ${LIMITS.tasks} görev`);
  const tasks: DagTask[] = d.tasks.map((t: Record<string, unknown>) => {
    const input = { ...((t.input as Record<string, unknown>) ?? {}) };
    const isRef = (v: unknown) => !!v && typeof v === "object";
    switch (t.module) {
      case "image_blur":
        input.w = clampInt(input.w, 1, LIMITS.wh, 64);
        input.h = clampInt(input.h, 1, LIMITS.wh, 48);
        input.passes = clampInt(input.passes, 1, LIMITS.passes, 2);
        if (!isRef(input.seed)) input.seed = clampInt(input.seed, 0, 2 ** 31 - 1, 1);
        break;
      case "matmul":
        input.n = clampInt(input.n, 1, LIMITS.n, 32);
        if (!isRef(input.seed)) input.seed = clampInt(input.seed, 0, 2 ** 31 - 1, 1);
        break;
      case "sha_chain":
        input.iterations = clampInt(input.iterations, 1, LIMITS.iterations, 1000);
        if (!isRef(input.seed)) input.seed = String(input.seed ?? "seed");
        break;
    }
    const out: DagTask = { id: String(t.id), module: String(t.module), input, deps: Array.isArray(t.deps) ? t.deps.map(String) : [] };
    return out;
  });
  const jobId = typeof d.jobId === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(d.jobId) ? d.jobId : `ajan-${randomUUID().slice(0, 6)}`;
  return { version: 0, jobId, tasks };
}

const NUM_WORDS: Record<string, number> = {
  bir: 1, iki: 2, üç: 3, dört: 4, beş: 5, altı: 6, yedi: 7, sekiz: 8, dokuz: 9, on: 10,
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
};

/** "20 görsel", "iki resim", "3 images" gibi ifadelerden sayıyı bulur. */
function countBefore(text: string, nouns: string): number | null {
  const re = new RegExp(`(\\d+|${Object.keys(NUM_WORDS).join("|")})\\s+(?:adet\\s+)?(?:${nouns})`, "i");
  const m = text.match(re);
  if (!m) return null;
  const n = /^\d+$/.test(m[1]) ? Number(m[1]) : NUM_WORDS[m[1].toLowerCase()];
  return n > 0 ? n : null;
}

/** Anahtar kelime tabanlı yedek planlayıcı (LLM yokken demo da çalışsın diye). */
export function rulePlan(prompt: string): { dag: Dag; explanation: string } {
  const t = prompt.toLocaleLowerCase("tr");
  const wantsImages = /(görsel|gorsel|resim|fotoğraf|foto|image|bulanık|bulanik|blur)/.test(t);
  const wantsMatrix = /(matris|matrix|matmul|çarp)/.test(t);
  const wantsHash = /(hash|özet|ozet|sha|birleştir|birlestir|zincir)/.test(t);
  const tasks: DagTask[] = [];
  const parts: string[] = [];
  const room = LIMITS.tasks - 1; // birleştirme görevine yer bırak
  if (wantsImages) {
    const n = Math.min(countBefore(t, "görsel|gorsel|resim|fotoğraf|foto|image") ?? 2, wantsMatrix ? room - 1 : room);
    for (let i = 0; i < n; i++) {
      tasks.push({ id: `img_${i + 1}`, module: "image_blur", input: { seed: 42 + i, w: 64, h: 48, passes: 2 }, deps: [] });
    }
    parts.push(`${n} görsel bulanıklaştırma`);
  }
  if (wantsMatrix) {
    const n = Math.min(countBefore(t, "matris|matrix") ?? 1, room - tasks.length);
    for (let i = 0; i < n; i++) tasks.push({ id: n === 1 ? "mm" : `mm_${i + 1}`, module: "matmul", input: { seed: 7 + i, n: 64 }, deps: [] });
    parts.push(n === 1 ? "bir matris çarpımı" : `${n} matris çarpımı`);
  }
  if (tasks.length === 0 && !wantsHash) {
    const dag = readShared<Dag>("examples/image-pipeline.json");
    return { dag, explanation: "Görevi tam anlayamadım; örnek görüntü hattını (7 görev) önerdim." };
  }
  if (tasks.length === 0) {
    tasks.push({ id: "h1", module: "sha_chain", input: { seed: prompt.slice(0, 64), iterations: 10_000 }, deps: [] });
    parts.push("bir SHA-256 zinciri");
  } else if (tasks.length > 1 || wantsHash) {
    const deps = tasks.map((x) => x.id);
    tasks.push({ id: "join", module: "sha_chain", input: { seed: { $ref: `${deps[0]}.output.hash` }, iterations: 1 }, deps });
    parts.push("sonuçları tek özette birleştirme");
  }
  return {
    dag: { version: 0, jobId: `ajan-${randomUUID().slice(0, 6)}`, tasks },
    explanation: `Kurallarla ${tasks.length} görevlik bir iş akışı kurdum: ${parts.join(", ")}.`,
  };
}

/** ANTHROPIC_API_KEY ortamda varsa Claude Messages API ile LLM fonksiyonu; yoksa null. */
export function anthropicLlmFromEnv(env: NodeJS.ProcessEnv = process.env): LlmFn | null {
  const key = env.ANTHROPIC_API_KEY;
  if (!key) return null;
  const model = env.AGENT_MODEL ?? "claude-sonnet-5-5";
  return async (system, user) => {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model, max_tokens: 2048, system, messages: [{ role: "user", content: user }] }),
      signal: AbortSignal.timeout(45_000),
    });
    if (!res.ok) throw new Error(`LLM HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const body = (await res.json()) as { content?: { type: string; text?: string }[] };
    return (body.content ?? []).filter((c) => c.type === "text").map((c) => c.text).join("");
  };
}
