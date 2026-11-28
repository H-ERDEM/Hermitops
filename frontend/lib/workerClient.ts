"use client";
// Web Worker'ı yönetir, yanıtları taskId ile eşleştirir, fatal hata/zaman aşımında yeniden başlatır.
// worker.js statik olarak /worker.js'ten yüklenir (public/); WASM'ı runtime'da /pkg'den çeker, böylece
// Next bundler pkg bağımlılığını çözmek zorunda kalmaz (WASM derlemesi olmadan da build yeşil).

export const DEFAULT_TASK_TIMEOUT_MS = 120000;

export interface TaskResult {
  taskId: number;
  status: "ok" | "error";
  output: string;
  durationMs: number;
  impl?: string;
  loadMs?: number;
  fatal?: boolean;
}

export class WorkerClient {
  private timeoutMs: number;
  private nextId = 1;
  private pending = new Map<number, { resolve: (r: TaskResult) => void; timer: ReturnType<typeof setTimeout> }>();
  private worker!: Worker;

  constructor({ timeoutMs = DEFAULT_TASK_TIMEOUT_MS }: { timeoutMs?: number } = {}) {
    this.timeoutMs = timeoutMs;
    this.start();
  }

  private start() {
    this.worker = new Worker("/worker.js", { type: "module" });
    this.worker.onmessage = (e: MessageEvent) => this.onMessage(e.data as TaskResult);
    this.worker.onerror = (e) => {
      e.preventDefault();
      this.failAll(`worker error: ${e.message || "başlatılamadı (modül worker desteklenmiyor?)"}`);
    };
  }

  private onMessage(msg: TaskResult) {
    if (msg.taskId === null || msg.taskId === undefined) {
      this.failAll(msg.output);
      return;
    }
    const entry = this.pending.get(msg.taskId);
    if (!entry) return;
    this.pending.delete(msg.taskId);
    clearTimeout(entry.timer);
    entry.resolve(msg);
    if (msg.fatal) this.restart();
  }

  private failAll(reason: string) {
    for (const [taskId, entry] of this.pending) {
      clearTimeout(entry.timer);
      entry.resolve({ taskId, status: "error", output: reason, durationMs: 0 });
    }
    this.pending.clear();
    this.restart();
  }

  private restart() {
    this.worker.terminate();
    this.start();
  }

  terminate() {
    this.worker.terminate();
  }

  run(module: string, input: string, impl: "wasm" | "js" = "wasm", timeoutMs = this.timeoutMs, moduleHash?: string): Promise<TaskResult> {
    const taskId = this.nextId++;
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(taskId);
        this.restart();
        resolve({ taskId, status: "error", output: `zaman aşımı: ${timeoutMs} ms`, durationMs: 0 });
      }, timeoutMs);
      this.pending.set(taskId, { resolve, timer });
      this.worker.postMessage({ taskId, module, input, impl, ...(moduleHash ? { moduleHash } : {}) });
    });
  }
}
