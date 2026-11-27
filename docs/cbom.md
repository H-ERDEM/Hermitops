# Kriptografik Envanter (CBOM)

**Durum:** Statik, tek seferlik envanter (2026-11-28). Belgeleme amaçlıdır; uygulamanın
ana odağı değildir ve çalışma zamanına girmez.
**Makine-okunur sürüm:** [`cbom.json`](cbom.json) — CycloneDX 1.6 "Cryptography Bill of Materials".

Bu doküman, projenin kullandığı kriptografik varlıkları (algoritmalar, anahtarlar, protokoller)
tek yerde toplar. CBOM, SBOM'un kriptografiye odaklı özelleşmesidir; amaç, sistemin **güven
sınırlarını** ve **kripto-çevikliğini (crypto-agility)** görünür kılmaktır. Burada verilen
envanter, projenin zaten var olan **bütünlük anlatısıyla** (belirlenimci görevler, `moduleHash`,
kanonik JSON, replikasyonla doğrulama) örtüşür; yeni bir kripto tasarımı getirmez, mevcut
kullanımı formelleştirir.

## 1. Envanter özeti

| Varlık | Tür | Amaç | Nerede |
|---|---|---|---|
| **Ed25519** | İmza (EdDSA, Curve25519) | Cüzdan kimliği + x402 ödeme imzası | [keygen.ts](../payments/x402-proto/src/keygen.ts), [solana-chain.ts](../coordinator/src/solana-chain.ts), [pay-entry.js](../coordinator/web/pay-entry.js), submit/mcp-agent/demo-buyer |
| **SHA-256** | Özet (hash) | (1) `sha_chain` hesabı, (2) `bundleHash`/`moduleHash` bütünlüğü | [src/lib.rs](../src/lib.rs), [js-baseline.js](../js-baseline.js), [ref_vectors.py](../scripts/ref_vectors.py), [modules.ts](../coordinator/src/modules.ts), [oracle.ts](../coordinator/src/oracle.ts) |
| **Platform CSPRNG** | Rastgelelik (DRBG) | İş/worker kimlikleri (`randomUUID`) — anahtar üretmez | [coordinator.ts](../coordinator/src/coordinator.ts), [oracle.ts](../coordinator/src/oracle.ts) |
| **x402** | Protokol (v2, `exact`) | HTTP 402 üzerinden stablecoin mikro-ödeme | [payments.ts](../coordinator/src/api/payments.ts), [pay-entry.js](../coordinator/web/pay-entry.js) |
| **Ed25519 anahtar çiftleri** | Anahtar materyali | Alıcı/platform/facilitator/gönüllü cüzdanları | [.env.example](../payments/x402-proto/.env.example) (gerçek `.env` commit edilmez) |
| base58 / base64 | Kodlama (kripto değil) | Adres/anahtar ve wire tx kodlaması | `@scure/base`, web3.js köprüsü |

## 2. İki ayrı SHA-256 rolü

Aynı algoritma, iki farklı güven amacı — ayrımı korumak önemlidir:

- **Hesap (compute):** `sha_chain` görevi, yinelenen SHA-256'dır. Belirlenimcidir ve üç bağımsız
  uygulamada (Rust/WASM, saf JS, Python) **aynı test vektörlerini** üretir. Buradaki rol
  *doğrulanabilir tekrar üretilebilirlik*tir, gizlilik değil.
- **Bütünlük (integrity):** WASM paketinin özeti `sha256:<hex>` olarak hesaplanır (`bundleHash`),
  her görev bu özete (`moduleHash`) bağlanır; worker paketi çalıştırmadan önce özeti denetler.
  Buradaki rol *değişmezlik/kurcalama tespiti*dir.

Bu ikilik, CBOM'un replikasyonla doğrulama ve `moduleHash` mekanizmalarıyla neden doğal olarak
örtüştüğünü de açıklar.

## 3. Güven sınırları ve dürüst sınırlılıklar

- **Taşımada TLS yok (demo).** Koordinatör HTTP (`127.0.0.1`) ve WebSocket (`ws://`) kullanır;
  worker↔koordinatör ve tarayıcı↔koordinatör trafiği **şifresiz ve kimliksizdir**. Yerel demo
  için kabul edilebilir; sistem yerel ağ/internete açılırsa (`HOST=0.0.0.0`) bir ters vekil
  arkasında **TLS (`wss://`/HTTPS) zorunludur**. Bu, envanterin ortaya çıkardığı en somut açıktır.
- **Post-kuantum dayanıklılık yok.** Ed25519 (imza) ve SHA-256 (128-bit klasik güvenlik) kuantum
  bilgisayarlara karşı dayanıklı değildir. Ancak imza şeması **Solana zinciri tarafından dayatılır**;
  bu yüzden kripto-çeviklik burada sınırlıdır — projenin tek başına değiştirebileceği bir karar değildir.
  CBOM bu kısıtı *betimler*, bir migrasyon *önermez*.
- **Anahtar yaşam döngüsü yok.** Anahtarlar tek kullanımlık Devnet anahtarlarıdır; rotasyon,
  saklama (HSM/KMS) veya iptal mekanizması yoktur. `.env` (mode `0600`) ile tutulur, asla commit edilmez.
- **Gerçek değer yok.** Yalnızca Solana Devnet + Devnet USDC; ödemelerin parasal değeri yoktur.

## 4. Web3'e uyarlanabilir ara katman

CBOM, bu projede ödeme/zincir tarafına doğru doğal olarak genişleyebilen bir ara katmandır. Bugün
envanter uygulama-içi kriptoyu kapsar; aynı CycloneDX yapısı şu web3 varlıklarını da taşıyabilir:

- **Zincir varlıkları:** SPL token (Devnet USDC) mint adresi, program kimlikleri, CAIP-2 ağ kimliği
  birer `related-crypto-material`/referans olarak eklenebilir.
- **İmza şeması uyarlanabilirliği:** Ed25519 bileşeni, farklı zincirler için (ör. secp256k1/EVM)
  ikinci bir `cryptographic-asset` ile çoğaltılarak çok-zincirli bir ödeme katmanı belgelenebilir.
- **Facilitator güven modeli:** x402 protokol bileşeni, doğrulama/kesinleştirme sorumluluğunu
  (kendi facilitator'ımız vs. `x402.org`) `properties` ile ayırt edebilir.

Böylece CBOM, raporun "güvenlik değerlendirmesi / sınırlılıklar" bölümünü zenginleştiren,
uygulamanın ana araştırma sorularına (zamanlama, itibar tabanlı doğrulama, mikro-ödeme) dokunmayan
hafif bir belge katmanı olarak kalır.

## 5. Güncelleme

Bu envanter **elle** tutulur ve kripto yüzeyi değiştiğinde (yeni imza şeması, TLS eklenmesi, yeni
ağ) güncellenmelidir. İleride otomatikleştirmek istenirse CycloneDX ekosistemindeki CBOM tarama
araçları (ör. `cbomkit`) başlangıç noktası olabilir — ancak bunu sisteme gömmek kapsamı
"tedarik-zinciri güvenlik aracı"na kaydırır ve bilinçli bir karar gerektirir (bkz. [ROADMAP](ROADMAP.md)).
