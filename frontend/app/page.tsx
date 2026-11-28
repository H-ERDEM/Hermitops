"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { connectPhantom } from "@/lib/phantom";
import { useVolunteer } from "@/lib/useVolunteer";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { cn, short } from "@/lib/utils";

const WALLET_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export default function VolunteerPage() {
  const { ui, running, start, stop } = useVolunteer();
  const [wallet, setWallet] = useState("");
  const [cpu, setCpu] = useState<"low" | "medium" | "high">("medium");
  const [chargingOnly, setChargingOnly] = useState(false);
  const [walletMsg, setWalletMsg] = useState<string | null>(null);
  const [online, setOnline] = useState<boolean | null>(null);

  useEffect(() => {
    api.health().then((h) => setOnline(h.ok)).catch(() => setOnline(false));
    try {
      const saved = localStorage.getItem("vc.wallet");
      if (saved) setWallet(saved);
    } catch {
      /* yok */
    }
  }, []);

  async function connectWallet() {
    setWalletMsg("Phantom açılıyor…");
    try {
      const { address } = await connectPhantom();
      setWallet(address);
      try {
        localStorage.setItem("vc.wallet", address);
      } catch {
        /* yok */
      }
      setWalletMsg(`Phantom bağlı: ${short(address)} (Devnet)`);
    } catch (e) {
      setWalletMsg(e instanceof Error ? e.message : String(e));
    }
  }

  function begin() {
    const w = wallet.trim();
    if (w && !WALLET_RE.test(w)) {
      setWalletMsg("Bu bir Solana adresine benzemiyor (base58, 32–44 karakter). Düzeltin ya da boş bırakın.");
      return;
    }
    start({ cpu, wallet: WALLET_RE.test(w) ? w : null, impl: "wasm" });
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">Gönüllü ol</h1>
          <Badge variant={online ? "success" : online === false ? "destructive" : "secondary"}>
            {online ? "coordinator bağlı" : online === false ? "bağlantı yok" : "…"}
          </Badge>
        </div>
        <p className="text-muted-foreground">
          Bu sayfa açıkken tarayıcın, koordinatörden gelen belirlenimci WASM görevlerini çalıştırır. Kurulum
          gerekmez; istediğin an durdurabilirsin. İsteğe bağlı bir Devnet adresi verirsen doğrulanan işler için ödeme alırsın.
        </p>
      </div>

      {!running ? (
        <Card>
          <CardHeader>
            <CardTitle>Onay</CardTitle>
            <CardDescription>Ne çalıştırılır ve ne kaydedilir: belirlenimci Rust/WASM görevleri; worker kimliği ve ödeme adresi tarayıcında (localStorage), itibar koordinatörde.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label>Ödeme adresi (Devnet, isteğe bağlı)</Label>
              <div className="flex gap-2">
                <Input value={wallet} onChange={(e) => setWallet(e.target.value)} placeholder="Solana Devnet adresi ya da Phantom ile bağlan" />
                <Button variant="outline" onClick={connectWallet} className="shrink-0">Phantom</Button>
              </div>
              {walletMsg && <p className="text-xs text-muted-foreground">{walletMsg}</p>}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>CPU kullanımı</Label>
                <Select value={cpu} onChange={(e) => setCpu(e.target.value as typeof cpu)}>
                  <option value="low">düşük (5 sn ara)</option>
                  <option value="medium">orta (1 sn ara)</option>
                  <option value="high">yüksek (ara yok)</option>
                </Select>
              </div>
              <label className="flex items-end gap-2 pb-2 text-sm text-muted-foreground">
                <input type="checkbox" checked={chargingOnly} onChange={(e) => setChargingOnly(e.target.checked)} />
                Mobilde yalnızca şarjdayken
              </label>
            </div>
            <Button onClick={begin} className="w-full">Katıl ve görev almaya başla</Button>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>Çalışıyor</CardTitle>
              <span className={cn("text-sm", ui.connCls === "ok" ? "text-emerald-600" : ui.connCls === "err" ? "text-destructive" : "text-amber-600")}>
                {ui.conn}
              </span>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm sm:grid-cols-4">
              <Stat label="Durum" value={ui.state} />
              <Stat label="Tamamlanan" value={String(ui.done)} />
              <Stat label="Worker" value={short(ui.workerId)} />
              <Stat label="Uygulama" value={ui.impl} />
            </div>
            <div className="rounded-md border bg-muted/40 p-3 text-xs text-muted-foreground">Son görev: {ui.last}</div>
            <Button variant="destructive" onClick={stop} className="w-full">Durdur</Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="truncate font-medium">{value}</div>
    </div>
  );
}
