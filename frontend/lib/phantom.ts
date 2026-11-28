"use client";
import type { PhantomProvider } from "./pay";

interface WindowWithPhantom {
  phantom?: { solana?: PhantomProvider & { isPhantom?: boolean } };
  solana?: PhantomProvider & { isPhantom?: boolean };
}

/** Enjekte edilmiş Phantom sağlayıcısını döndürür (varsa). */
export function getPhantom(): PhantomProvider | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as WindowWithPhantom;
  if (w.phantom?.solana?.isPhantom) return w.phantom.solana;
  if (w.solana?.isPhantom) return w.solana;
  return null;
}

/** Eklenti geç enjekte olabilir; kısa süre bekler. */
export async function waitForPhantom(ms = 3000): Promise<PhantomProvider | null> {
  const t0 = Date.now();
  for (;;) {
    const p = getPhantom();
    if (p || Date.now() - t0 > ms) return p;
    await new Promise((r) => setTimeout(r, 100));
  }
}

/** Phantom'a bağlanır ve cüzdan adresini döndürür. */
export async function connectPhantom(): Promise<{ provider: PhantomProvider; address: string }> {
  const provider = await waitForPhantom();
  if (!provider) throw new Error("Phantom bulunamadı. Eklentiyi kurun, Devnet'e geçin ve sayfayı http://localhost'tan açın (gizli pencere değil).");
  const { publicKey } = await provider.connect();
  return { provider, address: publicKey.toString() };
}
