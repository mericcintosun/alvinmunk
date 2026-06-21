# 🟢 Green Belt — Level 4

**Rise In gereksinimi:** Advanced smart contract'larla production-ready MVP; uygulamayı production'a hazırla.

**Milestone (Nicole):** Production-ready MVP — **çekirdek haftalık retention loop'u** testnet'te uçtan uca canlı.

> ### 🔁 Çekirdek haftalık loop (net tanım)
> Her hafta N taze quest düşer (çoğu auto-verifiable: did-a-tx, vouched-N-people, referred-a-friend). Kullanıcı commit için reputation/küçük USDC **stake'ler** → tamamlar → reputation + haftalık stamp kazanır → rank güncellenir → rank **gerçek bir fayda açar** (bounty-board erişim kademesi, daha yüksek tipping limiti, exclusive badge, fee indirimi). Haftayı kaçır = stake slash / streak reset. **Rank bir şey SATIN ALMALI, yoksa mint-and-forget.**

**Scope guard — YAPMA:** Henüz user scale etme, mainnet yapma, tam açık bounty marketplace yapma — sadece rank'i önemli kılan minimum spend-sink. Subjektif-quest quorum'unu tam kompleksiyle yapma; stub'la. Feature genişliği değil, loop'ta derinlik.

> ⚠️ **SIRALAMA (00-strategy §5):** Quest/rank motorundan **ÖNCE tip/bounty USDC rail'ini** ship'le ve D7 retention'ı ölç. "Yabancıdan USDC almak geri getiriyor mu?" sorusu en ucuz şekilde burada cevaplanır. Cevap hayırsa ödülü pivotla — tüm app'i değil.

**Başarı metrikleri:**
- **North-star (00-strategy §2):** haftalık "kapanan reputation loop" sayısı artıyor (vouch → stake → *farklı* kullanıcı USDC redeem).
- **Retention de-risk:** USDC spend *alan* kullanıcılarda D7 dönüşü ölçüldü (asıl sinyal bu).
- Alpha pod'da Week-1→Week-2 dönüş oranı ≥%30.
- Aktif kullanıcıların ≥%60'ı haftalık quest'leri tamamlıyor.

---

## 🔧 Teknik tasklar

### Smart contract / on-chain (Tyler)
- **`Rewards` contract:** XP threshold-gated `claim_reward` (cross-contract read `Reputation.get_profile`), USDC SAC payout (`token::Client::new` → `transfer`). Per-(reward_id, address) replay guard.
- **Treasury modeli:** Rewards USDC tutuyor veya treasury'den `require_auth` ile çekiyor; admin deposit/withdraw fn'leri. ⚠️ payout path drain edilemez olmalı — per-claim cap + threshold check ile sınırla.
- Tipping: direkt wallet→wallet USDC SAC transfer + opsiyonel `tipped` event (sosyal feed). Saf SAC transfer ise yeni contract gerekmez.
- **Production hardening:** her fn'de deny-by-default auth audit, integer overflow (`checked_add`), panic yerine explicit error enum (`contracterror`). Award/claim matematiğinde property/fuzz testleri.
- **Storage TTL stratejisi:** instance vs persistent için makul `bump_ledgers`; hot entry'lerde (admin config, attester list) TTL extend eden keeper job. ⚠️ instance storage archival kontratı bricklerler — agresif bump.
- Indexer → production: polling'den durable cursor'a (last-processed ledger), reorg handling, event-ID keyed idempotent upsert. Profile + leaderboard + bounty API.
- Hâlâ Testnet; release candidate üret: deterministik build (`stellar contract build`), WASM hash kayıtlı, deployment runbook yazılı.

### Engineering / full-stack (Elliot)
- Production-hardening: checked arithmetic, reentrancy/auth review, admin/upgrade pattern, event versioning. **AC:** clippy pedantic temiz, contract path'lerinde `unwrap` yok.
- Smart-wallet onboarding cilası: passkey create/recover, sponsored-fee paymaster service, session handling. **AC:** sıfır-crypto kullanıcı seed-phrase'siz onboard, fee sponsored.
- Backend hardening: attester key KMS/secrets manager'da, rate limiting, claim'de nonce replay protection, idempotent indexer ingestion. **AC:** replay'lenen claim reddediliyor; indexer event re-delivery'de dup üretmiyor.
- Observability: structured logs, Prometheus metrics, Sentry, health/readiness endpoint'leri. **AC:** dashboard tx success rate / indexer lag / attester latency gösteriyor.
- Staging env (prod ayna): managed Postgres, IPFS pinning, HTTPS arkası servisler. **AC:** dış tester staging URL'den tüm app'i çalıştırabiliyor.
- E2E (Playwright) core flow + indexer/attester load test. **AC:** E2E suite CI'da yeşil.
- Performance/UX: mint'lerde optimistic UI, skeleton loader, mobile-first responsive. **AC:** Lighthouse mobile ≥90.

---

## 🎨 UX / Frontend (Kaan)
- **Ekranlar:** production passport profile (handle, crest, stat row: stamp/vouch/people-named), badge gallery, settings/recovery, polished share-sheet modal.
- **Delight mekaniği:** **İNSANLARI ADLANDIRAN BADGE'LER** — milestone badge'leri otomatik üretiliyor ("Connector: 5 kişiye vouch'ladı") + thank-you/tip-back micro-stamp sosyal loop'u kapatıyor.
- **Share yüzeyi (hero shareable):** auto-generated Badge Card — generative art + adlandırılan insanlar + crest + app handle/QR; "Share to X" primary action.
- **Onboarding:** passkey edge case'leri sertleştir — multi-device, account recovery, lost-device path — net insancıl copy.
- **Empty states:** her gallery/section'da tasarlanmış empty + "almost there" near-complete state (bir sonraki milestone'a çek).
- **Erişilebilirlik (tam geçiş):** contrast AA, dynamic type, generative art'a screen-reader alt-text, offline/zayıf-ağ state'leri.
- ⚠️ **Sequence:** tüm kart tiplerinin visual-regression baseline'ını ship et — sonraki belt'ler share artifact'larını sessizce kırmasın.

---

## 📣 Product / GTM (Nicole)
- Haftalık quest takvimini (4-haftalık rolling) + net rank→reward unlock tablosunu dökümante et.
- Alpha pod'u recurring haftalık-aktif kohorta çevir; Blue'dan önce loop'u **2+ ardışık hafta** canlı koştur.
- Retention analytics dashboard (WAU, hafta-üstü-hafta dönüş, quest completion, stake-slash rate).
- "Neden Pazartesi geri gel" hook mesajı + push/notification copy.
- Pitch-deck iskeleti (problem, loop, erken retention sayıları) — metrikler geldikçe doldur.

---

## ✅ Definition of Done
Haftalık loop testnet'te 2+ hafta canlı koştu, ölçülen Week-1→2 retention ≥%30. Rewards contract production-hardened (checked math, error enum, caps). Staging env dış tester'a açık. Pitch-deck iskeleti hazır.

## ⛓️ Bağımlılıklar
Orange (3 contract + attester + indexer). Bu loop, Blue'nun 50-kullanıcı ve Black'in mainnet sezonlarının çekirdeği.
