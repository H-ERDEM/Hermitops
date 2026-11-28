import { readFile } from "node:fs/promises";
import { join, normalize } from "node:path";
import type { ServerResponse } from "node:http";
import { REPO_ROOT } from "../config.ts";

const MIME: Record<string, string> = {
  html: "text/html; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  mjs: "text/javascript; charset=utf-8",
  css: "text/css; charset=utf-8",
  wasm: "application/wasm",
  json: "application/json; charset=utf-8",
  svg: "image/svg+xml",
  ico: "image/x-icon",
  png: "image/png",
  jpg: "image/jpeg",
  webp: "image/webp",
  woff2: "font/woff2",
  woff: "font/woff",
  txt: "text/plain; charset=utf-8",
  map: "application/json; charset=utf-8",
};

const WEB_ROOT = join(REPO_ROOT, "frontend", "out"); // Next.js statik export (ana arayüz)
const PKG_ROOT = join(REPO_ROOT, "pkg"); // wasm-pack çıktısı (worker WASM)

// Eski (taşınmakta olan) kök sayfalar ve script'ler; e2e testleri bunları açık adla çeker
// (ör. /index.html, /volunteer.html, /worker.js). Next rotaları (/, /panel, /kontrol) out/'tan gelir.
const LEGACY = /^\/[A-Za-z0-9_-]+\.(?:html|js)$/;

function mimeFor(path: string): string {
  return MIME[path.slice(path.lastIndexOf(".") + 1).toLowerCase()] ?? "application/octet-stream";
}

/** Verilen köke göre güvenli mutlak yol (dizin çıkışını engeller) ya da null. */
function safeJoin(root: string, rel: string): string | null {
  const abs = normalize(join(root, rel));
  return abs === root || abs.startsWith(root + "/") ? abs : null;
}

async function sendFile(absPath: string | null, res: ServerResponse, status = 200): Promise<boolean> {
  if (!absPath) return false;
  let body: Buffer;
  try {
    body = await readFile(absPath);
  } catch {
    return false;
  }
  const immutable = absPath.includes("/_next/static/") || absPath.startsWith(PKG_ROOT);
  res.writeHead(status, {
    "content-type": mimeFor(absPath),
    "cache-control": immutable ? "public, max-age=31536000, immutable" : "no-cache",
  });
  res.end(body);
  return true;
}

/**
 * Next.js statik export'unu (frontend/out) ve WASM paketini (pkg/) koordinatörle aynı origin'den sunar.
 *   /            → out/index.html (gönüllü)
 *   /panel, /kontrol (uzantısız) → out/<ad>.html
 *   /_next/*     → out/
 *   /pkg/*       → pkg/ (WASM)
 *   açık eski .html/.js (/index.html, /volunteer.html, /worker.js …) → kök (geçiş dönemi, e2e)
 * Dosya sunulduysa true döner. out/ derlenmemişse (npm run build:web) Next rotaları için false döner.
 */
export async function serveStatic(pathname: string, res: ServerResponse): Promise<boolean> {
  const clean = decodeURIComponent(pathname.split("?")[0]);
  if (clean.includes("\0") || clean.includes("..")) return false;

  // WASM paketi (out/ dışında, kökteki pkg/).
  if (clean.startsWith("/pkg/")) return sendFile(safeJoin(PKG_ROOT, clean.slice(5)), res);

  // Next ana rotaları: out/.
  if (clean === "/") return sendFile(safeJoin(WEB_ROOT, "index.html"), res);
  if (!clean.slice(1).includes(".")) {
    // Uzantısız rota (/panel, /kontrol) → out/<ad>.html
    return sendFile(safeJoin(WEB_ROOT, `${clean.slice(1)}.html`), res);
  }
  if (clean.startsWith("/_next/")) return sendFile(safeJoin(WEB_ROOT, clean.slice(1)), res);

  // Açık uzantılı istek: önce eski kök dosyalar (geçiş/e2e), sonra out/ varlıkları.
  if (LEGACY.test(clean) && (await sendFile(safeJoin(REPO_ROOT, clean.slice(1)), res))) return true;
  return sendFile(safeJoin(WEB_ROOT, clean.slice(1)), res);
}
