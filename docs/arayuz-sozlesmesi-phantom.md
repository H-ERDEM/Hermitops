# Arayüz Sözleşmesi — Phantom (Devnet) cüzdan entegrasyonu

**Durum:** Faz A uygulandı (2026-11-27). Faz B planlı.
**Kapsam:** Gönüllü (worker) tarafında Phantom ile ödeme adresi bağlama. Alıcı (buyer) tarafı
değişmedi; x402 ödemesi sunucuda `BUYER_PRIVATE_KEY` ile imzalanmaya devam eder.

Bu doküman, Phantom eklentisinin projeye nasıl bağlandığını ve hangi sınırların korunduğunu
belgeler. "Sözleşme", değişen/değişmeyen arayüzlerin (WS mesajları, HTTP API, config) birlikte
dondurulmuş hâlidir.

## 1. Roller ve cüzdanlar

| Rol | Phantom'un işi | İmza | Bu fazda |
|---|---|---|---|
| **Worker** | Ödeme (alım) adresini otomatik doldurur | Hayır (yalnızca alıcı) | ✅ uygulandı |
| **Buyer** | x402 ödemesini (USDC transferi) imzalar | Evet | ⏳ Faz B |

## 2. Tasarım kararları (Faz A)

- **Enjekte sağlayıcı, bundler yok.** Proje ön yüzü ham `.js` olarak sunulur (build adımı yok).
  Bu yüzden `@solana/wallet-adapter` (bundler ister) **kullanılmaz**; Phantom'un tarayıcıya enjekte
  ettiği sağlayıcı (`window.phantom.solana`, yedek `window.solana.isPhantom`) **doğrudan** kullanılır.
- **Ağdan bağımsız adres.** Phantom'un açık anahtarı tüm Solana ağlarında aynıdır; worker yalnızca
  adrese ihtiyaç duyduğundan Devnet USDC alımı için Phantom'un hangi ağda olduğu önemsizdir.
- **Elle giriş korunur.** Phantom olmayan tarayıcılar, Node worker'ı ve `?wallet=` parametresi
  aynen çalışır. Phantom yalnızca adres alanını doldurmanın ek bir yoludur.
- **İmza yok, kanıt yok.** Ödeme tek yönlü (alım) olduğu için sahiplik kanıtı (`signMessage`)
  gerekmez; Faz B'de opsiyonel olarak eklenebilir.
- **Geriye dönük uyumlu.** Şema, HTTP API ve WS protokolü değişmez.

## 3. Değişen / değişmeyen arayüzler

| Arayüz | Durum | Not |
|---|---|---|
| `shared/schemas/messages.v0.schema.json` (`hello.wallet`) | **değişmedi** | Aynı base58 deseni; Phantom yalnızca bu alanı doldurur |
| HTTP API (`/jobs`, `/demo/buy`, …) | **değişmedi** | Alıcı ödeme yolu aynen sunucuda |
| `shared/config/default.json` | **değişmedi** | Devnet/USDC mint tek kaynak: `payments/x402-proto/src/config.ts` |
| `volunteer.html` | düğme eklendi | `#connectWallet` + `#walletStatus` |
| `volunteer.js` | mantık eklendi | `connectPhantom`, `eagerConnectPhantom`, `accountChanged`/`disconnect` dinleyicileri |

## 4. Worker akışı (Faz A)

1. Gönüllü sayfayı açar. Daha önce izin verdiyse adres alanı **boşken** sessiz bağlanma
   (`connect({ onlyIfTrusted: true })`) adresi doldurur; popup açılmaz.
2. "Phantom ile bağlan" → `provider.connect()` → `publicKey` → base58 doğrulanır → adres alanına
   yazılır, `localStorage`'a (`vc.wallet`) kaydedilir.
3. Phantom'da hesap değişirse (`accountChanged`) adres güncellenir; bağlantı kesilirse uyarı gösterilir.
4. "Katılıyorum, başlat" → mevcut akış: adres `hello.wallet` olarak WS ile koordinatöre gider.

Hata durumları: Phantom yok → kurulum ipucu; kullanıcı reddi (`4001`) → "Bağlantı reddedildi";
beklenmedik adres → hata ve elle giriş önerisi.

## 5. Faz B (planlı, bu fazda YOK)

Alıcının x402 ödemesini tarayıcıda Phantom ile imzalaması. Gerektirir:
- `@x402/svm` istemcisinin tarayıcıya **bundle** edilmesi (esbuild) — yeni build adımı.
- Phantom'un `@solana/kit` `TransactionSigner` arayüzüne adapte edilmesi (`signTransaction`).
- Yeni uç nokta sözleşmesi: panel Phantom'dan imzalı payload alır → `POST /jobs`'a
  `PAYMENT-SIGNATURE` başlığıyla gönderir; sunucu `BUYER_PRIVATE_KEY` kullanmaz.
- Facilitator (x402.org) uyumunun Devnet'te doğrulanması.

Bu, ayrı ve daha büyük bir iştir; ana deneyleri etkilemez (x402 MoSCoW'da "Should").
