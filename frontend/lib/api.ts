// Coordinator HTTP API için tipli sarmalayıcılar.
// Üretimde (statik export, coordinator sunar) ve dev'de (next rewrites vekili) API same-origin'dir;
// bu yüzden taban yol boştur ("/..."). Gerekirse NEXT_PUBLIC_COORDINATOR_URL ile override edilebilir.
const BASE = process.env.NEXT_PUBLIC_COORDINATOR_URL ?? "";

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
  const text = await res.text();
  const body = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const msg = (body && typeof body === "object" && "error" in body && (body as { error?: string }).error) || `durum ${res.status}`;
    throw new ApiError(msg, res.status, body);
  }
  return body as T;
}

export class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly body: unknown) {
    super(message);
    this.name = "ApiError";
  }
}

// ---- Tipler (coordinator yanıtlarının kullanılan alt kümesi) ----
export interface Quote {
  cap: number;
  capAtomic: number;
  perTaskAtomic?: number;
}
export interface AgentInfo {
  llm: boolean;
  buyerAvailable: boolean;
  local: boolean;
}
export interface DemoInfo {
  payment: unknown;
  buyer: string | null;
  buyerAvailable: boolean;
  volunteerUrls: string[];
}
export interface Plan {
  planId: string;
  prompt: string;
  maxUsdc: number;
  maxAtomic: number;
  dag: { version: number; jobId?: string; tasks: unknown[] };
  quote: Quote;
  withinBudget: boolean;
  explanation: string;
  planner: "llm" | "rules";
  options: { scheduler: string; verifier: string };
  jobId?: string | null;
}
export interface Payout {
  kind: "worker" | "refund";
  payee: string;
  recipient: string | null;
  units: number | null;
  amountAtomic: number;
  status: string;
  transaction: string | null;
}
export interface Job {
  jobId: string;
  status: "RUNNING" | "COMPLETED" | "FAILED" | string;
  scheduler: string;
  verifier: string;
  source: string;
  submittedAt: number;
  completedAt: number | null;
  spotchecks: number;
  payment: {
    capAtomic: number;
    transaction: string | null;
    payer: string | null;
    realizedAtomic: number | null;
    refundDueAtomic: number | null;
    refundTransaction: string | null;
    payouts?: Payout[];
  } | null;
  tasks: { id: string; module: string; state: string }[];
}
export interface Replica {
  replicaId: number;
  task: string | null;
  spot: boolean;
  workerId: string | null;
  state: string;
  paid: boolean;
}
export interface ExampleSummary {
  name: string;
  jobId: string | null;
  tasks: number;
}

export const api = {
  health: () => req<{ ok: boolean }>("/health"),
  cbom: () => req<{ components?: unknown[]; metadata?: unknown }>("/cbom"),
  examples: () => req<ExampleSummary[]>("/examples"),
  example: (name: string) => req<unknown>(`/examples/${name}`),
  quote: (dag: unknown, query = "") => req<{ quote: Quote; payment: unknown }>(`/quote${query}`, { method: "POST", body: JSON.stringify(dag) }),
  job: (id: string) => req<Job>(`/jobs/${id}`),
  replicas: (id: string) => req<Replica[]>(`/jobs/${id}/replicas`),
  modules: () => req<{ bundleHash: string; modules: unknown[] }>("/modules"),
  demoInfo: () => req<DemoInfo>("/demo/info"),

  agent: {
    info: () => req<AgentInfo>("/agent/info"),
    plan: (body: { prompt: string; maxUsdc: number; scheduler?: string; verifier?: string }) =>
      req<Plan>("/agent/plan", { method: "POST", body: JSON.stringify(body) }),
    get: (planId: string) => req<Plan>(`/agent/plans/${planId}`),
    approve: (planId: string) =>
      req<{ ok?: boolean; jobId?: string; paid?: boolean; transaction?: string; payer?: string }>(
        "/agent/approve",
        { method: "POST", body: JSON.stringify({ planId }) },
      ),
  },
};
