// Gönüllü sayfası: koordinatöre WebSocket ile bağlanır, gelen görevleri Web Worker'da (WASM) çalıştırır.
// Protokol: shared/schemas/messages.v0.schema.json ve README "WebSocket protokolü".
//
// URL parametreleri (hepsi isteğe bağlı):
//   coordinator=ws://host:port/ws   varsayılan: sayfanın sunulduğu adres + /ws
//   impl=wasm|js                    varsayılan wasm; js yalnızca test/karşılaştırma için
//   autostart=1                     onay ekranını atlar; YALNIZCA araştırmacının kendi cihazlarında deney için
//   cpu=low|medium|high             CPU kullanım düzeyi
//   wallet=<Solana adresi>          ödeme adresi (onay ekranındaki alanla aynı; Devnet)
//   fault=random|collude&s=0.2      DENEY MODU: s olasılıkla kasıtlı yanlış sonuç (f/s deneyleri, 11. hafta)

import { WorkerClient } from "./worker-client.js";

const params = new URLSearchParams(location.search);
const COOLDOWN_MS = { low: 5000, medium: 1000, high: 0 };
const $ = (id) => document.getElementById(id);

const cfg = {
  url: params.get("coordinator") ?? `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`,
  impl: params.get("impl") === "js" ? "js" : "wasm",
  fault: ["random", "collude"].includes(params.get("fault")) ? params.get("fault") : null,
  s: Math.min(1, Math.max(0, Number(params.get("s") ?? 0))),
};

function storageGet(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}
function storageSet(key, value) {
  try { localStorage.setItem(key, value); } catch { /* özel pencere vb.: kalıcılık yok */ }
}

function deviceClass() {
  const ua = navigator.userAgent;
  if (/iPad|Tablet/i.test(ua)) return "tablet";
  if (/Mobi|Android|iPhone/i.test(ua)) return "mobile";
  return "desktop";
}

// ---------- Deney modu: kasıtlı hatalı worker ----------

