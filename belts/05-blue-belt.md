# 🔵 Blue Belt — Level 5

**Rise In gereksinimi:** Ürünü 50 kullanıcıya ölçekle, kullanıcı feedback'ine göre iyileştir, profesyonel pitch deck + demo hazırla.

**Milestone (Nicole):** 50 **GERÇEK dış kullanıcı** onboard edildi ve haftalık loop'tan geçirildi; yapılandırılmış feedback + pitch deck/demo hazır.

> ### 🎯 50 kullanıcı nasıl tutturulur (kohort DEĞİL, dış)
> Isıtılmış Discord/topluluklar + Twitter build-in-public kitlesinden seed et. Zaman-kutulu bir **"Season 0"** lansmanı koştur: public haftalık quest + arkadaş getirene reputation veren referral quest (viral katsayı) + crypto-curious'u çeken küçük USDC bounty havuzu. **50'nin <%20'si Rise In kohortundan** gelsin, gerisi dış kanallardan. 1-2 topluluk mod'uyla sezonu co-host et.

**Scope guard — YAPMA:** Mainnet'e geçme, audit'e başlama, advanced feature ekleme. 50-kullanıcı ölçeğinde loop'u stabilize et; retention sızıntılarını gider, yeni yüzey açma. Erken token/ekonomi genişlemesi yok.

**Başarı metrikleri:**
- ≥50 onboard, <%20'si program kohortundan.
- WAU ≥25 (tabanın %50'si).
- Hafta-üstü-hafta retention ≥%25.
- Referral quest viral katsayısı ölçüldü (>0.3 hedef).

---

## 🔧 Teknik tasklar

### Smart contract / on-chain (Tyler)
- Yeni core contract YOK; 50 kullanıcı için scale + observability. RPC redundancy (primary + fallback), client retry/backoff, her invocation'da submit-öncesi simulation (fee/auth hatalarını pre-flight yakala).
- Contract event stream'i metriklere bağla (claim/gün, mint'lenen XP, failed auth) — feedback iterasyonunu ve pitch deck'i besler.
- ⚠️ **#1 scaling cliff:** sponsor/fee-bump path'ini load-test et — 50 eşzamanlı passkey kullanıcı = sponsor account sequence-number darboğazı. Fee sponsor için **channel-account pool** ile submission'ları paralelleştir.
- Feedback'ten contract param'larını admin fn ile iterate et (XP threshold, quest config, reward cap) **redeploy olmadan** — Orange'daki upgradeability/admin-config kararını valide eder.
- Client'a config-driven contract-ID registry (aynı build staging vs prod'a point edebilsin — Black'teki mainnet swap'a hazırlık).

### Engineering / full-stack (Elliot)
- Feature-flag + config sistemi: quest/reward'ı redeploy'suz iterate et. **AC:** yeni quest tipi config'le eklendi, contract redeploy yok.
- Analytics + funnel instrumentation (onboard→ilk stamp→ilk claim) 50-kullanıcı kohortu için. **AC:** dashboard gerçek kullanıcılar için adım-adım dönüşüm gösteriyor.
- Feedback loop tooling: in-app feedback widget, bug intake, wallet'a bağlı (privacy-respecting) telemetry. **AC:** feedback session/tx'e map'leniyor (repro).
- Iteration backlog: 50-kullanıcı testinden top-N fix'i ship et, her fix'e regression test. **AC:** her ship'lenen fix bildirilen davranışı pinleyen teste sahip.
- Demo/pitch desteği: stable demo seed environment + scripted demo flow + reset script. **AC:** tek-komut demo reset.
- **Anti-abuse v1:** stamp mint rate-limit, indexer'da collusion/self-vouch loop tespiti. **AC:** self-vouch ve rapid-fire mint pattern'leri flag/throttle.
- Leaderboard read scale: caching/materialized view 50+ kullanıcı için. **AC:** leaderboard p95 <200ms.

---

## 🎨 UX / Frontend (Kaan)
- **Ekranlar:** leaderboard UI (self-stat değil, **bağlanılan insan** sayısına göre), in-app feedback widget, passport için demo/pitch mode.
- **Delight mekaniği:** LEADERBOARD sosyal çerçeveli — "en bağlantılı", "haftanın top voucher'ı" + haftalık recap kartı ("6 insan bağladın", auto-shareable).
- **Feedback-capture UI:** key action sonrası hafif in-context prompt (thumbs + tek satır) + NPS/"paylaşır mıydın?" micro-survey + tagged bug/idea reporter; **share-button tap'lerini çekirdek funnel metriği olarak** instrument et.
- **Share yüzeyi:** Weekly Recap Card + leaderboard-rank brag kartı ("#3 en bağlantılı") — 50-kullanıcı kohortunun postlaması için.
- **Empty states:** az kullanıcılı leaderboard → "10 insanı bağlayan ilk kişi ol"; feedback widget submit sonrası thanks-state.
- **Erişilebilirlik:** leaderboard satırları tek elle okunur, feedback widget keyboard/screen-reader uyumlu, demo mode projektörde çalışır (büyük tip, yüksek kontrast).

---

## 📣 Product / GTM (Nicole)
- **"Season 0"**: public quest takvimi + referral mekaniği + küçük bounty havuzu = acquisition yakıtı.
- 1-2 dış topluluk co-host/ambassador recruit et; leaderboard'da pay ver.
- Feedback'i sistematize et: haftalık NPS + churned-user exit micro-survey + top-friction triage.
- Pitch deck'i finalize et + 2-dk demo kaydet (GERÇEK retention/viral sayılarıyla).
- Power user kohortunu belirle → Black için aday mainnet erken-adopter'lar.

---

## ✅ Definition of Done
≥50 gerçek dış kullanıcı (<%20 kohort), WAU ≥25, hafta-üstü retention ≥%25, viral katsayı ölçüldü. Channel-account pool ile fee-sponsor darboğazı çözüldü. Profesyonel pitch deck + 2-dk demo gerçek sayılarla hazır.

## ⛓️ Bağımlılıklar
Green (haftalık loop). Çıktısı (power user kohortu + ölçek altyapısı) Black'in mainnet sezonunu besler.
