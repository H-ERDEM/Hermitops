import type { NextConfig } from "next";

// Üretim: statik export (out/). Coordinator bu çıktıyı same-origin sunar; API ve /ws aynı origin'de
// olduğu için güvenlik guard'ları (trustedLocalCaller) ve Phantom ödemesi olduğu gibi çalışır.
// Geliştirme: `next dev` sunucusu rewrites ile coordinator'a vekillik eder (export build bunları yok
// sayar), böylece tarayıcıdan /jobs, /agent, /solana-rpc vb. same-origin görünür — CORS ve
// cross-site guard sorunu olmaz. WebSocket (/ws) rewrite edilemez; dev'de NEXT_PUBLIC_WS_URL ver.
const isDev = process.env.NODE_ENV === "development";
const COORDINATOR_URL = process.env.COORDINATOR_URL ?? "http://127.0.0.1:8787";

// Coordinator'ın HTTP uçları (static.ts dışındaki her şey). Dev'de bunlar vekillenir.
const API_PATHS = [
  "health",
  "cbom",
  "cbom.json",
  "quote",
  "jobs",
  "jobs/:path*",
  "workers",
  "modules",
  "examples",
  "examples/:path*",
  "events",
  "agent/:path*",
  "demo/:path*",
  "solana-rpc",
];

const nextConfig: NextConfig = {
  output: isDev ? undefined : "export",
  images: { unoptimized: true },
  // rewrites yalnızca dev'de tanımlanır; export build'de uyarı üretmesin diye prod'da hiç eklenmez.
  ...(isDev
    ? {
        rewrites: async () => API_PATHS.map((p) => ({ source: `/${p}`, destination: `${COORDINATOR_URL}/${p}` })),
      }
    : {}),
};

export default nextConfig;
