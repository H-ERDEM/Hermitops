"use client";
// Phantom + x402 alıcı ödemesi (eski coordinator/web/pay-entry.js'in TS portu).
// Sunucu imzalayandan bağımsızdır: yalnızca PAYMENT-SIGNATURE başlığını okur. Bu modül o başlığı
// Phantom imzasıyla üretir. ExactSvmScheme ödeme yükünü kurarken Devnet RPC'ye erişir; tarayıcıdan
// doğrudan public RPC CORS/rate-limit'e takıldığı için coordinator'ın same-origin /solana-rpc vekilini
// kullanırız.
import { wrapFetchWithPayment, x402Client } from "@x402/fetch";
import { ExactSvmScheme } from "@x402/svm/exact/client";
import { decodePaymentRequiredHeader } from "@x402/core/http";
import { VersionedTransaction, VersionedMessage } from "@solana/web3.js";

const SOLANA_DEVNET = "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1";
const DEVNET_USDC_MINT = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";

// Yalnızca Devnet + Devnet USDC + en fazla bütçe (atomik USDC). Jenerik imza, x402'nin
// PaymentPolicy tipine uyumludur (payments/x402-proto/src/config.ts ile aynı desen).
function devnetPolicyWithMax(maxAtomic: bigint) {
  return <R extends { network: string; asset: string; amount: string }>(_v: number, reqs: R[]): R[] =>
    reqs.filter((r) => r.network === SOLANA_DEVNET && r.asset === DEVNET_USDC_MINT && BigInt(r.amount) <= maxAtomic);
}

export interface PhantomProvider {
  signTransaction(tx: VersionedTransaction): Promise<VersionedTransaction>;
  connect(): Promise<{ publicKey: { toString(): string } }>;
  isPhantom?: boolean;
}

export interface BuyStep {
  t: number;
  kind: "request" | "payment_required" | "signed" | "settled" | "rejected";
  detail: Record<string, unknown>;
}

export interface PayResult {
  ok: boolean;
  jobId?: string;
  status?: number;
  payment?: { transaction?: string; payer?: string };
  error?: string;
}

// Phantom'u x402 SVM imzalayanına uyarlar (co-signer; ücreti/zinciri facilitator yönetir). x402'nin
// markalı Address tipiyle tam örtüşmediğinden kurucuya aktarırken yapı olarak uyumlu şekilde geçilir.
function phantomSigner(provider: PhantomProvider, address: string) {
  return {
    address,
    async signTransactions(transactions: { messageBytes: Uint8Array }[]) {
      const results: Record<string, Uint8Array>[] = [];
      for (const tx of transactions) {
        const message = VersionedMessage.deserialize(tx.messageBytes);
        const vtx = new VersionedTransaction(message);
        const signed = await provider.signTransaction(vtx);
        const msg = signed.message as unknown as {
          staticAccountKeys?: { toBase58(): string }[];
          getAccountKeys?: () => { staticAccountKeys: { toBase58(): string }[] };
        };
        const keys = (msg.staticAccountKeys ?? msg.getAccountKeys?.().staticAccountKeys ?? []).map((k) => k.toBase58());
        const idx = keys.indexOf(address);
        const sig = signed.signatures[idx >= 0 ? idx : 0];
        if (!sig || sig.length !== 64) throw new Error("Phantom imzası alınamadı (beklenen 64 bayt).");
        results.push({ [address]: sig });
      }
      return results;
    },
  };
}

export interface HermitPayArgs {
  provider: PhantomProvider;
  address: string;
  maxAtomic: bigint;
  url: string;
  body: string;
  onStep?: (s: BuyStep) => void;
}

type SchemeSigner = ConstructorParameters<typeof ExactSvmScheme>[0];

/** Seçili DAG'i x402 ile satın alır: 402 → Phantom imzalar → tekrar gönderir → 201. */
export async function hermitPay({ provider, address, maxAtomic, url, body, onStep }: HermitPayArgs): Promise<PayResult> {
  const step = (kind: BuyStep["kind"], detail: Record<string, unknown>) => {
    try {
      onStep?.({ t: Date.now(), kind, detail });
    } catch {
      /* panel yoksa yok say */
    }
  };
  const rpcUrl = typeof location !== "undefined" ? new URL("/solana-rpc", location.href).href : "https://api.devnet.solana.com";
  const signer = phantomSigner(provider, address) as unknown as SchemeSigner;
  const client = new x402Client()
    .register("solana:*", new ExactSvmScheme(signer, { rpcUrl }))
    .registerPolicy(devnetPolicyWithMax(maxAtomic));

  // Closure içinde atandığından nesne kutusunda tutulur (CFA'nın tipi daraltmaması için).
  const box: { required: { amountAtomic: number; payTo: string } | null } = { required: null };
  const recording: typeof fetch = async (input, init) => {
    const r = new Request(input, init);
    const signed = r.headers.has("payment-signature") || r.headers.has("x-payment");
    step(signed ? "signed" : "request", signed ? { header: "PAYMENT-SIGNATURE" } : { method: r.method, path: new URL(r.url).pathname });
    const res = await fetch(r);
    if (res.status === 402) {
      try {
        const a = decodePaymentRequiredHeader(res.headers.get("payment-required") ?? "")?.accepts?.[0] as
          | { amount: string; payTo: string }
          | undefined;
        if (a) box.required = { amountAtomic: Number(a.amount), payTo: a.payTo };
      } catch {
        /* başlık yoksa boş geç */
      }
      step(signed ? "rejected" : "payment_required", box.required ? { ...box.required } : {});
    }
    return res;
  };

  const payFetch = wrapFetchWithPayment(recording, client);
  let res: Response;
  try {
    res = await payFetch(url, { method: "POST", headers: { "content-type": "application/json" }, body });
  } catch (e) {
    const msg = String(e instanceof Error ? e.message : e);
    const fmt = (atomic: number) => (atomic / 1e6).toLocaleString("tr-TR", { minimumFractionDigits: 6 });
    if (/filtered out by policies/i.test(msg)) {
      const required = box.required;
      if (required && required.amountAtomic > Number(maxAtomic)) {
        throw new Error(
          `Gerekli tutar ${fmt(required.amountAtomic)} USDC, bütçenizi (${fmt(Number(maxAtomic))} USDC) aşıyor. Bütçeyi en az ${fmt(required.amountAtomic)} USDC yapıp tekrar deneyin.`,
        );
      }
      throw new Error("Ödeme gereksinimleri istemci politikasıyla elendi (yalnızca Devnet USDC, en fazla bütçe). Bütçeyi ve ağın Devnet olduğunu kontrol edin.");
    }
    throw e;
  }

  const out = (await res.json().catch(() => ({}))) as { jobId?: string; error?: string; payment?: { transaction?: string; payer?: string } };
  if (res.status === 201) {
    step("settled", { jobId: out.jobId, transaction: out.payment?.transaction, payer: out.payment?.payer });
    return { ok: true, jobId: out.jobId, payment: out.payment };
  }
  return { ok: false, status: res.status, error: out.error ?? `durum ${res.status}` };
}
