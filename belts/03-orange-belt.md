# 🟠 Orange Belt — Level 3

**Rise In gereksinimi:** Komple bir mini dApp — advanced smart contract'lar, testing, deployment.
**Not:** Bu belt'ten sonra **💡 Idea Submission Stage** var — Rise In ekibi fikri onaylamalı. Bu repodaki konsept + rakip analizi + PRD ile güçlü bir dosya sun.

**Milestone (Nicole):** Testnet'e deploy edilmiş komple vertical-slice mini dApp — onboard → shared stamp mint → profilde gör → link paylaş — otomatik testler + public testnet URL ile.

**Scope guard — YAPMA:** Retention loop (recurring quest/stake) veya spend market YOK. Haftalık cadence yok, "rank bir şey satın alır" yok. Tek-session shareable akış. Erken scaling/infra yok.

**Başarı metrikleri:**
- E2E test suite yeşil.
- 10 dış tester (program kohortu DEĞİL) share akışını tamamlıyor.
- Share link → yeni-ziyaretçi dönüşümü en az 1 kez gözlendi.

---

## 🔧 Teknik tasklar

### Smart contract / on-chain (Tyler)
- **`QuestRegistry` contract:** `create_quest`, `award_quest` (allowlist-gated + replay guard), `add_attester`/`remove_attester`, `verify_sig`. Attester allowlist'i instance storage'da; quest config persistent storage'da.
- **Replay guard:** `Map<(QuestId, Address), bool>` claimed-set (persistent), `award_quest`'te atomik check-and-set. Double-claim'in revert ettiğini kanıtlayan unit testler.
- **Signed-claim oracle:** `verify_sig`, `(quest_id, recipient, nonce)` üzerindeki ed25519 attester imzasını `env.crypto().ed25519_verify` ile doğruluyor. Nonce replay set'te → reuse engellenir.
- **Cross-contract call:** `QuestRegistry.award_quest` → `Reputation.award_xp`/`grant_badge` (typed client `reputation::Client::new`). Reputation, QuestRegistry contract adresini `require_auth` etmeli (Reputation'ın attester'ı = QuestRegistry contract). **Bağımlılık:** Reputation (Yellow) önce deploy.
- **Tap-to-mint shared stamp:** iki cüzdanın tek tx'te co-sign'ladığı (tek invocation'da multi-`require_auth`) mutual badge mint. `mock_all_auths` + explicit per-address auth testleri.
- **Testing depth:** tam unit + integration (`Env::default`, `register_contract`) + bir fork/integration testi (Testnet'e karşı). 3 contract'ı Testnet'e deploy et; contract ID'lerini deployment manifest'e yaz.
- ⚠️ **Upgradeability kararını BURADA flag'le:** tüm contract'lara `require_auth`-gated `upgrade(new_wasm_hash)` (`env.deployer().update_current_contract_wasm`) ekle **VEYA** immutability'ye commit et. Şimdi karar ver; mainnet'te retrofit acı verir.

### Engineering / full-stack (Elliot)
- **`Rewards` contract:** reputation → USDC micro-bounty payout (SAC/USDC), tipping `tip(from,to,amount)`. **AC:** claim USDC SAC transfer ediyor, double-claim reddediliyor.
- Cross-contract wiring: `Rewards` → `Reputation.score`, `QuestRegistry` eligibility gate; interface'leri shared crate'te. **AC:** integration test 3 contract'ı uçtan uca kapsıyor.
- **Attester service (gerçek):** Express/Fastify, allowlist'li keypair, auto-verify quest = merge'lenmiş GitHub PR (API) + referral-wallet-real-tx kontrolü, signed claim döndürüyor. **AC:** merge'lenmiş PR → on-chain redeem edilebilir geçerli sig.
- **Indexer service:** Soroban event → Postgres, leaderboard + profile API; IPFS badge art pin. **AC:** leaderboard endpoint on-chain score'ları event'ten <10s sonra yansıtıyor.
- Komple mini-dApp UX: profile, badge gallery, quest list, leaderboard, claim/tip butonları contract'lara bağlı. **AC:** tam yolculuk (connect→quest→claim→tip) testnet'te çalışıyor.
- **FULL test suite:** unit + integration + fuzz (proptest: amount/score/overflow) + attester/indexer API testleri. **AC:** CI coverage gate ≥%80 contracts.
- Testnet deploy pipeline: 3 contract scripted deploy, `/packages/shared`'da address registry, seed data scripti. **AC:** `make deploy-testnet` reproducible adresler + binding'ler.
- CI/CD: main merge'te build+test+deploy-to-testnet; WASM hash logla. **AC:** yeşil main otomatik testnet staging'e deploy.

---

## 🎨 UX / Frontend (Kaan)
- **Ekranlar:** tam mini-dApp loop — profile/passport (stamp grid), stamp detail, vouch/co-sign action sheet, error/failed-tx recovery.
- **Delight mekaniği:** **VOUCH** — başka bir insanı co-sign'la; onları adlandıran küçük collectible mint'liyor ("Kaan, Alvin'e vouch'ladı"). Her micro-action kendi kartı = "başkası hakkındaki itibar viral".
- **Share yüzeyi:** Vouch Card (iki handle + ilişki satırı + generative motif) + ön-doldurulmuş share caption + mint'e geri dönen deep link.
- **Onboarding:** returning-user fast path (FaceID → direkt passport) + vouch butonunda first-run coachmark.
- **Empty states:** 0 stamp'li passport → "starter quest" checklist; failed tx → korkutucu olmayan retry kartı, asla ham error code.
- **Erişilebilirlik:** stamp grid accessible list (her stamp'e label), küçük ekran testi (yatay scroll yok).
- ⚠️ **Sequence:** kart layout template'i + share/deep-link altyapısını burada finalize et — Green/Blue sadece kart tipi ekler, yeni altyapı değil.

---

## 📣 Product / GTM (Nicole)
- Isıtılmış topluluklardan 10-kişilik **dış alpha pod** (program kohortu DEĞİL) recruit et; moderated walkthrough.
- Share funnel'ı instrument et: mint → share → click → install → activate; drop-off yakala.
- Referral/share copy + bir insanın adını/handle'ını render eden OG-image badge (viral kanca).
- 5 feedback call → Green'i besleyen sıralı friction listesi.
- **Twitter/X hesabını aç;** haftalık build-in-public cadence başlat (gelecekteki kullanıcı tabanını ek).

---

## ✅ Definition of Done
3 contract testnet'te, cross-contract çalışıyor; attester service merge'lenmiş PR'ı doğruluyor; indexer leaderboard'u besliyor; full test suite + fuzz yeşil; 10 dış tester share akışını tamamladı. **Idea Submission dosyası hazır.**

## ⛓️ Bağımlılıklar
Yellow (Reputation + event şeması). Upgradeability kararı burada verilir, Black'te enforce edilir.
