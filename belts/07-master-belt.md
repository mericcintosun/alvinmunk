# 🏆 Master Belt — Ecosystem Acceleration

**Rise In requirement:** The best projects from Black Belt enter the final ecosystem-acceleration phase — long-term scaling, partnership, startup growth, investor visibility, ecosystem expansion.

**Milestone (Nicole):** Built on proven retention + mainnet economy metrics; a demonstrated scaling path, ≥1 concrete partnership, active investor visibility.

**Scope guard — DON'T:** Pivot the core loop to chase investors; over-build speculative features for a partner without signed intent. Trade proven retention for vanity growth-hacks. Resist scope creep from every partner request.

**Success metrics:**
- A sustained WAU growth trend (multi-season retention curve up-and-to-the-right).
- ≥1 signed partnership/integration.
- Investor pipeline (≥3 qualified conversations or an SCF/grant application in flight).

---

## 🔧 Technical tasks

### Smart contract / on-chain (Tyler)
- **Upgradeability governance:** if the contracts are upgradeable, move the admin to proper timelock'd on-chain governance/multisig and publish an upgrade policy. If immutable, design a migration contract + state-export path (v2).
- **Partnership/integration surface:** clean cross-contract integration ABI + SDK; let other Stellar dApps read reputation (`get_profile`) and award XP under an allowlist — **reputation-as-a-primitive** (ecosystem expansion).
- **Long-term storage/TTL economics:** model archival cost at scale, automate the TTL keeper as funded infra, state-rent/archival-restore UX (old profiles auto-restore on access).
- **Data layer scale:** shard the indexer (contract/event), read replica + cache, a dedicated analytics pipeline for investor/ecosystem metrics (Hubble).
- **Multi-issuer/asset:** configurable SAC address beyond USDC in the Rewards + bounty market (broad partnership).
- **Decentralization path (optional, honest trade-off):** allowlisted attester → staked/permissionless attestation (m-of-n threshold + staking/slashing) — only if adoption justifies the complexity. The boring allowlist is sufficient for longer than you think.

### Engineering / full-stack (Elliot)
- Scale infra: horizontal indexer (sharded), read replica, badge art CDN, multi-region API. **AC:** stable p95 under 10x load.
- Contract upgrade/governance: timelock'd upgrade, parameter governance, state migration tooling. **AC:** dry-run state migration succeeds on a fork without value-loss.
- **Partnership SDK/API:** public attester onboarding (3rd-party quest provider) + documented quest-attestation spec + SDK package. **AC:** an external partner registers a quest and issues a verifiable claim.
- Investor/scale metric pipeline: cohort retention, reputation velocity, payout volume, viral coefficient dashboard. **AC:** board-ready metrics auto-refresh from the indexer/warehouse.
- Multi-attester decentralization: threshold m-of-n signing, attester staking/slashing design. **AC:** quest completion requires m-of-n attesters; a single-attester compromise is insufficient.
- Cost/treasury automation: dynamic fee-sponsorship budgeting, USDC treasury reconciliation, funding alert. **AC:** paymaster + bounty treasury auto-replenish within policy limits.
- Security continuity: bug bounty program, periodic audit, dependency/supply-chain scan in CI. **AC:** bug bounty live; CI fails on a critical CVE.

---

## 🎨 UX / Frontend (Kaan)
- **Screens:** partner/branded passport surfaces (co-branded stamps for event/community), creator dashboard/analytics, investor-facing public metrics page.
- **Delight mechanic:** **PARTNER-STAMP DROPS** — communities mint co-branded shared stamps at IRL events (TAP-TO-MINT booths); scarcity/edition-numbered art → collectible + FOMO-shareable.
- **Share surface:** edition-numbered event stamp cards ("#42 of 500, minted at [event]") + a seasonal "passport wrapped" recap (year-end brag artifact).
- **Onboarding:** white-label/partner theming + bulk-invite for event organizers; the passkey core unchanged.
- **Empty states:** a "create your first stamp" wizard for the partner dashboard before the first drop; analytics zero-data preview.
- **Accessibility:** enforce the design system as a documented token/component library (so a partner can't ship an inaccessible co-branded card); localization-ready layout for global partnership.

---

## 📣 Product / GTM (Nicole)
- **Package the data story:** retention curves, viral coefficient, mainnet USDC volume, cohort LTV proxy.
- **Apply to the SCF / relevant grant round** (InstaAward ≤$15k, SCF ≤$150k candidate); warm investor list + intro conversations.
- Convert the strongest Black partner signal into a signed integration/co-marketing.
- Define scaling GTM: ambassador program, multi-community season franchising, self-serve bounty creation.
- Sustainability/economy model narrative (how fee/spend-sinks fund the loop long-term).

---

## ✅ Definition of Done
Multi-season up-trend retention; ≥1 signed partner integration via the reputation-as-a-primitive SDK; SCF/grant application in flight; board-ready metric dashboard; governance/multisig + bug bounty live.

## ⛓️ Dependencies
Black (mainnet + audit + ecosystem signal). This is the finale of the program — ecosystem funding (InstaAward/SCF) and the gateway to startup growth.

---

### 🔗 Cross-cutting flags (across all belts)
- **Auth:** `require_auth` + deny-by-default — every belt, every fn.
- **Storage TTL/archival:** bump on every write from Yellow onward; instance archival = brick risk.
- **Upgradeability:** decide in Orange, enforce in Black.
- **External users:** the Blue (50) and Black (20 mainnet) gates are passed with real external communities, NOT the program cohort (Nicole's anti-incest warning).
- **Verifiability:** only cryptographic/API-verifiable quests go on-chain naked; subjective ones use staked quorum.
