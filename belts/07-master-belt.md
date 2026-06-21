# 🏆 Master Belt — Ecosystem Acceleration

**Rise In gereksinimi:** Black Belt'ten en iyi projeler final ekosistem-akselerasyon aşamasına girer — uzun-vadeli scaling, partnership, startup growth, yatırımcı görünürlüğü, ekosistem genişlemesi.

**Milestone (Nicole):** Kanıtlanmış retention + mainnet ekonomi metrikleri üstüne kurulu; gösterilmiş scaling path, ≥1 somut partnership, aktif yatırımcı görünürlüğü.

**Scope guard — YAPMA:** Yatırımcı kovalamak için çekirdek loop'u pivot etme; imzalı niyet olmadan partner için spekülatif feature over-build etme. Kanıtlanmış retention'ı vanity growth-hack için takas etme. Her partner talebinden scope creep'e diren.

**Başarı metrikleri:**
- Sürdürülen WAU büyüme trendi (çok-sezonlu retention eğrisi yukarı-sağa).
- ≥1 imzalı partnership/entegrasyon.
- Yatırımcı pipeline'ı (≥3 nitelikli görüşme veya akışta SCF/grant başvurusu).

---

## 🔧 Teknik tasklar

### Smart contract / on-chain (Tyler)
- **Upgradeability governance:** contract'lar upgradeable ise admin'i timelock'lu proper on-chain governance/multisig'e taşı, upgrade policy yayınla. Immutable ise migration contract + state-export path tasarla (v2).
- **Partnership/integration yüzeyi:** temiz cross-contract integration ABI + SDK; başka Stellar dApp'leri reputation okusun (`get_profile`) ve allowlist altında XP award'lasın — **reputation-as-a-primitive** (ekosistem genişlemesi).
- **Long-term storage/TTL ekonomisi:** ölçekte archival maliyetini modelle, TTL keeper'ı funded infra olarak otomatikleştir, state-rent/archival-restore UX (eski profiller erişimde auto-restore).
- **Data layer scale:** indexer'ı shard'la (contract/event), read replica + cache, investor/ekosistem metrikleri için dedicated analytics pipeline (Hubble).
- **Multi-issuer/asset:** Rewards + bounty market'te USDC ötesi configurable SAC adresi (geniş partnership).
- **Decentralization path (opsiyonel, dürüst trade-off):** allowlist'li attester → staked/permissionless attestation (m-of-n threshold + staking/slashing) — sadece adopsiyon kompleksiteyi haklı çıkarırsa. Boring allowlist düşündüğünden uzun süre yeterli.

### Engineering / full-stack (Elliot)
- Scale infra: horizontal indexer (sharded), read replica, badge art CDN, multi-region API. **AC:** 10x yük altında stable p95.
- Contract upgrade/governance: timelock'lu upgrade, parametre governance, state migration tooling. **AC:** fork'ta dry-run state migration value-loss'suz başarılı.
- **Partnership SDK/API:** public attester onboarding (3rd-party quest provider) + dökümante quest-attestation spec + SDK package. **AC:** harici partner quest register'lıyor ve verifiable claim issue'luyor.
- Investor/scale metrik pipeline: cohort retention, reputation velocity, payout volume, viral coefficient dashboard. **AC:** board-ready metrikler indexer/warehouse'tan auto-refresh.
- Multi-attester decentralization: threshold m-of-n imza, attester staking/slashing tasarımı. **AC:** quest completion m-of-n attester gerektiriyor; tek-attester compromise yetersiz.
- Cost/treasury automation: dynamic fee-sponsorship budgeting, USDC treasury reconciliation, funding alert. **AC:** paymaster + bounty treasury policy limit'leri içinde auto-replenish.
- Security continuity: bug bounty programı, periyodik audit, CI'da dependency/supply-chain scan. **AC:** bug bounty canlı; CI critical CVE'de fail.

---

## 🎨 UX / Frontend (Kaan)
- **Ekranlar:** partner/branded passport yüzeyleri (event/topluluk için co-branded stamp), creator dashboard/analytics, investor-facing public metrics sayfası.
- **Delight mekaniği:** **PARTNER-STAMP DROPS** — topluluklar IRL event'lerde co-branded shared stamp mint'liyor (TAP-TO-MINT booth'ları); scarcity/edition-numbered art → collectible + FOMO-shareable.
- **Share yüzeyi:** edition-numbered event stamp kartları ("#42 of 500, [event]'te mint'lendi") + sezonluk "passport wrapped" recap (yıl-sonu brag artifact'ı).
- **Onboarding:** white-label/partner theming + event organizer için bulk-invite; passkey çekirdeği değişmeden.
- **Empty states:** partner dashboard ilk-drop öncesi "ilk stamp'ini oluştur" wizard; analytics zero-data preview.
- **Erişilebilirlik:** design system'i dökümante token/component library olarak enforce et (partner inaccessible co-branded kart ship'leyemesin); global partnership için localization-ready layout.

---

## 📣 Product / GTM (Nicole)
- **Data hikâyesini paketle:** retention eğrileri, viral katsayı, mainnet USDC hacmi, cohort LTV proxy.
- **SCF / ilgili grant round'a başvur** (InstaAward'a ≤$15k, SCF'e ≤$150k aday); warm yatırımcı listesi + intro görüşmeleri.
- En güçlü Black partner sinyalini imzalı entegrasyon/co-marketing'e çevir.
- Scaling GTM tanımla: ambassador programı, multi-community sezon franchising, self-serve bounty creation.
- Sürdürülebilirlik/ekonomi modeli anlatısı (fee/spend-sink'ler loop'u uzun vadede nasıl fonluyor).

---

## ✅ Definition of Done
Çok-sezonlu yukarı-trend retention; reputation-as-a-primitive SDK ile ≥1 imzalı partner entegrasyonu; SCF/grant başvurusu akışta; board-ready metrik dashboard; governance/multisig + bug bounty canlı.

## ⛓️ Bağımlılıklar
Black (mainnet + audit + ekosistem sinyali). Bu, programın finali — ekosistem fonlama (InstaAward/SCF) ve startup büyüme kapısı.

---

### 🔗 Cross-cutting flag'ler (tüm belt'ler boyunca)
- **Auth:** `require_auth` + deny-by-default — her belt, her fn.
- **Storage TTL/archival:** Yellow'dan itibaren her write'ta bump; instance archival = brick riski.
- **Upgradeability:** kararı Orange'da ver, Black'te enforce et.
- **Dış kullanıcı:** Blue (50) ve Black (20 mainnet) gate'leri program kohortuyla DEĞİL, gerçek dış topluluklarla geçilir (Nicole'ün anti-incest uyarısı).
- **Verifiability:** sadece kriptografik/API-doğrulanabilir quest'ler on-chain'e naked girer; subjektif olanlar staked quorum.
