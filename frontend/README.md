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
| 0 — iskelet, API/pay/hook katmanı, landing | ✅ bu commit |
| 1 — `/panel` (alıcı + Phantom) | ⏳ |
| 2 — `/kontrol` (ajan + graf) | ⏳ |
| 3 — `static.ts` export sunumu, eski HTML emekli | ⏳ |
| 5 — `/` gönüllü (Web Worker + WASM) | ⏳ |
| 6 — Dockerfile + compose | ⏳ |

## Ortam değişkenleri

| Değişken | Varsayılan | Açıklama |
|---|---|---|
| `NEXT_PUBLIC_COORDINATOR_URL` | `""` (same-origin) | API tabanı; normalde boş (export/dev-rewrites same-origin) |
| `NEXT_PUBLIC_WS_URL` | `wss://<host>/ws` | Dev'de coordinator WS'i (`ws://127.0.0.1:8787/ws`) |
| `COORDINATOR_URL` | `http://127.0.0.1:8787` | `next dev` rewrites hedefi (build-time) |
