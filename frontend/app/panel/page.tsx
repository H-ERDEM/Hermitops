"use client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

// Faz 1'de doldurulacak: örnek DAG seçimi, /quote ile teklif, "Öde ve gönder" (sunucu alıcısı) ve
// "Phantom ile öde" (lib/pay.ts). İskelet şimdilik yer tutucudur.
export default function PanelPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Demo paneli</h1>
        <p className="text-muted-foreground">Faz 1: alıcı akışı ve Phantom/x402 ödemesi buraya taşınacak.</p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Yakında</CardTitle>
          <CardDescription>
            Bu sayfa <code className="font-mono">panel.html</code> yerine geçecek: örnek DAG, teklif (<code className="font-mono">/quote</code>),
            x402 ödeme (<code className="font-mono">lib/pay.ts</code> → <code className="font-mono">/solana-rpc</code>) ve iş akışı izleme.
          </CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          API ve ödeme katmanı (<code className="font-mono">lib/api.ts</code>, <code className="font-mono">lib/pay.ts</code>) hazır; UI Faz 1'de eklenecek.
        </CardContent>
      </Card>
    </div>
  );
}
