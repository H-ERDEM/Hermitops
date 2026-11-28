import type { IncomingMessage, ServerResponse } from "node:http";
import type { Coordinator } from "../coordinator.ts";
import { DagError } from "../queue/dag.ts";
import { jobOptionsFrom, type JobPayments } from "./payments.ts";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { networkInterfaces } from "node:os";
import { REPO_ROOT } from "../config.ts";
import type { DemoBuyer } from "./demo-buyer.ts";
import type { PayoutService } from "../payouts.ts";
import { serveStatic } from "./static.ts";
import type { AgentPlanner } from "../agent/planner.ts";

const EXAMPLES_DIR = join(REPO_ROOT, "shared", "examples");

/** Demo paneli: alıcı yalnızca aynı makineden (Mac'in kendisinden) çağrılabilir. */
function isLoopback(req: IncomingMessage): boolean {
  const a = req.socket.remoteAddress ?? "";
  return a === "127.0.0.1" || a === "::1" || a === "::ffff:127.0.0.1";
}

/**
 * Tarayıcıdan gelen siteler-arası (drive-by/CSRF) istek mi? `isLoopback` tek başına yetmez:
 * kullanıcının tarayıcısında açtığı kötü niyetli bir sayfa da 127.0.0.1'e bağlanır, yani
 * loopback'ten görünür. Sec-Fetch-Site (tarayıcı denetimli, taklit edilemez) ve Origin ile
 * başka bir kaynaktan tetiklenen istekleri eleriz. Tarayıcı olmayan istemciler (curl, CLI,
 * node fetch) bu başlıkları göndermez ve geçer.
 */
function crossSiteBrowserRequest(req: IncomingMessage): boolean {
  const site = req.headers["sec-fetch-site"];
  if (typeof site === "string") return site !== "same-origin" && site !== "none";
  const origin = req.headers["origin"];
  if (typeof origin === "string" && origin.length > 0) {
    try {
      return new URL(origin).host !== (req.headers["host"] ?? "");
    } catch {
      return true;
    }
  }
  return false;
}

/** Para harcayan ve gizli (alıcı anahtarı, LLM, görev metni) uçlar için güven kontrolü. */
function trustedLocalCaller(req: IncomingMessage): boolean {
  return isLoopback(req) && !crossSiteBrowserRequest(req);
}

const MAX_BODY = 1024 * 1024;

function send(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "content-type, payment-signature, x-payment",
    "access-control-expose-headers": "payment-required, payment-response",
    ...headers,
  });
  res.end(JSON.stringify(body));
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new Error("gövde çok büyük"));
        req.destroy();
      } else chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

/**
 * HTTP API.
 *   GET  /health
 *   GET  /cbom, /cbom.json   kriptografik envanter (CycloneDX CBOM; kaynak: Rust, src/cbom.rs)
 *   POST /quote       gövde: DAG v0  → 200 { quote, payment? }  (iş oluşturmaz, ödeme istemez)
 *   POST /jobs        gövde: DAG v0  → 201 { jobId, ... }
 *                     isteğe bağlı ?scheduler=fifo|fastest|reputation&verifier=fixed2|fixed3|adaptive|accept_first
 *                     Ödeme açıksa (payments.ts) x402 ile üst sınır ödenir: ödemesiz istek 402.
 *   GET  /jobs/:id
 *   GET  /workers
 *   GET  /modules     { bundleHash, modules: [{ name, hash, url }] }  (ajan ve istemciler için)
 *   GET  /, /*.html, /*.js, /pkg/*   gönüllü sayfası ve WASM (static.ts)
 * Demo paneli (ara demo):
 *   GET  /panel                 panel.html
 *   GET  /examples, /examples/:ad   shared/examples altındaki örnek DAG'ler
 *   GET  /events?since=<id>     koordinatör olay kaydı (log tablosu), en fazla 200 satır
 *   GET  /demo/info             ödeme ve alıcı bilgisi
 *   POST /demo/buy?verifier=&scheduler=&maxUsdc=   gövde: DAG v0; alıcı x402 ile öder (yalnızca aynı makineden)
 * Ajan ve graf kontrol merkezi (hackathon):
 *   GET  /kontrol               kontrol.html
 *   GET  /jobs/:id/replicas     işin tüm kopyaları (geçmiş atamalar, sınama işleri)
 *   GET  /agent/info            { llm, buyerAvailable }
 *   POST /agent/plan            gövde: { prompt, maxUsdc, scheduler?, verifier? } → plan (DAG + teklif), ödeme yok
 *   GET  /agent/plans/:id       kayıtlı plan
 *   POST /agent/approve         gövde: { planId } → demo alıcısıyla x402 ödemesi, source=agent
 *   /agent/plan ve /agent/approve yalnızca aynı makineden (LLM maliyeti ve alıcı anahtarı).
 */
