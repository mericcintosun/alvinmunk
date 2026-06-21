# 🛡️ Anti-Sybil & Abuse — Kararlar (source of truth)

Red-team + Tyler (savunma) + Justin (ekonomi) turundan çıkan **kesin kararlar.** Async-vouch'un bütünlüğü ve north-star'ın sahtelenemezliği buna bağlı. Çelişki olursa bu doküman + [00-strategy](./00-strategy.md) geçerlidir.

## Tehdit (red-team özeti)
Ücretsiz vouch + sponsored gas + frictionless passkey wallet = **saat başına ~1.000 sahte hesap, sıfır marjinal maliyetle on binlerce "kapanan loop".** En ölümcül tek özellik: **ücretsiz, self-initiable vouch'ta iki tarafın da XP kazanması + XP'nin USDC'ye dönüşmesi.** "Sadece stake ekle" saldırıyı durdurmaz (saldırgan iki tarafı da sahiplenip stake'i geri döndürür).

---

## KEYSTONE KARAR — Para ile eğlenceyi ayır (two-track)

> **Social XP (cashable DEĞİL):** vouch/sosyal eylemlerden kazanılır. Leaderboard, rozet, rank, tipping *limiti*, eğlence. **Hazineye ASLA doğrudan erişmez.**
>
> **Earned XP (USDC eligibility):** **yalnızca attester-doğrulanmış quest'lerden** (kriptografik/API ile doğrulanabilir eylemler). Rewards kontratı **yalnızca Earned XP'yi** okur.

Bu, sybil'in tüm ekonomik motivasyonunu keser: vouch farm'lamak **clout** kazandırır, **nakit** değil. Eğlence korunur (sosyal katman frictionless kalır), hazine güvende.

---

## Kararlar (belt-realistic)

### 1. Vouch mekaniği — "free" hissini koru ama spray/ring'i durdur
- **XLM/USDC ücreti YOK** (eğlenceyi öldürür). Bunun yerine **XP-stake:** vouch, voucher'dan küçük bir Social XP escrow'lar; 7 gün içinde claim olursa iade, olmazsa **slash**. Her yeni cüzdana **starter Social XP** ver (ilk vouch bedava hissetsin).
- **Asimetrik ödül:** claimer claim'de XP alır; **voucher bonusu ancak claimer sonradan *doğrulanmış* bir eylem yaptığında** açılır (2nci-derece kapı). Saf ring auto-confirm'i kırar.
- **first-pair-only:** aynı (from→to) çifti **yalnızca ilk kez** XP üretir; tekrarlar 0 XP (kart yine basılır, eğlence durur ama pump durur). → self-collusion ileri-geri pompasını öldürür. **[on-chain, ucuz — MVP'de var]**
- **Günlük cap:** hesap başına max N vouch/gün. **[on-chain]**

### 2. Hazine (USDC) yolu sertleştirme
- **Yalnızca Earned XP (attester-imzalı quest) hazineyi açar** — vouch'lar değil. (Keystone)
- **Proof-of-funding (KYC DEĞİL):** bir cüzdan `claim_reward`/cash-out yapabilmek için **bir kez dışarıdan değer almış** olmalı (örn. external anchor / funded account'tan ≥ $1 USDC). En ucuz gerçek benzersizlik sinyali. **[Black belt]**
- Per-reward replay guard + **per-claim cap + global günlük cap + pause/circuit-breaker**. **[kısmen contract'ta var; Black'te tamamla]**
- **Off-chain indexer ring/cluster tespiti** (A→B→C→A, yoğun çift-yönlü kümeler, ortak-funding kaynağı) → kontratın reward öncesi kontrol ettiği **`frozen` set**. **[Blue/Black]**

### 3. Proof-of-uniqueness
- Passkey = **anti-bot**, anti-sybil değil (tek cihaz çok key üretir). Benzersizliği yalnızca **payout yolunda** zorla (yukarıdaki proof-of-funding), sosyal katmanda zorlama.

### 4. Funding modeli — payout tarafını gerçekten kıt yap (Justin)
- Sponsored havuz yalnızca belt/demo için, **cap'li + rate-limit'li**.
- Ölçekte: **demand-funded** — brand/sponsor quest, redemption/fee geliri. **payout ≤ gerçekleşmiş dış gelir.** Her cashable dolar bir ödeyen counterparty ile backed → faucet değil, sybil gerçek ekonomik yerçekimine karşı yarışır.

---

## North-star — sahtelenemez yeni tanım

Eski "haftalık kapanan loop" **ücretsiz fabrikasyona açık** — vanity alt-metriğe indirildi.

> **Verified Value Loops / hafta** = (i) redeem eden counterparty **proof-of-funding/uniqueness** geçmiş **VE** (ii) USDC'yi **gerçek dış değer** (sponsor/fee geliri) backlemiş loop sayısı.

**Tek cümlelik ekonomik verdict (Justin):** *Cashable USDC yalnızca gerçek dış gelire karşı redeem edilebilir olsun — sybil'i öldüren şey tespit değil, payout tarafındaki kıtlıktır.*

---

## Belt'lere dağılım (özet)
- **Yellow/Orange (MVP):** two-track split (Social vs Earned), rewards yalnızca Earned okur, first-pair-only, günlük cap, XP-stake + asimetrik.
- **Green:** tip-rail-first retention ölçümü Social katmanda (para riski yok), Earned path attester'la.
- **Blue:** off-chain ring/cluster tespiti + `frozen` set; metrik = Verified Value Loops.
- **Black:** proof-of-funding payout gate, demand-funded treasury, per-claim/global cap, pause, audit.
