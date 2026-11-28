/**
 * Ajan planlayıcısı (Hafta 11, hackathon) ve graf kontrol merkezinin uç noktaları.
 * LLM ağsızdır: sahte bir LlmFn verilir. Ödeme kapalıdır; /agent/approve işi doğrudan gönderir.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "../src/server.ts";
import type { Config } from "../src/config.ts";
import { readShared } from "../src/config.ts";
import { extractJson, rulePlan, sanitizeDag, LIMITS, type LlmFn } from "../src/agent/planner.ts";
import { startFakeWorker } from "./fake-worker.ts";

const FAST: Partial<Config> = { heartbeatMs: 100, missedHeartbeats: 2, taskTimeoutMs: 5000 };
type Server = Awaited<ReturnType<typeof createServer>>;

async function withServer(llm: LlmFn | null, fn: (s: Server) => Promise<void>) {
  const s = await createServer({ config: FAST, agentLlm: llm });
  try {
    await fn(s);
  } finally {
    await s.close();
  }
}

const post = (s: Server, path: string, body: unknown) =>
  fetch(`${s.url}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

test("kural planlayıcısı: '3 görsel + matris + özet' → 3 image_blur, 1 matmul, join", () => {
  const { dag } = rulePlan("3 görseli bulanıklaştır, bir matrisi çarp ve hepsini tek özette birleştir");
  const mods = dag.tasks.map((t) => t.module);
  assert.deepEqual(mods, ["image_blur", "image_blur", "image_blur", "matmul", "sha_chain"]);
  const join = dag.tasks.at(-1)!;
  assert.deepEqual(join.deps, ["img_1", "img_2", "img_3", "mm"]);
  assert.deepEqual(join.input.seed, { $ref: "img_1.output.hash" });
});

test("kural planlayıcısı: sayı yazıyla ('iki resim') ve anlaşılmayan görev → örnek hat", () => {
  assert.equal(rulePlan("iki resmi bulanıklaştır").dag.tasks.filter((t) => t.module === "image_blur").length, 2);
  const fallback = rulePlan("bana bir şiir yaz");
  assert.equal(fallback.dag.jobId, "ornek-goruntu-hatti");
  assert.match(fallback.explanation, /anlayamadım/);
});

test("kural planlayıcısı: görev sayısı sınırı aşılamaz", () => {
  const { dag } = rulePlan("500 görsel bulanıklaştır");
  assert.ok(dag.tasks.length <= LIMITS.tasks);
});

test("sanitizeDag girdileri kıstırır, $ref'e dokunmaz; extractJson kod bloğunu açar", () => {
  const dag = sanitizeDag({
    tasks: [
      { id: "a", module: "image_blur", input: { seed: 1, w: 99999, h: -3, passes: 50 } },
      { id: "b", module: "sha_chain", input: { seed: { $ref: "a.output.hash" }, iterations: 1e9 }, deps: ["a"] },
    ],
  });
  assert.deepEqual(dag.tasks[0].input, { seed: 1, w: LIMITS.wh, h: 1, passes: LIMITS.passes });
  assert.deepEqual(dag.tasks[1].input, { seed: { $ref: "a.output.hash" }, iterations: LIMITS.iterations });
  assert.deepEqual(extractJson('Tamam:\n```json\n{"x": 1}\n```'), { x: 1 });
  assert.throws(() => extractJson("JSON yok"));
});

test("POST /agent/plan: LLM'in DAG'ı doğrulanır, teklif ve bütçe kontrolü döner", () => {
  const llm: LlmFn = async () =>
    JSON.stringify({ explanation: "İki görev.", dag: { version: 0, jobId: "llm-plan", tasks: [
      { id: "m", module: "matmul", input: { seed: 3, n: 16 }, deps: [] },
      { id: "h", module: "sha_chain", input: { seed: { $ref: "m.output.hash" }, iterations: 10 }, deps: ["m"] },
    ] } });
  return withServer(llm, async (s) => {
    const info = await (await fetch(`${s.url}/agent/info`)).json();
    assert.equal(info.llm, true);
    const res = await post(s, "/agent/plan", { prompt: "matrisi çarp, özetle", maxUsdc: 1 });
    assert.equal(res.status, 200);
    const plan = await res.json();
    assert.equal(plan.planner, "llm");
    assert.equal(plan.dag.jobId, "llm-plan");
    assert.equal(plan.quote.tasks, 2);
    assert.equal(plan.withinBudget, true);
    assert.match(plan.explanation, /İki görev\./);
    const again = await (await fetch(`${s.url}/agent/plans/${plan.planId}`)).json();
    assert.equal(again.planId, plan.planId);
  });
});

test("LLM önce geçersiz DAG verirse hatayla bir kez düzeltme istenir; iki kez bozuksa kurallara düşülür", async () => {
  const prompts: string[] = [];
  const fixesSecond: LlmFn = async (_sys, user) => {
    prompts.push(user);
    if (prompts.length === 1) return JSON.stringify({ dag: { version: 0, tasks: [{ id: "a", module: "sha_chain", input: { seed: "x" }, deps: ["yok"] }] } });
    return JSON.stringify({ dag: { version: 0, tasks: [{ id: "a", module: "sha_chain", input: { seed: "x", iterations: 5 }, deps: [] }] } });
  };
  await withServer(fixesSecond, async (s) => {
    const plan = await (await post(s, "/agent/plan", { prompt: "özetle", maxUsdc: 1 })).json();
    assert.equal(plan.planner, "llm");
    assert.match(prompts[1], /geçersizdi: .*bilinmeyen bağımlılık/);
  });
  await withServer(async () => "üzgünüm, JSON veremem", async (s) => {
    const plan = await (await post(s, "/agent/plan", { prompt: "iki görsel bulanıklaştır", maxUsdc: 1 })).json();
    assert.equal(plan.planner, "rules");
    assert.match(plan.fallbackReason, /LLM geçerli bir DAG üretemedi/);
    assert.equal(plan.dag.tasks.length, 3);
  });
});

test("bütçeyi aşan plan onaylanmaz; bütçe içindeki plan onaylanınca iş source=agent ile çalışır, replicas uç noktası atamaları gösterir", () =>
  withServer(null, async (s) => {
    const tight = await (await post(s, "/agent/plan", { prompt: "iki görsel bulanıklaştır", maxUsdc: 0.001 })).json();
    assert.equal(tight.withinBudget, false);
    assert.match(tight.explanation, /aşıyor/);
    assert.equal((await post(s, "/agent/approve", { planId: tight.planId })).status, 409);

    const plan = await (await post(s, "/agent/plan", { prompt: "bir matris çarp", maxUsdc: 1, verifier: "fixed2" })).json();
    assert.equal(plan.withinBudget, true);
    const w1 = startFakeWorker(s.wsUrl), w2 = startFakeWorker(s.wsUrl);
    try {
      const ok = await post(s, "/agent/approve", { planId: plan.planId });
      assert.equal(ok.status, 201);
      const { jobId } = await ok.json();
      assert.equal((await post(s, "/agent/approve", { planId: plan.planId })).status, 409, "ikinci onay reddedilir");
      let job: { status: string; source: string };
      const end = Date.now() + 5000;
      do {
        await new Promise((r) => setTimeout(r, 30));
        job = await (await fetch(`${s.url}/jobs/${jobId}`)).json();
      } while (job.status === "RUNNING" && Date.now() < end);
      assert.equal(job.status, "COMPLETED");
      assert.equal(job.source, "agent");
      const reps = (await (await fetch(`${s.url}/jobs/${jobId}/replicas`)).json()) as { task: string; workerId: string; state: string; spot: boolean }[];
      const real = reps.filter((r) => !r.spot);
      assert.equal(real.length, 2, "fixed2: iki kopya");
      assert.ok(real.every((r) => r.task === "mm" && r.workerId), JSON.stringify(reps));
      assert.equal((await fetch(`${s.url}/jobs/job_yok/replicas`)).status, 404);
    } finally {
      w1.close();
      w2.close();
    }
  }));

test("ajan uç noktaları: boş görev 400, bilinmeyen plan 404, kontrol sayfası sunulur", () =>
  withServer(null, async (s) => {
    assert.equal((await post(s, "/agent/plan", { prompt: "  ", maxUsdc: 1 })).status, 400);
    assert.equal((await post(s, "/agent/plan", { prompt: "özet", maxUsdc: -1 })).status, 400);
    assert.equal((await post(s, "/agent/approve", { planId: "plan_yok" })).status, 404);
    assert.equal((await fetch(`${s.url}/agent/plans/plan_yok`)).status, 404);
    const page = await fetch(`${s.url}/kontrol`);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /Kontrol Merkezi/);
    assert.ok(readShared("examples/image-pipeline.json"));
  }));
