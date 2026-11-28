"use client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

// Faz 2'de doldurulacak: doğal dil → /agent/plan, graf (React Flow), /agent/approve + Phantom,
// hileci tespiti ve ödeme/iade izleme (lib/useJob, lib/useSocket).
export default function KontrolPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Kontrol merkezi</h1>
        <p className="text-muted-foreground">Faz 2: ajan planlayıcı, graf görseli ve ödeme akışı buraya taşınacak.</p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Yakında</CardTitle>
          <CardDescription>
            Bu sayfa <code className="font-mono">kontrol.html</code> yerine geçecek: doğal dil görevden grafa
            (<code className="font-mono">/agent/plan</code>), Phantom ile onay (<code className="font-mono">/agent/approve</code>),
            canlı iş/replica izleme ve hileci tespiti.
          </CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Veri katmanı (<code className="font-mono">lib/api.ts</code>, <code className="font-mono">useJob</code>, <code className="font-mono">useSocket</code>) hazır; graf ve UI Faz 2'de.
        </CardContent>
      </Card>
    </div>
  );
}
