"use client";
import { Check, Loader2, X } from "lucide-react";
import type { BuyStep } from "@/lib/api";
import { short, usdc, explorerTx } from "@/lib/utils";
import { cn } from "@/lib/utils";

const LABELS: Record<string, string> = {
  request: "İstek",
  payment_required: "402 Ödeme gerekli",
  signed: "Alıcı imzaladı",
  settled: "Zincirde kesinleşti",
  rejected: "Reddedildi",
};

function detailText(s: BuyStep): string {
  const d = s.detail ?? {};
  if (s.kind === "request") return `${d.method ?? "POST"} ${d.path ?? "/jobs"}`;
  if (s.kind === "payment_required") return `${usdc(typeof d.amountAtomic === "number" ? d.amountAtomic : null)} · Devnet USDC → ${short(d.payTo as string)}`;
  if (s.kind === "signed") return "PAYMENT-SIGNATURE başlığıyla yeniden gönderildi";
  if (s.kind === "settled") return `${short(d.jobId as string)} · imza ${short(d.transaction as string)}`;
  if (s.kind === "rejected") return String(d.error ?? "ödeme reddedildi");
  return "";
}

/** x402 adımlarını (402 → imza → kesinleşme) dikey zaman çizelgesi olarak gösterir. */
export function StepsTimeline({ steps, pending, error }: { steps: BuyStep[]; pending?: boolean; error?: string | null }) {
  const planned = ["request", "payment_required", "signed", "settled"];
  const done = new Set(steps.map((s) => s.kind));
  const rows = planned.map((kind) => {
    const s = steps.find((x) => x.kind === kind);
    const isDone = done.has(kind) && (kind !== "settled" || !!s);
    const isActive = pending && !isDone && planned.findIndex((k) => k === kind) === steps.filter((x) => planned.includes(x.kind)).length;
    return { kind, s, isDone, isActive };
  });

  return (
    <ol className="space-y-3">
      {rows.map(({ kind, s, isDone, isActive }) => (
        <li key={kind} className="flex items-start gap-3">
          <span
            className={cn(
              "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border",
              isDone ? "border-emerald-600 bg-emerald-600 text-white" : isActive ? "border-primary text-primary" : "border-muted-foreground/30 text-muted-foreground/40",
            )}
          >
            {isDone ? <Check className="h-3 w-3" /> : isActive ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
          </span>
          <div className={cn("min-w-0", !isDone && !isActive && "opacity-40")}>
            <div className="text-sm font-medium">{LABELS[kind]}</div>
            {s && (
              <div className="truncate text-xs text-muted-foreground">
                {s.kind === "settled" && typeof s.detail.transaction === "string" ? (
                  <a className="hover:underline" href={explorerTx(s.detail.transaction)} target="_blank" rel="noreferrer">
                    {detailText(s)}
                  </a>
                ) : (
                  detailText(s)
                )}
              </div>
            )}
          </div>
        </li>
      ))}
      {error && (
        <li className="flex items-start gap-3">
          <span className="mt-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-destructive text-white">
            <X className="h-3 w-3" />
          </span>
          <div className="text-sm text-destructive">{error}</div>
        </li>
      )}
    </ol>
  );
}
