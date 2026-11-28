"use client";
import { useEffect, useState } from "react";
import { api, type BuyStep, type Plan, type AgentInfo } from "@/lib/api";
import { hermitPay } from "@/lib/pay";
import { connectPhantom } from "@/lib/phantom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { DagGraph, type Dag } from "@/components/DagGraph";
import { StepsTimeline } from "@/components/StepsTimeline";
import { JobView } from "@/components/JobView";
import { usdc } from "@/lib/utils";

const VERIFIERS = ["adaptive", "fixed2", "fixed3", "accept_first"];

export default function KontrolPage() {
  const [prompt, setPrompt] = useState("üç görseli bulanıklaştır, bir matris çarp, sonuçları özetle");
  const [budget, setBudget] = useState("0.5");
  const [verifier, setVerifier] = useState("adaptive");
  const [plan, setPlan] = useState<Plan | null>(null);
  const [agent, setAgent] = useState<AgentInfo | null>(null);
  const [steps, setSteps] = useState<BuyStep[]>([]);
  const [pending, setPending] = useState(false);
  const [planning, setPlanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);

  useEffect(() => {
    api.agent.info().then(setAgent).catch(() => {});
  }, []);

  async function makePlan() {
    setError(null);
    setPlan(null);
    setSteps([]);
    setJobId(null);
    setPlanning(true);
    try {
      const p = await api.agent.plan({ prompt, maxUsdc: Number(budget), verifier });
      setPlan(p);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPlanning(false);
    }
  }

  const query = (p: Plan) => `?${new URLSearchParams({ ...p.options, source: "agent" }).toString()}`;

  async function approvePhantom() {
    if (!plan) return;
    setSteps([]);
    setError(null);
    setJobId(null);
    setPending(true);
    const collected: BuyStep[] = [];
    try {
      const { provider, address } = await connectPhantom();
      const out = await hermitPay({
        provider,
        address,
        maxAtomic: BigInt(plan.maxAtomic),
        url: `/jobs${query(plan)}`,
        body: JSON.stringify(plan.dag),
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

  async function approveServer() {
    if (!plan) return;
    setError(null);
    setJobId(null);
    setPending(true);
    try {
      const out = await api.agent.approve(plan.planId);
      if (out.jobId) setJobId(out.jobId);
      else setError("Onay beklenen işi döndürmedi.");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Kontrol merkezi</h1>
        <p className="text-muted-foreground">
          Doğal dilde görev yaz; ajan onu bir graf iş akışına çevirsin. Onayla, Phantom ile öde; hileci
          tespiti ve ödeme/iade zincirde kesinleşsin.
          {agent && <span className="ml-1 text-xs">(ajan: {agent.llm ? "LLM" : "kural tabanlı"})</span>}
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Görev</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label>Doğal dil görev</Label>
              <textarea
                className="flex min-h-20 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Bütçe (USDC)</Label>
                <Input type="number" min="0.001" step="0.01" value={budget} onChange={(e) => setBudget(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Doğrulayıcı</Label>
                <Select value={verifier} onChange={(e) => setVerifier(e.target.value)}>
                  {VERIFIERS.map((v) => (
                    <option key={v} value={v}>{v}</option>
                  ))}
                </Select>
              </div>
            </div>
            <Button onClick={makePlan} disabled={planning || !prompt.trim()}>
              {planning ? "Planlanıyor…" : "Planı oluştur"}
            </Button>

            {plan && (
              <div className="space-y-2 rounded-md border p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium">{plan.dag.tasks.length} görevlik iş akışı</span>
                  <Badge variant={plan.withinBudget ? "success" : "destructive"}>
                    üst sınır {usdc(plan.quote.capAtomic)}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground">{plan.explanation}</p>
                <div className="flex flex-wrap gap-2 pt-1">
                  <Button size="sm" onClick={approvePhantom} disabled={pending || !plan.withinBudget}>Phantom ile öde</Button>
                  {agent?.buyerAvailable && (
                    <Button size="sm" variant="secondary" onClick={approveServer} disabled={pending || !plan.withinBudget}>Onayla (sunucu)</Button>
                  )}
                </div>
              </div>
            )}
            {error && !steps.length && <p className="text-sm text-destructive">{error}</p>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Graf</CardTitle>
          </CardHeader>
          <CardContent>
            <DagGraph dag={plan ? (plan.dag as unknown as Dag) : null} />
          </CardContent>
        </Card>
      </div>

      {(steps.length > 0 || pending) && (
        <Card>
          <CardHeader>
            <CardTitle>Ödeme akışı</CardTitle>
          </CardHeader>
          <CardContent>
            <StepsTimeline steps={steps} pending={pending} error={error} />
          </CardContent>
        </Card>
      )}

      {jobId && <JobView jobId={jobId} />}
    </div>
  );
}
