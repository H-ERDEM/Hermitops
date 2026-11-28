"use client";
import { useEffect, useRef, useState } from "react";
import { api, type Job } from "./api";

/**
 * Bir işi, bitene (COMPLETED/FAILED) ve ödemeleri kesinleşene kadar anketleyen basit hook.
 * TanStack Query yerine hafif tutuldu; Faz 2'de WS olaylarıyla tetiklemeye geçilebilir.
 */
export function useJob(jobId: string | null, intervalMs = 2000) {
  const [job, setJob] = useState<Job | null>(null);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!jobId) {
      setJob(null);
      return;
    }
    let cancelled = false;
    const tick = async () => {
      try {
        const j = await api.job(jobId);
        if (cancelled) return;
        setJob(j);
        setError(null);
        const payouts = j.payment?.payouts ?? [];
        const settled =
          j.status !== "RUNNING" &&
          (payouts.length === 0 ||
            (payouts.every((p) => p.status === "confirmed" || p.status === "no_wallet") && !!j.payment?.refundTransaction));
        if (!settled) timer.current = setTimeout(tick, intervalMs);
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
        timer.current = setTimeout(tick, intervalMs);
      }
    };
    tick();
    return () => {
      cancelled = true;
      if (timer.current) clearTimeout(timer.current);
    };
  }, [jobId, intervalMs]);

  return { job, error };
}
