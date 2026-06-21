# ⚫ Black Belt — Level 6

**Rise In gereksinimi:** Projenin Twitter profili + projeyle ilgili postlar; 30+ yeni kullanıcı onboard; Level 5'e göre daha advanced feature'lar; **Stellar Mainnet lansmanı**; gerçek mainnet kullanıcıları (en az 20); security review/audit; gerçek ekosistem adopsiyonu.

**Milestone (Nicole):** MAINNET'te canlı; 30+ onboard, 20+ gerçek mainnet kullanıcısı tx atıyor; advanced feature'lar ship'lendi; audit'li; ilk ekosistem-adopsiyon sinyali.

> ### 🎯 20 mainnet kullanıcı nasıl tutturulur (gerçek, dış)
> Blue'nun Season-0 power user'larını (zaten engaged, dış-kaynaklı) gerçek USDC micro-bounty/tipping çekişli bir mainnet **"Season 1"**'e migrate et — **gerçek para = dönüşüm kaldıracı.** Passkey ile onboarding ≤2 dk tut (mainnet drop-off minimize). ≥1 on-chain action tamamlayan **20+ DISTINCT mainnet signer** + kullanıcı başına settle olmuş gerçek USDC tip/bounty iste.

**Scope guard — YAPMA:** Henüz Master-tier partnership/fundraising kovalama; audit ortasında scope genişletme. Audit-öncesi feature freeze; sadece audit'li yüzeyi mainnet'e ship et. Audit'siz contract gerçek USDC tutmaz.

**Başarı metrikleri:**
- 30+ onboard, 20+ distinct mainnet signer (her biri ≥1 settle olmuş USDC action).
- Temiz/triaged audit raporu.
- ≥1 ekosistem partneri entegre ediyor veya co-promote ediyor.

---

## 🔧 Teknik tasklar

### Smart contract / on-chain (Tyler)
- **Mainnet launch:** 4 contract'ı Pubnet'e, taze, hardware-secured **(veya multisig)** admin key ile deploy. ⚠️ admin tek hot key DEĞİL — multisig veya timelock'lu governance. Tüm mainnet WASM hash'lerini kaydet.
- **Audit prep:** contract code freeze + threat model (drain path, replay, auth bypass, attester key compromise, integer overflow, archival/TTL DoS) + `cargo audit` + Soroban-odaklı static pass + harici review. 20-kullanıcı maruziyetinden önce bulguları düzelt.
- **Gerçek USDC:** canonical mainnet USDC SAC (Circle) entegre, treasury'yi gerçek USDC ile fonla, conservative per-claim cap + global daily payout cap (circuit breaker fn). ⚠️ gerçek para → **pausable/emergency-stop** admin fn (`require_auth`, `paused` flag tüm mutator'larda kontrol edilir).
- **Attester-key opsec:** signing key'leri HSM/KMS signer service'e taşı; `add_attester`/`remove_attester` ile redeploy'suz key-rotation.
- **Mainnet fee sponsorship at scale:** production channel-account pool + monitoring + sponsor account auto-refill; sponsor balance alerting.
- **Advanced feature'lar (vs Blue):** USDC micro-bounty market olgunluğu (escrow + dispute/expiry refund path) + insanları adlandıran shareable badge'ler (Orange'daki two-party co-mint, artık mainnet'te).
- Indexer/infra hardening: deep-history backfill (Hubble/Galexie veya RPC archive), monitoring/alerting, public read API + status page.

### Engineering / full-stack (Elliot)
- **Audit-readiness:** interface freeze, full doc, threat model, tüm clippy/audit-tool bulgularını düzelt. **AC:** audit firmasına frozen tagged commit + dokümanlar.
- **Fork + differential testler:** mainnet-fork state'e karşı test, replay senaryoları, invariant testler (total-score conservation, no-USDC-mint). **AC:** invariant + fork suite yeşil; contract coverage ≥%90.
- Mainnet deploy runbook: multisig admin key ceremony, staged rollout, contract-hash verification, rollback plan. **AC:** 3 contract mainnet'te, hash'ler verified, admin multisig'te.
- Mainnet USDC: gerçek USDC SAC trustline/SEP-41, paymaster funded, treasury limits. **AC:** gerçek USDC micro-bounty mainnet kullanıcısına ödendi.
- 30+ onboarding + Twitter/social share: co-signer'ları adlandıran shareable badge kartları, deep link, on-chain referral attribution. **AC:** 20+ mainnet kullanıcı gerçek tx ile, referral attribution track'leniyor.
- Advanced: USDC tipping at scale, vouch-graph reputation weighting, badge showcase. **AC:** weighted reputation leaderboard + payout'a yansıyor.
- Production observability + on-call: tx-failure/paymaster-drain/indexer-lag alerting, incident runbook, SLO. **AC:** paymaster-low ve indexer-lag alert'leri page atıyor.

---

## 🎨 UX / Frontend (Kaan)
- **Ekranlar:** mainnet/testnet mode indicator, gerçek-USDC micro-bounty + tipping flow, Twitter/X connect, 20+ mainnet kullanıcı için invite-link onboarding/first-run.
- **Delight mekaniği:** **USDC MICRO-BOUNTY + TIPPING** (harcanabilir reputation); tip, iki tarafı adlandıran "thank-you" collectible mint'liyor — viral artifact + gerçek para hareketi füzyonu.
- **Share yüzeyi:** badge/stamp mint'te X'e auto-post hook (image card + tag) + public passport URL (OG-image = crest kartı) → timeline'da güzel unfurl.
- **Onboarding:** invite-link onboarding (link tap → passkey → inviter'la ilk shared stamp) = en yüksek dönüşümlü acquisition loop; UI'da "audited" trust badge göster.
- **Empty states / safety:** mainnet ilk-tip confirmation (gerçek-para netliği), low-balance/failed-payment state, başkalarını adlandırmada scam/abuse guardrail.
- **Erişilebilirlik:** gerçek-para flow'larında explicit confirm + undo-window copy, payment CTA'larda büyük touch target, **mainnet vs testnet net görsel ayrım** (asla karıştırma).

---

## 📣 Product / GTM (Nicole)
- Mainnet contract yüzeyinin (stamp mint, stake/slash, bounty/tip settlement) audit'ini commission et; triage + fix.
- Mainnet **"Season 1"**'i gerçek USDC bounty/tip havuzuyla koştur; önce Blue power user'larını çevir.
- Tutarlı Twitter/X presence: ship log, leaderboard anları, user spotlight → onboarding sür.
- 1 ekosistem partneri (wallet, Stellar projesi veya topluluk) co-promotion/quest entegrasyonu için sırala.
- Subjektif-quest staked-quorum review'ı artık gerçek kur (ekonomik stake var).

---

## ✅ Definition of Done
4 contract mainnet'te (multisig admin, emergency-stop, gerçek USDC cap'leri); harici audit raporu temiz/triaged; 30+ onboard + 20+ distinct mainnet signer her biri ≥1 settle olmuş USDC action; ≥1 ekosistem partneri co-promote/entegre; Twitter aktif.

## ⛓️ Bağımlılıklar
Blue (power user kohortu + ölçek). Orange'daki upgradeability kararı burada enforce edilir. Çıktısı Master'ın partnership/yatırımcı hikâyesi.
