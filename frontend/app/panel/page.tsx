"use client";
import { useEffect, useState } from "react";
import { api, type BuyStep, type ExampleSummary, type Quote, type DemoInfo } from "@/lib/api";
import { hermitPay } from "@/lib/pay";
import { connectPhantom } from "@/lib/phantom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { StepsTimeline } from "@/components/StepsTimeline";
import { JobView } from "@/components/JobView";
import { usdc } from "@/lib/utils";

const SCHEDULERS = ["fifo", "fastest", "reputation"];
const VERIFIERS = ["accept_first", "fixed2", "fixed3", "adaptive"];

export default function PanelPage() {
  const [examples, setExamples] = useState<ExampleSummary[]>([]);
  const [name, setName] = useState("");
  const [dag, setDag] = useState<unknown>(null);
  const [scheduler, setScheduler] = useState("reputation");
  const [verifier, setVerifier] = useState("adaptive");
  const [budget, setBudget] = useState("0.5");
  const [quote, setQuote] = useState<Quote | null>(null);
  const [steps, setSteps] = useState<BuyStep[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [demo, setDemo] = useState<DemoInfo | null>(null);

  useEffect(() => {
    api.examples().then((e) => {
      setExamples(e);
      if (e[0]) setName(e[0].name);
    }).catch((err) => setError(err.message));
    api.demoInfo().then(setDemo).catch(() => {});
  }, []);

  useEffect(() => {
    if (!name) return;
    setQuote(null);
    setDag(null);
    api.example(name).then(setDag).catch((err) => setError(err.message));
  }, [name]);

  const query = () => {
    const q = new URLSearchParams({ scheduler, verifier });
    return `?${q.toString()}`;
  };

  async function getQuote() {
    if (!dag) return;
    setError(null);
    try {
      const { quote } = await api.quote(dag, query());
      setQuote(quote);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function payServer() {
    if (!dag) return;
    reset();
    setPending(true);
    try {
      const b = Number(budget);
      const res = await api.demoBuy(dag, `${query()}&maxUsdc=${b}`);
      setSteps(res.steps ?? []);
      if (res.ok && res.jobId) setJobId(res.jobId);
      else setError(res.error ?? `durum ${res.status}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPending(false);
    }
  }

  async function payPhantom() {
    if (!dag) return;
    reset();
    setPending(true);
    const collected: BuyStep[] = [];
    try {
      const { provider, address } = await connectPhantom();
      const out = await hermitPay({
        provider,
        address,
        maxAtomic: BigInt(Math.round(Number(budget) * 1e6)),
        url: `/jobs${query()}`,
        body: JSON.stringify(dag),
        onStep: (s) => {
          collected.push(s);
          setSteps([...collected]);
        },
      });
      if (out.ok && out.jobId) setJobId(out.jobId);
      else setError(out.error ?? `durum ${out.status}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPending(false);
    }
  }

  function reset() {
    setSteps([]);
    setError(null);
    setJobId(null);
  }

  const overBudget = quote != null && quote.capAtomic > Math.round(Number(budget) * 1e6);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Demo paneli</h1>
        <p className="text-muted-foreground">Örnek bir iş akışı seç, teklif al ve x402 ile Devnet USDC ödeyerek gönder.</p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>İş akışı</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Örnek DAG">
                <Select value={name} onChange={(e) => setName(e.target.value)}>
                  {examples.map((ex) => (
                    <option key={ex.name} value={ex.name}>
                      {ex.name} ({ex.tasks} görev)
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Bütçe (USDC)">
                <Input type="number" min="0.001" step="0.01" value={budget} onChange={(e) => setBudget(e.target.value)} />
              </Field>
              <Field label="Zamanlayıcı">
                <Select value={scheduler} onChange={(e) => setScheduler(e.target.value)}>
                  {SCHEDULERS.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </Select>
              </Field>
              <Field label="Doğrulayıcı">
                <Select value={verifier} onChange={(e) => setVerifier(e.target.value)}>
                  {VERIFIERS.map((v) => (
                    <option key={v} value={v}>{v}</option>
                  ))}
                </Select>
              </Field>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={getQuote} disabled={!dag || pending}>Teklif al</Button>
              <Button onClick={payPhantom} disabled={!dag || pending}>Phantom ile öde</Button>
              {demo?.buyerAvailable && (
                <Button variant="secondary" onClick={payServer} disabled={!dag || pending}>Öde ve gönder (sunucu)</Button>
              )}
            </div>

            {quote && (
              <div className="rounded-md border p-3">
                <div className="text-2xl font-semibold tabular-nums">{usdc(quote.capAtomic)}</div>
                <div className="text-xs text-muted-foreground">üst sınır (gerçekleşen genelde daha düşük; fark iade edilir)</div>
                {overBudget && <div className="mt-1 text-xs text-destructive">Üst sınır bütçeyi aşıyor — bütçeyi en az {usdc(quote.capAtomic)} yapın.</div>}
              </div>
            )}
            {error && !steps.length && <p className="text-sm text-destructive">{error}</p>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Ödeme akışı</CardTitle>
          </CardHeader>
          <CardContent>
            {steps.length === 0 && !pending ? (
              <p className="text-sm text-muted-foreground">Ödeme başlatınca x402 adımları (402 → imza → kesinleşme) burada görünür.</p>
            ) : (
              <StepsTimeline steps={steps} pending={pending} error={error} />
            )}
          </CardContent>
        </Card>
      </div>

      {jobId && <JobView jobId={jobId} />}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {children}
    </div>
  );
}