async function sha256Hex(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** random: her seferinde benzersiz yanlış değer; collude: aynı girdi için tüm colluding worker'larda aynı yanlış değer. */
async function maybeCorrupt(module, input, result) {
  if (!cfg.fault || result.status !== "ok" || Math.random() >= cfg.s) return result;
  const token = await sha256Hex(cfg.fault === "random" ? crypto.randomUUID() : `collude|${module}|${input}`);
  // Yalnızca hash değişir; biçim gerçek çıktıyla aynı kalır, böylece yanlış sonuç biçiminden ayırt edilemez.
  const parsed = JSON.parse(result.output);
  parsed.hash = token;
  return { ...result, output: JSON.stringify(parsed) };
}

// ---------- Bağlantı ----------

class Volunteer {
  constructor({ cooldownMs, chargingOnly, wallet }) {
    this.cooldownMs = cooldownMs;
    this.chargingOnly = chargingOnly;
    this.wallet = wallet;
    this.client = new WorkerClient();
    this.done = 0;
    this.backoffMs = 1000;
    this.stopped = false;
    this.available = true;
    this.lastMsgAt = 0;
    this.heartbeatMs = 5000;
  }

  start() {
    this.stopped = false;
    this.watchBattery();
    this.connect();
    this.watchdog = setInterval(() => {
      // Koordinatörden 3 heartbeat süresince ses yoksa bağlantı ölü sayılır.
      if (this.ws?.readyState === WebSocket.OPEN && Date.now() - this.lastMsgAt > 3 * this.heartbeatMs) this.ws.close();
    }, 1000);
  }

  stop() {
    this.stopped = true;
    clearInterval(this.watchdog);
    this.send({ type: "bye", reason: "kullanıcı durdurdu" });
    this.ws?.close(1000);
    ui.conn("durduruldu", "warn");
    ui.state("—");
  }

  connect() {
    ui.conn("bağlanıyor…", "warn");
    const ws = new WebSocket(cfg.url);
    this.ws = ws;
    ws.onopen = () => {
      this.backoffMs = 1000;
      this.lastMsgAt = Date.now();
      const hello = { type: "hello", consent: true, userAgent: navigator.userAgent.slice(0, 512), deviceClass: deviceClass(), impls: [cfg.impl] };
      const id = storageGet("vc.workerId");
      if (id) hello.workerId = id;
      if (this.wallet) hello.wallet = this.wallet;
      this.send(hello);
    };
    ws.onmessage = (e) => this.onMessage(JSON.parse(e.data));
    ws.onclose = () => {
      if (this.ws !== ws) return;
      ui.conn(this.stopped ? "durduruldu" : `koptu, ${Math.round(this.backoffMs / 1000)} sn sonra yeniden denenecek`, "err");
      if (this.stopped) return;
      setTimeout(() => !this.stopped && this.connect(), this.backoffMs);
      this.backoffMs = Math.min(30000, this.backoffMs * 2);
    };
  }

  send(msg) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  setAvailable(available) {
    if (this.available === available) return;
    this.available = available;
    this.send({ type: "status", available });
    ui.state(available ? "boşta, görev bekleniyor" : "ara veriyor");
  }

  async onMessage(msg) {
    this.lastMsgAt = Date.now();
    switch (msg.type) {
      case "welcome":
        this.heartbeatMs = msg.heartbeatMs;
        storageSet("vc.workerId", msg.workerId);
        ui.conn("bağlı", "ok");
        ui.set("wid", msg.workerId);
        ui.set("impl", cfg.fault ? `${cfg.impl} (DENEY: ${cfg.fault}, s=${cfg.s})` : cfg.impl);
        // Yeniden bağlanmada koordinatör worker'ı müsait sayar; yerel durumu ona bildir.
        if (!this.available) this.send({ type: "status", available: false });
        ui.state(this.available ? "boşta, görev bekleniyor" : "ara veriyor");
        break;
      case "ping":
        this.send({ type: "pong", t: msg.t });
        break;
      case "assign":
        await this.runAssignment(msg);
        break;
    }
  }

  async runAssignment(msg) {
    ui.state(`çalışıyor: ${msg.module} (#${msg.replicaId})`);
    const raw = await this.client.run(msg.module, msg.input, cfg.impl, msg.deadlineMs, msg.moduleHash);
    const res = await maybeCorrupt(msg.module, msg.input, raw);
    // Ara verilecekse durum mesajı sonuçtan ÖNCE gider; böylece koordinatör yeni görev atamaz.
    const cooling = this.cooldownMs > 0;
    if (cooling) this.setAvailable(false);
    const out = { type: "result", replicaId: msg.replicaId, status: res.status, output: String(res.output ?? ""), durationMs: res.durationMs ?? 0, impl: res.impl ?? cfg.impl };
    if (res.loadMs !== undefined) out.loadMs = res.loadMs;
    if (res.fatal) out.fatal = true;
    this.send(out);
    if (res.status === "ok") this.done++;
    ui.set("done", String(this.done));
    ui.set("last", `${msg.module}: ${res.status === "ok" ? "tamam" : "HATA"}, ${res.durationMs?.toFixed?.(1) ?? 0} ms`);
    if (cooling) setTimeout(() => this.setAvailable(this.batteryOk()), this.cooldownMs);
    else ui.state("boşta, görev bekleniyor");
  }

  // Mobilde "yalnızca şarjdayken" seçeneği (Battery Status API yalnızca bazı tarayıcılarda var).
  batteryOk() {
    return !this.chargingOnly || deviceClass() === "desktop" || this.battery?.charging !== false;
  }
  async watchBattery() {
    if (!this.chargingOnly || !navigator.getBattery) return;
    this.battery = await navigator.getBattery();
    const update = () => this.setAvailable(this.batteryOk());
    this.battery.addEventListener("chargingchange", update);
    update();
  }
}

// ---------- Arayüz ----------

const ui = {
  set: (id, text) => ($(id).textContent = text),
  conn: (text, cls) => {
    $("conn").textContent = text;
    $("conn").className = cls;
  },
  state: (text) => ($("state").textContent = text),
};

// Solana adresi: base58, 32–44 karakter (şemadaki desenle aynı).
const WALLET_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
$("wallet").value = params.get("wallet") ?? storageGet("vc.wallet") ?? "";

// ---------- Phantom (Devnet) cüzdan bağlantısı ----------
// Faz A: worker yalnızca ödeme ADRESİNİ alır; imza atmaz. Build adımı olmadığı için
// @solana/wallet-adapter yerine tarayıcıya enjekte edilen sağlayıcı doğrudan kullanılır.
// Phantom'un açık anahtarı ağdan bağımsızdır; aynı adres Devnet USDC alımı için geçerlidir.
function phantomProvider() {
  if (window.phantom?.solana?.isPhantom) return window.phantom.solana;
  if (window.solana?.isPhantom) return window.solana;
  return null;
}

// Phantom sağlayıcısını enjekte etmeden önce tıklanırsa kısa süre bekle (geç enjeksiyon).
function waitForPhantom(timeoutMs = 3000) {
  return new Promise((resolve) => {
    const now = phantomProvider();
    if (now) return resolve(now);
    const started = Date.now();
    const iv = setInterval(() => {
      const p = phantomProvider();
      if (p || Date.now() - started > timeoutMs) { clearInterval(iv); resolve(p); }
    }, 100);
  });
}

// Sağlayıcı yoksa nedenini daraltmak için ortam tanısı (konsola da yazılır).
function walletDiag() {
  const other = Boolean(window.solana && !window.solana.isPhantom);
  return {
    host: location.host,
    phantom: Boolean(window.phantom),
    solana: Boolean(window.solana),
    otherWallet: other,
    secure: window.isSecureContext,
  };
}

function walletStatus(text, cls) {
  const el = $("walletStatus");
  el.textContent = text;
  el.className = cls;
}

function applyWallet(addr) {
  if (!WALLET_RE.test(addr)) {
    walletStatus("Phantom beklenmedik bir adres döndürdü.", "err");
    return;
  }
  $("wallet").value = addr;
  storageSet("vc.wallet", addr);
  walletStatus(`Phantom bağlı: ${addr.slice(0, 4)}…${addr.slice(-4)} (Devnet)`, "ok");
}

let phantomBound = false;
function bindPhantomEvents(provider) {
  if (phantomBound) return;
  phantomBound = true;
  // Kullanıcı Phantom'da hesap değiştirirse ödeme adresini güncelle.
  provider.on?.("accountChanged", (pk) => {
    if (pk) applyWallet(pk.toString());
    else walletStatus("Phantom bağlantısı kesildi; adresi elle girebilirsiniz.", "warn");
  });
  provider.on?.("disconnect", () => walletStatus("Phantom bağlantısı kesildi.", "warn"));
}

async function connectPhantom() {
  walletStatus("Phantom aranıyor…", "muted");
  const provider = await waitForPhantom();
  if (!provider) {
    const d = walletDiag();
    console.warn("[phantom] sağlayıcı bulunamadı:", d);
    walletStatus(
      d.otherWallet
        ? "Phantom bulunamadı; başka bir cüzdan eklentisi aktif. Phantom'u etkinleştirip sayfayı yenileyin."
        : "Phantom bulunamadı — kuruluysa sayfayı http://localhost:8787 adresinden (127.0.0.1 değil) açıp yenileyin; gizli pencere kullanmayın.",
      "warn");
    return;
  }
  walletStatus("Phantom açılıyor…", "muted");
  try {
    const { publicKey } = await provider.connect();
    applyWallet(publicKey.toString());
    bindPhantomEvents(provider);
  } catch (e) {
    // 4001: kullanıcı isteği reddetti.
    walletStatus(e?.code === 4001 ? "Bağlantı reddedildi." : `Bağlanılamadı: ${e?.message ?? e}`, "err");
  }
}

// Daha önce izin verilmişse adres alanı boşken sessizce doldur (popup açmadan).
async function eagerConnectPhantom() {
  if ($("wallet").value.trim()) return;
  const provider = await waitForPhantom(2000);
  if (!provider) return;
  try {
    const { publicKey } = await provider.connect({ onlyIfTrusted: true });
    applyWallet(publicKey.toString());
    bindPhantomEvents(provider);
  } catch { /* güvenilmiyor ya da Phantom kilitli: sessizce geç */ }
}

$("connectWallet").addEventListener("click", connectPhantom);
eagerConnectPhantom();

let volunteer = null;
function begin() {
  const level = params.get("cpu") ?? $("cpu").value;
  const wallet = $("wallet").value.trim();
  if (wallet && !WALLET_RE.test(wallet)) {
    $("walletHint").textContent = "Bu bir Solana adresine benzemiyor (base58, 32–44 karakter). Düzeltin ya da boş bırakın.";
    $("walletHint").className = "err";
    if (params.get("autostart") !== "1") return;
  }
  const valid = WALLET_RE.test(wallet) ? wallet : null;
  if (valid) storageSet("vc.wallet", valid);
  volunteer = new Volunteer({ cooldownMs: COOLDOWN_MS[level] ?? COOLDOWN_MS.medium, chargingOnly: $("chargingOnly").checked, wallet: valid });
  ui.set("walletShown", valid ? `${valid.slice(0, 4)}…${valid.slice(-4)} (Devnet)` : "yok (ödeme yapılmaz)");
  $("consent").hidden = true;
  $("panel").hidden = false;
  volunteer.start();
}

$("agree").addEventListener("click", begin);
$("stop").addEventListener("click", () => volunteer?.stop());
if (params.get("autostart") === "1") begin();
