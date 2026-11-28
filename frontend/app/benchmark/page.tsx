"use client";
import { useRef, useState } from "react";
import { WorkerClient } from "@/lib/workerClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

// WASM vs saf-JS kıyas (eski index.html + main.js'in yerini alır). Worker'ı /worker.js üzerinden
// çalıştırır; WASM paketi (/pkg) derlenmemişse yalnızca JS ölçülür.
const VECTORS: { module: string; input: string }[] = [
  { module: "sha_chain", input: JSON.stringify({ seed: "bench", iterations: 50000 }) },
  { module: "matmul", input: JSON.stringify({ seed: 7, n: 64 }) },
  { module: "image_blur", input: JSON.stringify({ seed: 42, w: 64, h: 48, passes: 2 }) },
];

interface Row {
  module: string;
  wasm: number | null;
  js: number | null;
  error?: string;
}

export default function BenchmarkPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState(false);
  const client = useRef<WorkerClient | null>(null);

  async function run() {
    setBusy(true);
    setRows([]);
    client.current ??= new WorkerClient();
    const out: Row[] = [];
    for (const v of VECTORS) {
      const wasm = await client.current.run(v.module, v.input, "wasm");
      const js = await client.current.run(v.module, v.input, "js");
      out.push({
        module: v.module,
        wasm: wasm.status === "ok" ? wasm.durationMs : null,
        js: js.status === "ok" ? js.durationMs : null,
        error: wasm.status !== "ok" ? String(wasm.output).slice(0, 80) : undefined,
      });
      setRows([...out]);
    }
    setBusy(false);
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Kıyas</h1>
        <p className="text-muted-foreground">Belirlenimci görevleri tarayıcıda WASM ve saf JS ile çalıştırıp süreleri karşılaştırır.</p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>WASM vs JS</CardTitle>
          <CardDescription>WASM paketi (/pkg) derlenmemişse WASM sütunu boş kalır (yalnızca JS).</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Button onClick={run} disabled={busy}>{busy ? "Çalışıyor…" : "Kıyası çalıştır"}</Button>
          {rows.length > 0 && (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="py-2 font-medium">Modül</th>
                  <th className="py-2 text-right font-medium">WASM (ms)</th>
                  <th className="py-2 text-right font-medium">JS (ms)</th>
                  <th className="py-2 text-right font-medium">JS/WASM</th>
                </tr>
              </thead>
              <tbody className="tabular-nums">
                {rows.map((r) => (
                  <tr key={r.module} className="border-b">
                    <td className="py-2 font-mono">{r.module}</td>
                    <td className="py-2 text-right">{r.wasm?.toFixed(1) ?? "—"}</td>
                    <td className="py-2 text-right">{r.js?.toFixed(1) ?? "—"}</td>
                    <td className="py-2 text-right">{r.wasm && r.js ? `${(r.js / r.wasm).toFixed(2)}×` : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
