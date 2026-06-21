# 🟡 Yellow Belt — Level 2

**Rise In gereksinimi:** Multi-wallet entegrasyonu, smart contract'lar, transaction handling, real-time event senkronizasyonu.

**Milestone (Nicole):** Multi-wallet desteği + testnet'e deploy edilmiş bir Soroban contract'ı; stamp mint'liyor ve uygulamanın geri okuduğu event emit ediyor.

**Scope guard — YAPMA:** Bounty/USDC market, staking, quorum review YOK. Tek stamp tipi, tek mint path. Tipping ekonomisi yok. Reputation scoring'i fazla modelleme.

**Başarı metrikleri:**
- Vouch mint → claim → event read round-trip >%95 başarı (20 manuel koşu).
- Yarım-kart link'i ikinci bir cihazda açılıp claim edilebiliyor (async, koordinasyonsuz).
- 2+ wallet tipi connect oluyor.

---

## 🔧 Teknik tasklar

### Smart contract / on-chain (Tyler)
- **`Reputation` contract'ı scaffold et:** `Map<Address,u64>` XP (instance/persistent storage), `Map<(Address,BadgeId),Claim>` badge'ler. `award_xp`, `grant_badge`, `get_profile`, `revoke`. Transfer fn'i koymayarak non-transferable.
- Her mutasyonda yapısal event emit: `xp_awarded(addr, amount, source)`, `badge_granted(addr, badge_id, attester)`. Bu, indexer'ın kontratı — event topic/data şeklini **şimdi dondur**.
- ⚠️ **SCF kapısı için (00-strategy §4):** 1. günden **canonical `attestation_set{addr, schema_id, issuer, value, ts}` event'ini** emit et. Append-only, geriye dönük imkânsız — read-view'ı (`get_attestation`) sonraya bırakabilirsin ama event'i bırakamazsın.
- Auth modeli: `award_xp`/`grant_badge`/`revoke`'u admin/attester adresinde `require_auth` ile gate'le (instance storage `admin`). Public mint yok. Yetkisiz çağrı için `require_auth` unit testleri.
- ⚠️ **Storage TTL/archival:** badge/XP `persistent` storage — her write içinde `extend_ttl` bump; archived-entry restore akışını dökümante et. Persistent entry'ler archive olabilir; read'ler restore'u handle etmeli.
- Real-time event indexer kur: `getEvents` (RPC) contract ID + topic ile poll'la, küçük DB'ye yaz, leaderboard read API expose et. Yukarıdaki donmuş event şekline bağlı.
- Multi-wallet: TS client'ı 2+ passkey wallet yönetecek ve her birinden contract invocation atacak şekilde genişlet (Orange'daki tap-to-mint co-sign için gerekli).

### Engineering / full-stack (Elliot)
- `Reputation` contract v0 — **birincil mekanik ASYNC VOUCH** (cold-start fix, 00-strategy §3): `mint_vouch(from, to_handle_or_addr, note)` yarım-kart (pending) yaratıyor, `claim_vouch(to)` ikinci tarafı tamamlayıp iki score'u da artırıyor; `score(addr)`. **AC:** unit test yarım-kart mint'liyor, claim öncesi B'nin score'u artmıyor, claim sonrası iki taraf da artıyor + double-claim revert.
- (İkincil) `mint_stamp(a, b)` IRL iki-cüzdan co-sign stamp — opsiyonel lezzet, birincil değil.
- `QuestRegistry` contract v0: `register_quest`, `complete_quest(addr, quest_id, attester_sig)` allowlist'li attester pubkey kontrolü. **AC:** allowlist-dışı imzayı reddediyor, geçerli imzayı kabul ediyor.
- `stamp_minted` / `quest_completed` Soroban event'leri; event şemasını `/packages/shared`'da tanımla. **AC:** event'ler `stellar contract events` çıktısında.
- Multi-wallet co-sign/vouch UX: two-party tap-to-mint (deep link / QR handshake), multi-source auth tx. **AC:** iki test cüzdanı tek mint tx'i co-sign'lıyor, ikisi de on-chain.
- Real-time event consumer (ince): RPC `getEvents` polling → UI'a WebSocket/SSE. **AC:** stamp mint, ikinci tarayıcıyı <5s içinde güncelliyor.
- Sağlam tx handling: simulation, fee-bump/sponsored fee, `TRY_AGAIN_LATER` retry, restore-footprint. **AC:** sponsored fee + passkey ile tx, user cüzdanında 0 XLM.
- İki contract için unit testler (happy + auth-failure); CI `cargo test`. **AC:** tüm public fn'lerde coverage.

---

## 🎨 UX / Frontend (Kaan)
- **Ekranlar:** "ikinci cüzdan ekle" / wallet switcher, contract-interaction ekranı, real-time contract event'lerini akıtan canlı activity feed.
- **Delight mekaniği (BİRİNCİL):** **ASYNC VOUCH yarım-kart** — A, B'yi seçip ona vouch'luyor; A'nın tarafı dolu, B'nin tarafı *parlayan boş yuva*. Generative sigil A'nın wallet hash'inden tohumlanıyor; B claim'leyince B'nin tarafı seam'den çiçek açıp tam kartı oluşturuyor. Koordinasyon sıfır.
- **Share yüzeyi:** yarım-kart linki — "X seni vouch'ladı. 1/1. Kendi tarafını claim et →" (crypto kelimesi yok). Bu kart **install funnel'ın kendisi.** (İkincil: IRL tap-to-mint collision-bloom animasyonu, screen-record'lanabilir.)
- **Real-time hissi:** event toast'ları ("Stamp 4s'de confirmed") + on-chain confirm'de feed item animasyonu — sub-cent/sub-5s settlement'ı bir özellik olarak okunur kıl.
- **Empty state:** boş feed → "Henüz stamp yok — başlamak için bir arkadaşına bump'la" + iki-el illüstrasyonu.
- **Erişilebilirlik:** wallet switcher tek elle erişilebilir; mint animasyonu için reduce-motion (statik reveal) varyantı.

---

## 📣 Product / GTM (Nicole)
- **Stamp taxonomy v1:** hangi stamp'ler API/crypto-verifiable (auto-mint) vs subjektif (sonra staked quorum'a ertelenir) — verifiability sınırını kilitle.
- Co-sign/vouch human-reference mekaniğini kâğıt üstünde spec'le (kim vouch'layabilir, ne değişir) — henüz build etme.
- 3 shareable badge görsel konsepti çiz; 5 dış kontak ile DM'den "paylaşır mıydın?" valide et.
- Landing page + waitlist email capture; 2-3 dış topluluğu build-in-public postlarıyla ısıtmaya başla.

---

## ✅ Definition of Done
Testnet'te `Reputation` (+`QuestRegistry` v0) deployed; tap-to-mint shared stamp iki cüzdanla çalışıyor; event indexer leaderboard'u besliyor; real-time UI güncellemesi <5s.

## ⛓️ Bağımlılıklar
White (passkey + sponsorship + art engine). Çıktısı (Reputation contract + event şeması) Orange'ın cross-contract çağrılarının ön koşulu.
