// Faz B — Alıcının x402 ödemesini TARAYICIDA Phantom ile imzalaması.
// esbuild ile tek dosyaya derlenir: `npm run build:pay` → pkg/pay.bundle.js (statik sunulur, gitignore).
// Sunucu (coordinator/src/api/payments.ts) imzalayandan bağımsızdır; yalnızca PAYMENT-SIGNATURE
// başlığını okuyup facilitator'da doğrular/kesinleştirir. Bu modül o başlığı Phantom imzasıyla üretir.
import { wrapFetchWithPayment, x402Client } from "@x402/fetch";
import { ExactSvmScheme } from "@x402/svm/exact/client";
import { VersionedTransaction, VersionedMessage } from "@solana/web3.js";

// Devnet sabitleri — payments/x402-proto/src/config.ts ile AYNI olmalı (tek kaynak orası; bu
// tarayıcı bundle'ı o Node modülünü (process.env) içe aktaramadığı için değerler burada yinelenir).
const SOLANA_DEVNET = "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1";
const DEVNET_USDC_MINT = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";

// İstemci harcama politikası: yalnızca Devnet + Devnet USDC + en fazla bütçe (atomik USDC).
function devnetPolicyWithMax(maxAtomic) {
  return (_version, reqs) =>
    reqs.filter((r) => r.network === SOLANA_DEVNET && r.asset === DEVNET_USDC_MINT && BigInt(r.amount) <= maxAtomic);
}

// Phantom'u @solana/kit TransactionPartialSigner'a uyarlar. x402 exact client, facilitator'ın
// verdiği feePayer + blockhash ile tx mesajını kurar ve signer'ın signTransactions'ını çağırır;
// biz kit tx'ini web3.js VersionedTransaction'a çevirip Phantom'a imzalatır, alıcının 64 baytlık
// ed25519 imzasını (SignatureDictionary) döndürürüz. Phantom yalnızca co-signer'dır; ücreti
// facilitator öder, zinciri de facilitator gönderir.
function phantomSigner(provider, address) {
  return {
    address,
    async signTransactions(transactions) {
      const results = [];
      for (const tx of transactions) {
        const message = VersionedMessage.deserialize(tx.messageBytes);
        const vtx = new VersionedTransaction(message);
        const signed = await provider.signTransaction(vtx);
        const keys = (signed.message.staticAccountKeys
          ?? signed.message.getAccountKeys?.().staticAccountKeys
          ?? []).map((k) => k.toBase58());
        const idx = keys.indexOf(address);
        const sig = signed.signatures[idx >= 0 ? idx : 0];
        if (!sig || sig.length !== 64) throw new Error("Phantom imzası alınamadı (beklenen 64 bayt).");
        results.push({ [address]: sig });
      }
      return results;
    },
  };
}

/**
 * Paneldeki "Phantom ile öde" düğmesinin çağırdığı işlev. Seçili DAG'i `/jobs`'a gönderir;
 * 402 gelince Phantom imzalar, tekrar gönderir, 201 döner. Her adım onStep ile panele yansır.
 * @returns {Promise<{ok:boolean,jobId?,payment?,status?,error?}>}
 */
export async function hermitPay({ provider, address, maxAtomic, url, body, onStep }) {
  const step = (kind, detail) => { try { onStep?.({ t: Date.now(), kind, detail }); } catch { /* panel yok */ } };
  const client = new x402Client()
    .register("solana:*", new ExactSvmScheme(phantomSigner(provider, address)))
    .registerPolicy(devnetPolicyWithMax(maxAtomic));
  // Her istek/yanıtı panele kaydeden fetch; ödeme sarmalayıcısı bunun üstüne kurulur.
  const recording = async (input, init) => {
    const req = new Request(input, init);
    const signed = req.headers.has("payment-signature") || req.headers.has("x-payment");
    step(signed ? "signed" : "request", signed ? { header: "PAYMENT-SIGNATURE" } : { method: req.method, path: new URL(req.url).pathname });
    const res = await fetch(req);
    if (res.status === 402) step(signed ? "rejected" : "payment_required", {});
    return res;
  };
  const payFetch = wrapFetchWithPayment(recording, client);
  const res = await payFetch(url, { method: "POST", headers: { "content-type": "application/json" }, body });
  const out = await res.json().catch(() => ({}));
  if (res.status === 201) {
    step("settled", { jobId: out.jobId, transaction: out.payment?.transaction, payer: out.payment?.payer });
    return { ok: true, jobId: out.jobId, payment: out.payment };
  }
  return { ok: false, status: res.status, error: out.error ?? `durum ${res.status}` };
}

// Panelin dinamik import yerine global de kullanabilmesi için.
if (typeof window !== "undefined") window.hermitPay = hermitPay;
