"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { api, type AgentInfo, type DemoInfo } from "@/lib/api";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface Status {
  health: boolean | null;
  agent: AgentInfo | null;
  demo: DemoInfo | null;
  error: string | null;
}

export default function Home() {
  const [s, setS] = useState<Status>({ health: null, agent: null, demo: null, error: null });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [health, agent, demo] = await Promise.allSettled([api.health(), api.agent.info(), api.demoInfo()]);
        if (cancelled) return;
        setS({
          health: health.status === "fulfilled" ? health.value.ok : false,
          agent: agent.status === "fulfilled" ? agent.value : null,
          demo: demo.status === "fulfilled" ? demo.value : null,
          error: health.status === "rejected" ? "Coordinator'a ulaşılamadı" : null,
        });
      } catch (e) {
        if (!cancelled) setS((p) => ({ ...p, error: e instanceof Error ? e.message : String(e) }));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const online = s.health === true;

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">Gönüllü Hesaplama Platformu</h1>
          <Badge variant={online ? "success" : s.health === false ? "destructive" : "secondary"}>
            {online ? "coordinator bağlı" : s.health === false ? "bağlantı yok" : "kontrol ediliyor…"}
          </Badge>
        </div>
        <p className="max-w-2xl text-muted-foreground">
          Tarayıcılar iş akışlarını (DAG) çalıştırır; koordinatör sonuçları itibar tabanlı uyarlanabilir
          replikasyon ve sınama işleriyle doğrular; alıcılar işi x402 ile Solana Devnet USDC ödeyerek satın alır.
          Bu Next.js arayüzü eski HTML sayfalarının yerini alır (Faz 0 iskeleti).
        </p>
        {s.error && <p className="text-sm text-destructive">{s.error} — coordinator'ı başlatın: <code className="font-mono">npm run coordinator</code></p>}
      </section>

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <PageCard
          href="/panel"
          title="Demo paneli"
          desc="Örnek DAG seç, teklif al, x402 ile öde ve iş akışını izle."
          badge={s.demo?.buyerAvailable ? "alıcı hazır" : s.demo ? "sunucu alıcısı kapalı" : undefined}
        />
        <PageCard
          href="/kontrol"
          title="Kontrol merkezi"
          desc="Doğal dilde görev ver, grafı gör, Phantom ile öde; hileci tespiti ve ödeme akışı."
          badge={s.agent ? (s.agent.llm ? "ajan: LLM" : "ajan: kural tabanlı") : undefined}
        />
        <PageCard href="/" title="Gönüllü (yakında)" desc="Tarayıcıda Web Worker + WASM ile görev çalıştır. Faz 3'te taşınacak." badge="planlanıyor" />
      </section>
    </div>
  );
}

function PageCard({ href, title, desc, badge }: { href: string; title: string; desc: string; badge?: string }) {
  return (
    <Link href={href} className="group">
      <Card className="h-full transition-colors group-hover:border-primary/50">
        <CardHeader>
          <div className="flex items-center justify-between gap-2">
            <CardTitle>{title}</CardTitle>
            {badge && <Badge variant="outline">{badge}</Badge>}
          </div>
          <CardDescription>{desc}</CardDescription>
        </CardHeader>
        <CardContent>
          <span className="text-sm font-medium text-primary group-hover:underline">Aç →</span>
        </CardContent>
      </Card>
    </Link>
  );
}