export function httpHandler(coord: Coordinator, payments: JobPayments | null = null, demo: { buyer: DemoBuyer | null; listensOnAll?: boolean; payouts?: PayoutService | null; agent?: AgentPlanner | null } = { buyer: null }) {
  return async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    try {
      if (req.method === "OPTIONS") return send(res, 204, null);
      if (req.method === "GET" && url.pathname === "/health") return send(res, 200, { ok: true });
      if (req.method === "GET" && (url.pathname === "/cbom" || url.pathname === "/cbom.json")) {
        // Kriptografik envanter (CycloneDX CBOM). Kaynak Rust'ta üretilir: cargo run --bin cbom -- --out docs/cbom.json
        try {
          return send(res, 200, JSON.parse(await readFile(join(REPO_ROOT, "docs", "cbom.json"), "utf8")));
        } catch {
          return send(res, 404, { error: "cbom.json yok; üret: npm run build:cbom" });
        }
      }
      if (req.method === "GET" && url.pathname === "/workers") return send(res, 200, coord.listWorkers());
      if (req.method === "GET" && url.pathname === "/panel" && (await serveStatic("/panel.html", res))) return;
      if (req.method === "GET" && url.pathname === "/kontrol" && (await serveStatic("/kontrol.html", res))) return;
      const rep = url.pathname.match(/^\/jobs\/([A-Za-z0-9_-]+)\/replicas$/);
      if (req.method === "GET" && rep) {
        const rows = coord.jobReplicas(rep[1]);
        return rows ? send(res, 200, rows) : send(res, 404, { error: "iş bulunamadı" });
      }
      if (url.pathname.startsWith("/agent/")) {
        const agent = demo.agent;
        if (!agent) return send(res, 409, { error: "ajan kapalı" });
        if (req.method === "GET" && url.pathname === "/agent/info") {
          return send(res, 200, { llm: agent.usesLlm, buyerAvailable: !!demo.buyer && isLoopback(req), local: isLoopback(req) });
        }
        const pm = url.pathname.match(/^\/agent\/plans\/([A-Za-z0-9_-]+)$/);
        if (req.method === "GET" && pm) {
          // Plan, kullanıcının görev metnini içerir: yalnızca koordinatörün makinesinden okunur.
          if (!trustedLocalCaller(req)) return send(res, 403, { error: "plan yalnızca koordinatörün çalıştığı makineden okunabilir" });
          const plan = agent.get(pm[1]);
          return plan ? send(res, 200, plan) : send(res, 404, { error: "plan bulunamadı" });
        }
        if (req.method === "POST" && (url.pathname === "/agent/plan" || url.pathname === "/agent/approve")) {
          if (!trustedLocalCaller(req)) return send(res, 403, { error: "ajan yalnızca koordinatörün çalıştığı makineden kullanılabilir" });
          let body: Record<string, unknown>;
          try {
            body = JSON.parse(await readBody(req)) ?? {};
          } catch (e) {
            return send(res, 400, { error: e instanceof Error ? e.message : "geçersiz JSON" });
          }
          if (url.pathname === "/agent/plan") {
            try {
              const plan = await agent.plan(String(body.prompt ?? ""), Number(body.maxUsdc ?? 0.1), {
                scheduler: typeof body.scheduler === "string" ? body.scheduler : undefined,
                verifier: typeof body.verifier === "string" ? body.verifier : undefined,
              });
              return send(res, 200, plan);
            } catch (e) {
              if (e instanceof DagError) return send(res, 400, { error: e.message });
              throw e;
            }
          }
          const planId = String(body.planId ?? "");
          const existing = agent.get(planId);
          if (!existing) return send(res, 404, { error: "plan bulunamadı" });
          if (!existing.withinBudget) return send(res, 409, { error: `üst sınır ${existing.quote.cap} USDC bütçeyi (${existing.maxUsdc} USDC) aşıyor` });
          if (!demo.buyer && payments) return send(res, 409, { error: "sunucu alıcısı kapalı; tarayıcıdan Phantom ile ödeyin" });
          // Kontrol ile işaretleme arasında await yok: eşzamanlı ikinci onay burada reddedilir.
          const plan = agent.claim(planId);
          if (plan === "missing") return send(res, 404, { error: "plan bulunamadı" });
          if (plan === "busy") return send(res, 409, { error: "plan zaten onaylandı ya da ödemesi sürüyor", jobId: existing.jobId ?? null });
          try {
            if (!demo.buyer) {
              // Ödeme kapalıysa (PAYMENTS yok) iş doğrudan gönderilir: geliştirme ve demo provası için.
              const { jobId } = coord.submitJob(plan.dag, { ...plan.options, source: "agent" });
              agent.markPaid(plan.planId, jobId);
              return send(res, 201, { ok: true, jobId, paid: false });
            }
            const q = new URLSearchParams({ ...plan.options, source: "agent" });
            const r = await demo.buyer.buy(plan.dag, `?${q}`, BigInt(plan.maxAtomic));
            if (r.ok && r.jobId) {
              agent.markPaid(plan.planId, r.jobId);
              return send(res, 201, r);
            }
            // Belirsiz sonuç (ödeme imzalandı ama kesinleşme doğrulanamadı): planı serbest BIRAKMA.
            // Yeniden onay 409 "busy" ile reddedilir; aksi halde zincirde kesinleşmiş olabilecek
            // ödeme ikinci kez yapılıp çift ücretlendirme olur. Kesin başarısızlıkta serbest bırak.
            if (r.uncertain) return send(res, 502, { ...r, error: r.error ?? "ödeme durumu belirsiz; tekrar denemeden önce zinciri kontrol edin" });
            agent.release(plan.planId);
            return send(res, r.status, r);
          } catch (e) {
            // İstisna = belirsiz sonuç: planı kilitli bırakıp çift ödemeyi önlüyoruz.
            coord.db.log("error", "agent_approve_uncertain", { planId: plan.planId, message: String(e) });
            return send(res, 502, { ok: false, uncertain: true, error: "ödeme durumu belirsiz; tekrar denemeden önce zinciri kontrol edin" });
          }
        }
        return send(res, 404, { error: "bulunamadı" });
      }
      if (req.method === "GET" && url.pathname === "/examples") {
        const files = (await readdir(EXAMPLES_DIR)).filter((f) => f.endsWith(".json")).sort();
        const list = await Promise.all(files.map(async (f) => {
          const dag = JSON.parse(await readFile(join(EXAMPLES_DIR, f), "utf8")) as { jobId?: string; tasks: unknown[] };
          return { name: f.replace(/\.json$/, ""), jobId: dag.jobId ?? null, tasks: dag.tasks.length };
        }));
        return send(res, 200, list);
      }
      const ex = url.pathname.match(/^\/examples\/([A-Za-z0-9_-]+)$/);
      if (req.method === "GET" && ex) {
        try {
          return send(res, 200, JSON.parse(await readFile(join(EXAMPLES_DIR, `${ex[1]}.json`), "utf8")));
        } catch {
          return send(res, 404, { error: "örnek bulunamadı" });
        }
      }
      if (req.method === "GET" && url.pathname === "/events") {
        const since = Number(url.searchParams.get("since") ?? 0) || 0;
        const rows = coord.db.all("SELECT rowid AS id, t, level, event, detail FROM log WHERE rowid > ? ORDER BY rowid LIMIT 200", since);
        return send(res, 200, rows.map((r) => ({ ...r, detail: r.detail ? JSON.parse(String(r.detail)) : null })));
      }
      if (req.method === "GET" && url.pathname === "/demo/info") {
        // Telefonun açacağı adresler: koordinatör HOST=0.0.0.0 ile açıldıysa yerel ağ IPv4 adresleri.
        const port = req.socket.localPort;
        const lan = Object.values(networkInterfaces()).flat()
          .filter((i) => i && i.family === "IPv4" && !i.internal).map((i) => `http://${i!.address}:${port}/`);
        return send(res, 200, {
          payment: payments?.paymentInfo() ?? null, buyer: demo.buyer?.address ?? null, buyerAvailable: !!demo.buyer && isLoopback(req),
          volunteerUrls: demo.listensOnAll ? lan : [],
        });
      }
      if (req.method === "POST" && url.pathname === "/demo/buy") {
        if (!demo.buyer) return send(res, 409, { error: "demo alıcısı kapalı (PAYMENTS=1 ve BUYER_PRIVATE_KEY gerekli)" });
        if (!trustedLocalCaller(req)) return send(res, 403, { error: "demo alıcısı yalnızca koordinatörün çalıştığı makineden kullanılabilir" });
        let dag: unknown;
        try {
          dag = JSON.parse(await readBody(req));
        } catch (e) {
          return send(res, 400, { error: e instanceof Error ? e.message : "geçersiz JSON" });
        }
        const q = new URLSearchParams();
        for (const k of ["scheduler", "verifier"]) {
          const v = url.searchParams.get(k);
          if (v) q.set(k, v);
        }
        q.set("source", "panel");
        const maxUsdc = Number(url.searchParams.get("maxUsdc") ?? 1);
        if (!(maxUsdc > 0)) return send(res, 400, { error: "geçersiz bütçe" });
        const r = await demo.buyer.buy(dag, q.size ? `?${q}` : "", BigInt(Math.round(maxUsdc * 1e6)));
        return send(res, r.ok ? 201 : r.status, r);
      }
      if (req.method === "GET" && url.pathname === "/modules") {
        return send(res, 200, { bundleHash: coord.wasmHash, modules: coord.modules });
      }
      if (req.method === "POST" && (url.pathname === "/jobs" || url.pathname === "/quote")) {
        let dag: unknown;
        try {
          dag = JSON.parse(await readBody(req));
        } catch (e) {
          return send(res, 400, { error: e instanceof Error ? e.message : "geçersiz JSON" });
        }
        try {
          if (url.pathname === "/quote") {
            return send(res, 200, { quote: coord.quote(dag, jobOptionsFrom(url)), payment: payments?.paymentInfo() ?? null });
          }
          if (!payments) return send(res, 201, coord.submitJob(dag, jobOptionsFrom(url)));
          const r = await payments.submit(req, url, dag);
          if (r.kind === "respond") return send(res, r.status, r.body, r.headers);
          return send(res, 201, { jobId: r.jobId, quote: r.quote, payment: { transaction: r.transaction, payer: r.payer } }, r.headers);
        } catch (e) {
          if (e instanceof DagError) return send(res, 400, { error: e.message });
          throw e;
        }
      }
      const m = url.pathname.match(/^\/jobs\/([A-Za-z0-9_-]+)$/);
      if (req.method === "GET" && m) {
        const job = coord.getJob(m[1]);
        if (job?.payment && demo.payouts) Object.assign(job.payment, { payouts: demo.payouts.forJob(job.jobId) });
        return job ? send(res, 200, job) : send(res, 404, { error: "iş bulunamadı" });
      }
      if (req.method === "GET" && (await serveStatic(url.pathname, res))) return;
      send(res, 404, { error: "bulunamadı" });
    } catch (e) {
      coord.db.log("error", "http_error", { path: url.pathname, message: String(e) });
      send(res, 500, { error: "sunucu hatası" });
    }
  };
}
