import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** shadcn/ui standardı: koşullu sınıfları birleştirip Tailwind çakışmalarını çözer. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/** Atomik USDC (6 ondalık) → Türkçe biçimli metin. */
export function usdc(atomic: number | null | undefined): string {
  if (atomic == null || Number.isNaN(atomic)) return "—";
  return `${(atomic / 1e6).toLocaleString("tr-TR", { minimumFractionDigits: 6 })} USDC`;
}

/** Uzun adres/imza kısaltma (ör. cüzdan, işlem imzası). */
export function short(s: string | null | undefined, head = 4, tail = 4): string {
  if (!s) return "—";
  return s.length <= head + tail + 1 ? s : `${s.slice(0, head)}…${s.slice(-tail)}`;
}

export const explorerTx = (sig: string) => `https://explorer.solana.com/tx/${sig}?cluster=devnet`;
