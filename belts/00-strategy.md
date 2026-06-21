# 🧭 Stellar Passport — Strateji & Kararlar (source of truth)

Bu doküman, belt dosyalarının (01–07) hepsini bağlayan cross-cutting kararları tutar. Çelişki olursa **bu doküman geçerlidir.**

---

## 1. Track / kategori kararı (objektif)

- **$20.000 prize pool = Builder Track / Belt Progression** (White→Master). **Kategori kısıtı YOK** — "build & ship real apps".
- Öncelik kategorileri (Payments, Stablecoins, RWA, Cross-border, Wallet infra, Financial tooling, AI+Blockchain, Anchor) **yalnızca ayrı Startup Track**'in ve onun ayrı parasının (InstaAward $15k / SCF $150k).
- **Passport = saf Builder-Track/$20k tüketici oyunu.** Hiçbir öncelik kategorisine girmiyor ve **girmesi gerekmiyor.** SCF için **ayrı bir proje** var.
- ⚠️ **Rise In'e doğrulat:** Aynı kişi iki track'e (Passport→Builder, diğer fikir→Startup) aynı anda girebilir mi? Metin net değil.
- "Infra/SDK/partner-portal" ürün yüzeyini **inşa etme** — belt jürisi composable primitive umursamıyor; o çekiştirme "iki-kitle ölümü" getirir.

---

## 2. North-star metrik

> **Haftalık "kapanan reputation loop" sayısı** = vouch'lanmış bir stamp'in, onu mint'leyenden **farklı** bir kullanıcı tarafından stake'lenip USDC'ye redeem edilmesi.

Neden belt-şekilli: jüri on-chain doğrular; captive kohort kendi kendine mint'leyerek sahteleyemez (counterparty + spend zorunlu); vanity install'la değil gerçek ağ kullanımıyla büyür.

---

## 3. En kritik tasarım kararı — cold-start fix

"İki kişi yan yana → tap-to-mint" bir solo builder için **neredeyse ölümcül** (boş-oda problemi). Çekirdek mekanik **async, tek-taraflı VOUCH**:

> A, henüz uygulamayı kurmamış olabilecek B'yi seçip ona **yarım-kart** mint'liyor — A'nın tarafı dolu, B'nin tarafı *parlayan boş yuva*. Kart anında paylaşılabilir ("X seni vouch'ladı. 1/1. Kendi tarafını claim et →") = **install funnel'ın kendisi.** B claim'leyince B'nin tarafı çiçek açıyor, ikisi de tam kartı alıyor.

- IRL "tap-to-mint" (NFC/QR collision-bloom) = **ikincil lezzet**, birincil hook değil.
- **KILL:** scrollable endorsement/skill grid (=LinkedIn). Sadece generative-art kart destesi; her kart tek insan + tek an. *"Asla yüz gösterebileceğin yerde sayı gösterme."*

---

## 4. SCF kapısını ~bedava aralık tutma politikası

- **1. günden canonical event emit et:** `attestation_set{addr, schema_id, issuer, value, ts}`. Event'ler append-only, **geriye dönük imkânsız** — atlanırsa tarihsel claim izi kaybolur.
- `get_attestation(addr, schema_id)` / `get_score(addr)` read-view'ı = **sonraki ucuz upgrade** (Orange upgradeability sayesinde migration'sız, ~30 dk). Read-only adapter, **asla ikinci write path** → iki-kitle mimari karmaşası yok.
- Leaderboard indexer + (gelecekteki) SCF integrator **aynı event'i** okur. Yani primitive off-chain tarafında da neredeyse bedava.
- **Şimdi inşa ETME:** schema registry, issuer registry (zaten allowlist var), revocation workflow (sadece `revoked` bool sakla), developer portal.

---

## 5. Retention de-risk (Green'de, erken)

Quest/rank'ten **ÖNCE tip/bounty rail'ini ship'le.** Spend *alan* kullanıcılarda **D7 dönüşünü** ölç. Yabancıdan gelen USDC geri getirmiyorsa hiçbir gamification getirmez — ödülü erken pivotla, tüm app'i değil.

---

## 6. Demo anı (odayı kazanan şey)

Jürinin eline **gerçek iPhone** ver → passkey **FaceID** → ilk on-chain action, sponsored, **<15s** (hedefi 8s tut, 15 vaat et). Ekranda **"Fees paid by app: $0.00"** + canlı saat. Mimari diagram writeup'ı kazanır; **jürinin kendi parmağı odayı kazanır.**

---

## 7. İki-proje kaynak kuralı

- **Passport = DEFAULT/primary; SCF fikri = interrupt.**
- Kural: Passport o hafta **gösterilebilir bir belt-loop artışı** ship'lemeden SCF'e saat harcanmaz. Zero artış olan hafta → SCF freeze.
- Ortak altyapı (passkey/wallet onboarding, contract pattern'leri) paylaş ki Passport işi SCF projesini **beslesin.** 50/50 bölme = ikisi de ölür (attention bankruptcy).

---

## 8. Belt-kazanma önceliği (Justin sıralaması)

1. **Demo polish / canlı çalışan kanıt** (en yüksek ağırlık).
2. **Traction sinyali** (20 gerçek kullanıcı > cilalı mock). Passport'un *zayıf* noktası — buraya yatır.
3. **Narrative tutarlılığı** (tek cümle; tüketici-saf kalırsa güçlü).
4. **Novelty** (en az belirleyici; "tap/vouch social reputation" yeterince taze, fazla yatırma).
