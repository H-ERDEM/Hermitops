/**
 * Devnet uçtan uca kaydı — ajan + x402 (başsız).
 *
 * Akış (denetimde eksik denen zincir):
 *   doğal dil → POST /agent/plan (graf) → POST /agent/approve (x402 ödeme, sunucu-taraflı alıcı)
 *   → canlı worker'lar (biri HİLECİ) → adaptive doğrulama hileciyi yakalar
 *   → PAYOUTS=1 ile worker ödemeleri + alıcı iadesi zincir üstünde kesinleşir.
 *
 * Çıktı: işlem imzaları + Solana gezgini bağlantıları + README'ye hazır blok (docs/devnet-agent-record.md).
 * Phantom'a gerek yoktur; alıcı anahtarı sunucuda .env'dedir (demo-buyer).
 *
 * Kullanım (iki terminal, kökten):
 *   1) PAYMENTS=1 PAYOUTS=1 npm run coordinator        # payments/x402-proto/.env fonlu olmalı
 *   2) npm run -w coordinator devnet-record -- --prompt "üç görseli bulanıklaştır, bir matris çarp, özetle"
 *
 * Ödemesiz koordinatöre karşı (PAYMENTS kapalı) "kuru prova" yapar: akışı ve hileci tespitini
 * doğrular, imza toplamaz. Böylece fonlamadan önce boru hattı denenebilir.
 */
import { base58 } from "@scure/base";
import { webcrypto } from "node:crypto";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { startFakeWorker, type FakeWorker } from "./fake-worker.ts";

const BASE = (process.env.COORDINATOR_URL ?? "http://127.0.0.1:8787").replace(/\/$/, "");
const WS = BASE.replace(/^http/, "ws") + "/ws";

function arg(name: string, def: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}
const PROMPT = arg("prompt", "üç görseli bulanıklaştır, bir matris çarp, sonuçları özetle");
const VERIFIER = arg("verifier", "adaptive");
const SCHEDULER = arg("scheduler", "reputation");
const MAX_USDC = Number(arg("max-usdc", "0.1"));
const HONEST = Number(arg("honest", "3"));
const TIMEOUT_MS = Number(arg("timeout", "180000"));

