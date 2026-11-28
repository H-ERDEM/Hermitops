# Ön yüz (Next.js)

Eski HTML sayfalarının (`panel.html`, `kontrol.html`, `volunteer.html`) yerini alacak modern arayüz.
**Statik export** olarak derlenir; coordinator çıktıyı same-origin sunar, böylece API, `/ws` ve Phantom
ödemesi aynı origin'de kalır (güvenlik guard'ları ve CORS sorunsuz).

- **Çatı:** Next.js 15 (App Router) · React 19 · TypeScript
- **Stil:** Tailwind CSS + shadcn/ui tarzı bileşenler (`components/ui`)
- **Veri:** `lib/api.ts` (tipli coordinator çağrıları), `lib/useJob.ts` (iş anketi), `lib/useSocket.ts` (`/ws`)
- **Ödeme:** `lib/pay.ts` — Phantom + x402 (eski `pay-entry.js` portu; `/solana-rpc` vekilini kullanır)

## Kurulum ve geliştirme

```bash
cd frontend
npm install

# Geliştirme (coordinator'ı ayrı terminalde çalıştırın: kökte `npm run coordinator`)
#   next dev rewrites ile /jobs, /agent, /solana-rpc vb. coordinator'a (:8787) vekillenir.
#   WebSocket rewrite edilemez; coordinator'a doğrudan bağlanmak için:
NEXT_PUBLIC_WS_URL=ws://127.0.0.1:8787/ws npm run dev    # http://localhost:3000

# Üretim derlemesi (statik export → out/)
npm run build
```

## Coordinator ile birlikte sunum (üretim)

`npm run build` → `frontend/out/`. Coordinator'ın `static.ts`'i bu dizini sunacak şekilde
genişletilecek (Faz 3). O zamana kadar sayfalar `next dev` ile denenir.

## Durum (yol haritası)

| Faz | Durum |
|---|---|
| 0 — iskelet, API/pay/hook katmanı | ✅ |
| 1 — `/panel` (alıcı + Phantom/sunucu ödeme, teklif, iş izleme) | ✅ |
| 2 — `/kontrol` (ajan planlayıcı + DAG graf + onay + iş/hileci izleme) | ✅ |
| 3 — `static.ts` Next `out/` sunumu (coordinator same-origin) | ✅ |
| 4 — `/benchmark` (WASM vs JS) | ✅ |
| 5 — `/` gönüllü (Web Worker + WASM; `/worker.js` + `/pkg`) | ✅ |
| 6 — Dockerfile + compose + CI imaj | ⏳ |

> **Not:** Eski kök HTML/JS (`volunteer.html`, `panel.html`, `kontrol.html`, `index.html`,
> `worker.js` …) geçiş döneminde korunur — coordinator e2e testleri (`test/e2e.mjs`,
> `test/volunteer-e2e.mjs`) bunları açık adla çeker. Next UI `/`, `/panel`, `/kontrol`'ü sunar;
> eski dosyalar yalnızca açık `.html`/`.js` adıyla erişilir. Tam silme, e2e'ler Playwright ile Next
> sayfalarına taşınınca yapılacak. `js-baseline.js` ve `vectors.js` backend oracle'ında da kullanıldığı
> için kalıcıdır.
>
> **Üretimde UI'yı görmek için** önce `npm run build:web` (kökten), sonra `npm run coordinator`;
> coordinator `frontend/out`'u same-origin sunar.

## Ortam değişkenleri

| Değişken | Varsayılan | Açıklama |
|---|---|---|
| `NEXT_PUBLIC_COORDINATOR_URL` | `""` (same-origin) | API tabanı; normalde boş (export/dev-rewrites same-origin) |
| `NEXT_PUBLIC_WS_URL` | `wss://<host>/ws` | Dev'de coordinator WS'i (`ws://127.0.0.1:8787/ws`) |
| `COORDINATOR_URL` | `http://127.0.0.1:8787` | `next dev` rewrites hedefi (build-time) |
