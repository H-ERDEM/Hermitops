"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { WorkerClient } from "./workerClient";

// Gönüllü protokolü (shared/schemas/messages.v0): hello/welcome/ping/pong/assign/result/status/bye.
// Koordinatöre WS ile bağlanır, gelen görevleri Web Worker'da (WASM) çalıştırır, sonucu geri yollar.

export const COOLDOWN_MS: Record<string, number> = { low: 5000, medium: 1000, high: 0 };

export interface VolunteerUi {
  conn: string;
  connCls: "ok" | "warn" | "err";
  state: string;
  workerId: string;
  impl: string;
  done: number;
  last: string;
}

export interface VolunteerConfig {
  cpu: "low" | "medium" | "high";
  wallet: string | null;
  impl?: "wasm" | "js";
}

const initial: VolunteerUi = { conn: "—", connCls: "warn", state: "—", workerId: "—", impl: "wasm", done: 0, last: "—" };

function wsUrl(): string {
  if (process.env.NEXT_PUBLIC_WS_URL) return process.env.NEXT_PUBLIC_WS_URL;
  const proto = location.protocol === "https:" ? "wss" : "ws";
  return `${proto}://${location.host}/ws`;
}

function lsGet(k: string): string | null {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
}
function lsSet(k: string, v: string): void {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* özel pencere: kalıcılık yok */
  }
}

function deviceClass(): string {
  if (typeof navigator === "undefined") return "desktop";
  const ua = navigator.userAgent;
  if (/iPad|Tablet/i.test(ua)) return "tablet";
  if (/Mobi|Android|iPhone/i.test(ua)) return "mobile";
  return "desktop";
}

class VolunteerController {
  private ws: WebSocket | null = null;
  private client = new WorkerClient();
  private backoffMs = 1000;
  private stopped = false;
  private available = true;
  private lastMsgAt = 0;
  private heartbeatMs = 5000;
  private done = 0;
  private watchdog: ReturnType<typeof setInterval> | null = null;
  private cooldownMs: number;

  constructor(private cfg: VolunteerConfig, private set: (u: Partial<VolunteerUi>) => void) {
    this.cooldownMs = COOLDOWN_MS[cfg.cpu] ?? COOLDOWN_MS.medium;
  }

  start() {
    this.stopped = false;
    this.set({ impl: this.cfg.impl ?? "wasm" });
    this.connect();
    this.watchdog = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN && Date.now() - this.lastMsgAt > 3 * this.heartbeatMs) this.ws.close();
    }, 1000);
  }

  stop() {
    this.stopped = true;
    if (this.watchdog) clearInterval(this.watchdog);
    this.send({ type: "bye", reason: "kullanıcı durdurdu" });
    this.ws?.close(1000);
    this.client.terminate();
    this.set({ conn: "durduruldu", connCls: "warn", state: "—" });
  }

  private connect() {
    this.set({ conn: "bağlanıyor…", connCls: "warn" });
    const ws = new WebSocket(wsUrl());
    this.ws = ws;
    ws.onopen = () => {
      this.backoffMs = 1000;
      this.lastMsgAt = Date.now();
      const hello: Record<string, unknown> = {
        type: "hello",
        consent: true,
        userAgent: navigator.userAgent.slice(0, 512),
        deviceClass: deviceClass(),
        impls: [this.cfg.impl ?? "wasm"],
      };
      const id = lsGet("vc.workerId");
      if (id) hello.workerId = id;
      if (this.cfg.wallet) hello.wallet = this.cfg.wallet;
      this.send(hello);
    };
    ws.onmessage = (e) => this.onMessage(JSON.parse(e.data));
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.set({ conn: this.stopped ? "durduruldu" : `koptu, ${Math.round(this.backoffMs / 1000)} sn sonra yeniden`, connCls: "err" });
      if (this.stopped) return;
      setTimeout(() => !this.stopped && this.connect(), this.backoffMs);
      this.backoffMs = Math.min(30000, this.backoffMs * 2);
    };
  }

  private send(msg: unknown) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  private setAvailable(available: boolean) {
    if (this.available === available) return;
    this.available = available;
    this.send({ type: "status", available });
    this.set({ state: available ? "boşta, görev bekleniyor" : "ara veriyor" });
  }

  private async onMessage(msg: Record<string, unknown>) {
    this.lastMsgAt = Date.now();
    switch (msg.type) {
      case "welcome": {
        this.heartbeatMs = Number(msg.heartbeatMs ?? 5000);
        if (typeof msg.workerId === "string") lsSet("vc.workerId", msg.workerId);
        this.set({ conn: "bağlı", connCls: "ok", workerId: String(msg.workerId ?? "—"), state: this.available ? "boşta, görev bekleniyor" : "ara veriyor" });
        if (!this.available) this.send({ type: "status", available: false });
        break;
      }
      case "ping":
        this.send({ type: "pong", t: msg.t });
        break;
      case "assign":
        await this.runAssignment(msg);
        break;
    }
  }

  private async runAssignment(msg: Record<string, unknown>) {
    const module = String(msg.module);
    this.set({ state: `çalışıyor: ${module} (#${msg.replicaId})` });
    const impl = this.cfg.impl ?? "wasm";
    const res = await this.client.run(module, String(msg.input), impl, Number(msg.deadlineMs ?? 120000), msg.moduleHash as string | undefined);
    const cooling = this.cooldownMs > 0;
    if (cooling) this.setAvailable(false);
    const out: Record<string, unknown> = {
      type: "result",
      replicaId: msg.replicaId,
      status: res.status,
      output: String(res.output ?? ""),
      durationMs: res.durationMs ?? 0,
      impl: res.impl ?? impl,
    };
    if (res.loadMs !== undefined) out.loadMs = res.loadMs;
    if (res.fatal) out.fatal = true;
    this.send(out);
    if (res.status === "ok") this.done++;
    this.set({
      done: this.done,
      last: `${module}: ${res.status === "ok" ? "tamam" : "HATA"}, ${(res.durationMs ?? 0).toFixed(1)} ms`,
    });
    if (cooling) setTimeout(() => this.setAvailable(true), this.cooldownMs);
    else this.set({ state: "boşta, görev bekleniyor" });
  }
}

export function useVolunteer() {
  const [ui, setUiState] = useState<VolunteerUi>(initial);
  const [running, setRunning] = useState(false);
  const ctrl = useRef<VolunteerController | null>(null);

  const patch = useCallback((u: Partial<VolunteerUi>) => setUiState((prev) => ({ ...prev, ...u })), []);

  const start = useCallback(
    (cfg: VolunteerConfig) => {
      if (ctrl.current) return;
      ctrl.current = new VolunteerController(cfg, patch);
      ctrl.current.start();
      setRunning(true);
    },
    [patch],
  );

  const stop = useCallback(() => {
    ctrl.current?.stop();
    ctrl.current = null;
    setRunning(false);
  }, []);

  useEffect(() => () => ctrl.current?.stop(), []);

  return { ui, running, start, stop };
}
