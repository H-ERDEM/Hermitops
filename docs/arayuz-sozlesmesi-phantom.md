# Arayüz Sözleşmesi — Phantom (Devnet) cüzdan entegrasyonu

**Durum:** Faz A uygulandı (2026-11-27). Faz B uygulandı (2026-11-28).
**Kapsam:** Worker tarafında Phantom ile ödeme adresi bağlama (Faz A) **ve** alıcının x402
ödemesini tarayıcıda Phantom ile imzalaması (Faz B). Sunucudaki `BUYER_PRIVATE_KEY` ile
sunucu-imzalı akış (`/demo/buy`) yedek olarak korunur.

Bu doküman, Phantom eklentisinin projeye nasıl bağlandığını ve hangi sınırların korunduğunu
belgeler. "Sözleşme", değişen/değişmeyen arayüzlerin (WS mesajları, HTTP API, config) birlikte
dondurulmuş hâlidir.

## 1. Roller ve cüzdanlar

| Rol | Phantom'un işi | İmza | Bu fazda |
|---|---|---|---|
| **Worker** | Ödeme (alım) adresini otomatik doldurur | Hayır (yalnızca alıcı) | ✅ uygulandı |
| **Buyer** | x402 ödemesini (USDC transferi) imzalar | Evet | ✅ Faz B |

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

## 5. Faz B — tarayıcıda Phantom ile x402 ödemesi (uygulandı)

Alıcı, panel'deki **"Phantom ile öde (tarayıcı)"** düğmesiyle ödemeyi kendi Phantom cüzdanında
imzalar; sunucudaki `BUYER_PRIVATE_KEY` kullanılmaz.

**Sunucu değişmedi.** `JobPayments.submit` (payments.ts) imzalayandan bağımsızdır: yalnızca
`PAYMENT-SIGNATURE` başlığını okuyup facilitator'da doğrular/kesinleştirir. `POST /jobs` aynı uçtur.

**Mimari:**
- **Bundle:** `coordinator/web/pay-entry.js`, `npm run build:pay` ile `pkg/pay.bundle.js`'e derlenir
  (esbuild, `--platform=browser`). `pkg/` gitignore'dadır (WASM gibi); derlenmezse düğme
  "modül derlenmemiş" uyarısı verir. Panel bunu `import("/pkg/pay.bundle.js")` ile yükler.
- **İmza akışı:** `wrapFetchWithPayment(fetch, x402Client(ExactSvmScheme(phantomSigner)))` →
  `/jobs` POST → 402 → `ExactSvmScheme` client, facilitator'ın verdiği `feePayer` + `blockhash`
  ile tx mesajını kurar → `phantomSigner.signTransactions` çağrılır → 201.
- **Phantom → kit adaptörü:** `ClientSvmSigner = @solana/kit TransactionSigner`. Adaptör kit tx'ini
  (`messageBytes`) web3.js `VersionedTransaction`'a çevirip `provider.signTransaction` ile
  imzalatır, alıcının 64 baytlık imzasını `SignatureDictionary` olarak döndürür. Phantom yalnızca
  co-signer'dır; ücreti facilitator öder, zinciri facilitator gönderir — tarayıcıda RPC gerekmez.
- **Politika:** yalnızca Devnet + Devnet USDC + bütçe (`devnetPolicyWithMax`), Faz A/CLI ile aynı.

**Doğrulama sınırı:** Bundle derlenmesi, tarayıcıda yüklenmesi, `x402Client` kurulması ve
`hermitPay` → `/jobs` → 201 akışı (imza dalı hariç) otomatik testle doğrulandı. **Gerçek Devnet
imzası/kesinleşmesi** gerçek Phantom cüzdanı + kullanıcı onayı gerektirir (otomatikleştirilemez);
`PAYMENTS=1` koordinatöre karşı elle denenmelidir.