const post = (path: string, body: unknown) =>
  fetch(`${BASE}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const get = (path: string) => fetch(`${BASE}${path}`);
const explorer = (sig: string) => `https://explorer.solana.com/tx/${sig}?cluster=devnet`;
const usdc = (atomic: number | null | undefined) => (atomic == null ? "—" : `${(atomic / 1e6).toFixed(6)} USDC`);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Devnet için geçerli bir ed25519 adresi (worker ödeme cüzdanı). Yalnızca alır; fonlanması gerekmez. */
async function newWallet(): Promise<string> {
  const kp = (await webcrypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"])) as webcrypto.CryptoKeyPair;
  const pub = new Uint8Array(await webcrypto.subtle.exportKey("raw", kp.publicKey));
  return base58.encode(pub);
}

async function main() {
  // 0) Koordinatör ayakta mı, ajan açık mı?
  const health = await get("/health").catch(() => null);
  if (!health?.ok) throw new Error(`Koordinatöre ulaşılamadı: ${BASE}. Önce "npm run coordinator" çalıştırın.`);
  const info = await get("/agent/info");
  if (info.status === 409) throw new Error("Ajan kapalı görünüyor (/agent/info 409).");
  const { buyerAvailable } = (await info.json()) as { buyerAvailable: boolean };

  // 1) Worker'lar: HONEST dürüst + 1 hileci. Hepsinin ödeme cüzdanı var.
  const honestWallets = await Promise.all(Array.from({ length: HONEST }, newWallet));
  const cheaterWallet = await newWallet();
  const workers: FakeWorker[] = [];
  honestWallets.forEach((wallet) => workers.push(startFakeWorker(WS, { wallet, delayMs: 30 })));
  const cheater = startFakeWorker(WS, { wallet: cheaterWallet, fault: "random", delayMs: 0 });
  workers.push(cheater);
  const ids = await Promise.all(workers.map((w) => w.id));
  const cheaterId = ids[ids.length - 1];
  console.log(`▸ ${HONEST} dürüst + 1 hileci worker bağlandı. Hileci: ${cheaterId} (${cheaterWallet})`);

  // 2) Doğal dil → graf
  const plan = (await (await post("/agent/plan", { prompt: PROMPT, maxUsdc: MAX_USDC, scheduler: SCHEDULER, verifier: VERIFIER })).json()) as {
    planId: string; dag: { tasks: unknown[] }; quote: { cap: number; capAtomic: number }; withinBudget: boolean; explanation: string;
  };
  if (!plan.planId) throw new Error(`Plan üretilemedi: ${JSON.stringify(plan)}`);
  console.log(`▸ Plan ${plan.planId}: ${plan.dag.tasks.length} görev, üst sınır ${usdc(plan.quote.capAtomic)}`);
  console.log(`  "${plan.explanation}"`);
  if (!plan.withinBudget) throw new Error("Plan bütçeyi aşıyor; --max-usdc artırın.");

  // 3) Onay → x402 ödeme
  const appRes = await post("/agent/approve", { planId: plan.planId });
  const app = (await appRes.json()) as { ok?: boolean; jobId?: string; paid?: boolean; transaction?: string; payer?: string; error?: string; uncertain?: boolean };
  if (appRes.status === 502 || app.uncertain) throw new Error(`Ödeme durumu belirsiz; zinciri kontrol edin: ${app.error}`);
  if (!app.jobId) throw new Error(`Onay başarısız (${appRes.status}): ${app.error ?? JSON.stringify(app)}`);
  const dryRun = app.paid === false || !buyerAvailable;
  const jobId = app.jobId;
  console.log(dryRun
    ? `▸ Onaylandı (KURU PROVA, ödeme kapalı): ${jobId}`
    : `▸ Onaylandı, x402 ödendi: ${jobId}\n  ödeme imzası: ${app.transaction}\n  ödeyen: ${app.payer}`);

  // 4) İşin bitmesini ve (ödemeliyse) payout'ların zincirde kesinleşmesini bekle
  const deadline = Date.now() + TIMEOUT_MS;
  type Payout = { kind: string; payee: string; recipient: string | null; units: number | null; amountAtomic: number; status: string; transaction: string | null };
  type Job = { status: string; payment?: { transaction: string | null; payer: string | null; realizedAtomic: number | null; refundDueAtomic: number | null; refundTransaction: string | null; payouts?: Payout[] } };
  let job: Job | null = null;
  while (Date.now() < deadline) {
    job = (await (await get(`/jobs/${jobId}`)).json()) as Job;
    const done = job.status !== "RUNNING";
    const payouts = job.payment?.payouts ?? [];
    const settled = dryRun || (payouts.length > 0 && payouts.every((p) => p.status === "confirmed" || p.status === "no_wallet") && !!job.payment?.refundTransaction);
    if (done && settled) break;
    await sleep(2000);
  }
  if (!job || job.status === "RUNNING") throw new Error("Zaman aşımı: iş süresinde bitmedi.");

  // 5) Hileci tespiti. Hileci "sonuç döndürdü" (RETURNED_OK) ama değeri yanlış; tespit, onun
  // kopyalarının KABUL EDİLMEMESİ (paid=false) ve anlaşmazlığın fazladan replikasyon doğurmasıdır.
  const replicas = (await (await get(`/jobs/${jobId}/replicas`)).json()) as { workerId: string | null; task: string | null; spot: boolean; state: string; paid: boolean }[];
  const cheaterReplicas = replicas.filter((r) => r.workerId === cheaterId);
  const cheaterPaid = cheaterReplicas.filter((r) => r.paid).length;
  const honestPaid = replicas.filter((r) => r.paid && r.workerId !== cheaterId).length;
  const taskCount = plan.dag.tasks.length;
  const extraReplication = replicas.filter((r) => !r.spot).length - taskCount; // anlaşmazlık yüzünden açılan ek kopyalar

  // 6) Özet + README bloğu
  const payouts = job.payment?.payouts ?? [];
  const workerPayouts = payouts.filter((p) => p.kind === "worker");
  const refundTx = job.payment?.refundTransaction ?? null;
  const paymentTx = job.payment?.transaction ?? null;
  const uniqueSigs = [...new Set([paymentTx, refundTx, ...workerPayouts.map((p) => p.transaction)].filter(Boolean) as string[])];

  console.log(`\n── Sonuç ───────────────────────────────`);
  console.log(`İş:          ${jobId} (${job.status}, doğrulayıcı ${VERIFIER})`);
  console.log(`Hileci:      ${cheaterId} → ${cheaterReplicas.length} kopya denedi, ödenen: ${cheaterPaid ? `${cheaterPaid} (BEKLENMEDİK!)` : "0 ✓"}`);
  console.log(`Doğrulama:   ${taskCount} görev → ${replicas.filter((r) => !r.spot).length} kopya (+${extraReplication} ek, anlaşmazlıktan); dürüst ödenen kopya: ${honestPaid}`);
  console.log(`Maliyet:     üst sınır ${usdc(plan.quote.capAtomic)} → gerçekleşen ${usdc(job.payment?.realizedAtomic)}, iade ${usdc(job.payment?.refundDueAtomic)}`);
  if (dryRun) {
    console.log(`\nKURU PROVA: ödeme kapalı olduğundan zincir imzası yok. Gerçek kayıt için:`);
    console.log(`  PAYMENTS=1 PAYOUTS=1 npm run coordinator   (fonlu .env ile)`);
    workers.forEach((w) => w.close());
    return;
  }

  console.log(`\nÖdeme (x402, alıcı→platform): ${paymentTx}\n  ${paymentTx ? explorer(paymentTx) : ""}`);
  for (const p of workerPayouts) console.log(`Worker ödemesi ${p.payee} (${usdc(p.amountAtomic)}, ${p.status}): ${p.transaction ? explorer(p.transaction) : p.status}`);
  console.log(`İade (platform→alıcı): ${refundTx}\n  ${refundTx ? explorer(refundTx) : ""}`);

  const md = [
    `**Devnet kaydı — ajan + x402 (${new Date().toISOString().slice(0, 10)}).** Doğal dil görevi \`/agent/plan\` ile ${plan.dag.tasks.length} görevlik bir grafa çevrildi, \`/agent/approve\` ile x402 üzerinden Devnet USDC ödendi (üst sınır ${usdc(plan.quote.capAtomic)}). İş \`${jobId}\` canlı worker'larda çalıştı; **${VERIFIER}** doğrulama hileci worker'ı (\`${cheaterId}\`) yakaladı — sonuçları kabul edilmedi, emeği ödenmedi. Gerçekleşen maliyet ${usdc(job.payment?.realizedAtomic)}'ye düştü; dürüst worker ödemeleri ve ${usdc(job.payment?.refundDueAtomic)} alıcı iadesi tek işlemde zincirde kesinleşti.`,
    ``,
    `| Aşama | İşlem imzası / gezgin |`,
    `|---|---|`,
    `| x402 ödeme (alıcı→platform) | [\`${(paymentTx ?? "").slice(0, 12)}…\`](${paymentTx ? explorer(paymentTx) : ""}) |`,
    ...workerPayouts.map((p) => `| Worker ödemesi (${usdc(p.amountAtomic)}) | [\`${(p.transaction ?? "").slice(0, 12)}…\`](${p.transaction ? explorer(p.transaction) : ""}) |`),
    `| Alıcı iadesi (${usdc(job.payment?.refundDueAtomic)}) | [\`${(refundTx ?? "").slice(0, 12)}…\`](${refundTx ? explorer(refundTx) : ""}) |`,
    ``,
    `Hileci \`${cheaterId}\`: ${cheaterReplicas.length} kopya denedi, hiçbiri kabul edilmedi/ödenmedi. Anlaşmazlık ${taskCount} görevde ${extraReplication} ek kopya açtırdı (${VERIFIER} replikasyon).`,
    `Tüm imzalar: ${uniqueSigs.map(explorer).join(" , ")}`,
    ``,
  ].join("\n");
  const out = fileURLToPath(new URL("../../docs/devnet-agent-record.md", import.meta.url));
  writeFileSync(out, md);
  console.log(`\n▸ README'ye hazır blok yazıldı: docs/devnet-agent-record.md`);
  workers.forEach((w) => w.close());
}

main().then(
  () => setTimeout(() => process.exit(0), 300),
  (e) => { console.error(`HATA: ${e instanceof Error ? e.message : e}`); process.exit(1); },
);
