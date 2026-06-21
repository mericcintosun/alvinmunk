# ⚪ White Belt — Level 1

**Rise In gereksinimi:** Wallet kur, balance yönet, ilk on-chain transaction'ını gönder.

**Milestone (Nicole):** Kullanıcı passkey-destekli smart-account cüzdanı oluşturabiliyor/kurtarabiliyor, balance okuyabiliyor ve uygulama içinden ilk imzalı testnet ödemesini gönderebiliyor.

**Scope guard — YAPMA:** Stamp, reputation, quest, sosyal mekanik YOK. Backend yok, leaderboard yok, contract logic yok — sadece cüzdan + balance + tek tx. "Passport şeması" tasarlamaya kalkma.

**Başarı metrikleri:**
- Test cihazlarının %100'ü passkey create → ilk-tx akışını <2 dk'da tamamlıyor.
- İlk testnet tx'i on-chain confirmed.

---

## 🔧 Teknik tasklar

### Smart contract / on-chain (Tyler)
- Dev altyapısını önce kur: `stellar-cli` ve Soroban Rust SDK versiyonlarını pinle, `contracts/` workspace cargo projesi (shared `Cargo.toml`). Her belt bunun üstüne biner.
- Testnet RPC endpoint + Friendbot funding script; account creation, balance read (`getAccountEntry`/Horizon) ve ilk classic payment tx'ini ince bir TS client'ta sar (`@stellar/stellar-sdk`).
- **Passkey smart-wallet onboarding iskeletini ŞİMDİ kur** (her sosyal özellik buna bağlı): passkey-kit/smart-wallet contract (secp256r1 `__check_auth`) entegre et. Wallet factory'yi testnet'e deploy et; passkey ile tx imzala+doğrula.
- Fee sponsorship'i sponsor account + fee-bump tx ile bağla (`TransactionBuilder` → `buildFeeBumpTransaction`). End-user 0 XLM tutarken tx attığını doğrula.
- ⚠️ **Flag:** smart-wallet `__check_auth` + signer storage TTL her kullanımda bump'lanmalı — bump pattern'i burada kur, sonraya bırakma.

### Engineering / full-stack (Elliot)
- Monorepo init (pnpm/turborepo): `/contracts`, `/apps/web` (Next.js), `/services`, `/packages/shared`. **AC:** temiz clone'dan `pnpm install && pnpm build` yeşil.
- Stellar tooling scaffold: `stellar-cli` pin, `Makefile`/scriptler (build/test/deploy), testnet network alias. **AC:** `make build` boş workspace'i derliyor.
- Frontend wallet connect: Stellar Wallets Kit + passkey smart-wallet flow; cüzdan oluştur, XLM balance RPC'den çek. **AC:** connect → fonlanmış testnet adresi + balance görünüyor.
- İlk payment tx: UI'dan classic XLM payment build/sign/submit; tx hash + RPC status göster. **AC:** kullanıcı XLM gönderiyor, confirmed ledger + explorer linki görüyor.
- Friendbot funding helper + unfunded account error surfacing. **AC:** yeni account testnet'te auto-fund.
- CI baseline: GitHub Actions → `cargo fmt --check`, `cargo clippy`, `pnpm lint`, `pnpm typecheck`. **AC:** kırmızı CI merge'i blokluyor.

---

## 🎨 UX / Frontend (Kaan)
- **Ekranlar:** passkey onboarding (FaceID, sıfır seed-phrase), tek canlı balance'lı wallet home, "ilk tx'ini gönder" akışı, post-tx receipt.
- **Delight mekaniği:** İlk transaction bir **"Genesis Stamp"** mint'ler — wallet adresinden türetilen deterministik generative-art (renk/şekil DNA'sı), böylece her pasaport ikinci saniyeden itibaren benzersiz.
- **Share yüzeyi:** "Passport Cover" kartı (generative crest + handle + katılım tarihi) + tek-tap "Save image" — ilk screenshot'lanabilir artifact.
- **Onboarding:** max 3 tap — FaceID → handle seç → fonlanmış testnet cüzdanına in; skeleton shimmer, asla boş balance.
- **Empty state:** ilk-tx öncesi home'da kesik çizgili "ghost stamp" placeholder: "İlk stamp'in buraya düşecek".
- **Erişilebilirlik:** thumb-zone CTA, 44px+ hedefler, biometrik → PIN fallback; renk-DNA'sı **şekil de** kodlamalı (renk-körü için sadece-renk olmaz).
- ⚠️ **Sequence:** generative-art seed sistemi + design-token paleti BURADA kilitlenir; tüm downstream (stamp, badge, kart) bu motoru tekrar kullanır.

---

## 📣 Product / GTM (Nicole)
- Tek cümlelik ürün vaadi + tek "aha" anını (tap → shared stamp mint) yaz, her belt için pinle.
- Hem App Store blurb hem tweet olarak kullanılabilir value-prop cümlesi.
- 2-3 aday **DIŞ topluluk** (Stellar Discord'ları, mobil-first crypto-curious gruplar, niş hobi/creator topluluğu) belirle, şimdiden lurk'le/kontak logla — henüz pitch yok.
- Activation event'ini net tanımla (wallet created **AND** ilk stamp minted) — sonraki funnel tracking için.

---

## ✅ Definition of Done
Passkey cüzdan + sponsored-fee ile imzalanmış **tek on-chain testnet tx**. Genesis Stamp generative-art motoru + design tokens kilitli. Monorepo + CI yeşil.

## ⛓️ Bağımlılıklar
Yok — temel. Çıktısı (passkey + sponsorship + art engine) Yellow'un ön koşulu.
