"use client";
import { useEffect, useState } from "react";
import { api, type Job, type Replica } from "@/lib/api";
import { useJob } from "@/lib/useJob";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { usdc, short, explorerTx } from "@/lib/utils";

function statusBadge(status: string) {
  if (status === "COMPLETED") return <Badge variant="success">tamamlandı</Badge>;
  if (status === "FAILED") return <Badge variant="destructive">başarısız</Badge>;
  return <Badge variant="secondary">çalışıyor</Badge>;
}

/** Bir işin canlı durumu: defter, worker ödemeleri + iade (zincir imzalarıyla), hileci özeti. */
export function JobView({ jobId }: { jobId: string }) {
  const { job, error } = useJob(jobId);
  const [replicas, setReplicas] = useState<Replica[] | null>(null);

  useEffect(() => {
    if (!job) return;
    let cancelled = false;
    api
      .replicas(jobId)
      .then((r) => !cancelled && setReplicas(r))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [jobId, job?.status, job]);

  if (error && !job) return <p className="text-sm text-destructive">{error}</p>;
  if (!job) return <p className="text-sm text-muted-foreground">İş yükleniyor…</p>;

  const p = job.payment;
  const payouts = p?.payouts ?? [];
  const workerPayouts = payouts.filter((x) => x.kind === "worker");
  const totalReplicas = replicas?.filter((r) => !r.spot).length ?? 0;
  const cheaters = cheaterSummary(replicas);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="font-mono text-sm">{job.jobId}</CardTitle>
          {statusBadge(job.status)}
        </div>
        <div className="text-xs text-muted-foreground">
          {job.tasks.length} görev · zamanlayıcı {job.scheduler} · doğrulayıcı {job.verifier}
          {job.spotchecks > 0 && ` · ${job.spotchecks} sınama`}
        </div>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        {p && (
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-4">
            <Metric label="Üst sınır" value={usdc(p.capAtomic)} />
            <Metric label="Gerçekleşen" value={usdc(p.realizedAtomic)} />
            <Metric label="İade" value={usdc(p.refundDueAtomic)} />
            <Metric label="Ödeyen" value={short(p.payer)} />
          </div>
        )}

        {replicas && (
          <div className="rounded-md border bg-muted/40 p-3 text-xs">
            <div className="font-medium">Doğrulama</div>
            <div className="text-muted-foreground">
              {job.tasks.length} görev → {totalReplicas} kopya
              {cheaters.workers > 0 ? (
                <>
                  {" · "}
                  <span className="text-amber-600">{cheaters.workers} worker yakalandı</span>, {cheaters.unpaid} kopya ödenmedi
                </>
              ) : (
                " · uyuşmazlık yok"
              )}
            </div>
          </div>
        )}

        {(workerPayouts.length > 0 || p?.refundTransaction) && (
          <div className="space-y-1">
            <div className="text-xs font-medium text-muted-foreground">Zincir üstü ödemeler</div>
            {workerPayouts.map((x) => (
              <PayoutRow key={x.payee} label={`Worker ${short(x.payee)} (${x.units ?? 0} birim)`} amount={x.amountAtomic} status={x.status} tx={x.transaction} />
            ))}
            {p?.refundTransaction && <PayoutRow label="Alıcı iadesi" amount={p.refundDueAtomic ?? 0} status="confirmed" tx={p.refundTransaction} />}
          </div>
        )}

        {p?.transaction && (
          <a className="inline-block text-xs text-primary hover:underline" href={explorerTx(p.transaction)} target="_blank" rel="noreferrer">
            x402 ödeme imzası: {short(p.transaction)} →
          </a>
        )}
      </CardContent>
    </Card>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="font-medium tabular-nums">{value}</div>
    </div>
  );
}

function PayoutRow({ label, amount, status, tx }: { label: string; amount: number; status: string; tx: string | null }) {
  return (
    <div className="flex items-center justify-between gap-2 text-xs">
      <span className="truncate">{label}</span>
      <span className="flex items-center gap-2 tabular-nums">
        {usdc(amount)}
        {tx ? (
          <a className="text-primary hover:underline" href={explorerTx(tx)} target="_blank" rel="noreferrer">
            {short(tx)}
          </a>
        ) : (
          <span className="text-muted-foreground">{status}</span>
        )}
      </span>
    </div>
  );
}

function cheaterSummary(replicas: Replica[] | null): { workers: number; unpaid: number } {
  if (!replicas) return { workers: 0, unpaid: 0 };
  // Hileci sinyali: aynı worker'ın birden çok kopyası var ama hiçbiri ödenmemiş (yanlış sonuç kabul edilmedi).
  const byWorker = new Map<string, { total: number; paid: number }>();
  for (const r of replicas) {
    if (!r.workerId) continue;
    const e = byWorker.get(r.workerId) ?? { total: 0, paid: 0 };
    e.total += 1;
    if (r.paid) e.paid += 1;
    byWorker.set(r.workerId, e);
  }
  let workers = 0;
  let unpaid = 0;
  for (const e of byWorker.values()) {
    if (e.total > 0 && e.paid === 0) {
      workers += 1;
      unpaid += e.total;
    }
  }
  return { workers, unpaid };
}
