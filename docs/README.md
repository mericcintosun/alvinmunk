# alvinmunk — documentation index

Every file under `docs/`, grouped by who it is for. The [root README](../README.md) has the
overview, the quick start and the live testnet contract ids.

- [Users](#users)
- [Contributors](#contributors)
- [Operators / deploy](#operators--deploy)
- [Product & design](#product--design)
- [Program / archive](#program--archive)

## Users

| Doc | What it covers |
| --- | --- |
| [USER_GUIDE.md](./USER_GUIDE.md) | End-user walkthrough — onboard, vouch/claim, quests, tips, leaderboard, profile, FAQ |
| [BLOG.md](./BLOG.md) | How the sybil-resistant proof-of-people design works (async vouch, two-track anti-sybil, passkey + fee sponsorship + no standing backend) |

## Contributors

| Doc | What it covers |
| --- | --- |
| [../CONTRIBUTING.md](../CONTRIBUTING.md) | Local setup, branch/commit conventions, the `pnpm check` gates, and the Drips Wave find → claim → PR flow |
| [../SECURITY.md](../SECURITY.md) | Security policy: how to report a vulnerability |
| [ON_CHAIN_EVENTS.md](./ON_CHAIN_EVENTS.md) | The canonical, frozen schema of every Soroban event the contracts emit |
| [SECURITY_REVIEW.md](./SECURITY_REVIEW.md) | Self-audit of the five contracts — Scout, cargo-audit, cargo-deny, clippy, no `unsafe`; findings and fixes |
| [CSP.md](./CSP.md) | The web client's Content-Security-Policy: what each directive allows and how it is rolled out |
| [ECOSYSTEM.md](./ECOSYSTEM.md) | Open-source, community-led development through the Drips Wave / Stellar Wave program |

## Operators / deploy

| Doc | What it covers |
| --- | --- |
| [DEPLOY.md](./DEPLOY.md) | Deploy your own testnet instance — keys → contracts → `.env.local` → web app → optional attester/faucet/passkey secrets |
| [DEPLOY_MAINNET.md](./DEPLOY_MAINNET.md) | Mainnet deployment runbook for the five contracts and the app cutover |
| [PASSKEY_WIRING.md](./PASSKEY_WIRING.md) | How passkey / Face ID onboarding is wired, and the infra to provision to turn it on |
| [PASSKEY_HANDOFF.md](./PASSKEY_HANDOFF.md) | Passkey integration handoff — why `passkey-kit`, the canonical values, the plan and the gotchas |

## Product & design

| Doc | What it covers |
| --- | --- |
| [product/README.md](./product/README.md) | The product & design package — read order and what each file is for |
| [product/BRAND_DESIGN.md](./product/BRAND_DESIGN.md) | The identity: how alvinmunk looks and sounds |
| [product/DESIGN_SYSTEM_TOKENS.md](./product/DESIGN_SYSTEM_TOKENS.md) | Implementable design tokens (dark-first, with the light theme) |
| [product/FRONTEND_PAGES_COMPONENTS.md](./product/FRONTEND_PAGES_COMPONENTS.md) | Every page and component, with their states |
| [product/FRONTEND_CONTENT.md](./product/FRONTEND_CONTENT.md) | Ship-ready copy for every screen and the microcopy library |
| [product/DEPENDENCIES.md](./product/DEPENDENCIES.md) | The frontend stack: libraries, versions, install and risk notes |
| [product/PRODUCT_MARKET_FIT.md](./product/PRODUCT_MARKET_FIT.md) | Product–market fit and go-to-market: the wedge and the riskiest assumption |
| [product/BUSINESS_MODEL.md](./product/BUSINESS_MODEL.md) | How alvinmunk sustains itself: two-track economics backed by real external value |
| [product/DEV_DOCS_OUTLINE.md](./product/DEV_DOCS_OUTLINE.md) | Outline of the developer docs surface (reputation as a readable primitive) |
| [PRD.md](./PRD.md) | Product requirements document |
| [SPRINTS.md](./SPRINTS.md) | Sprint plan, one sprint per belt, with stories and acceptance criteria |

## Program / archive

| Doc | What it covers |
| --- | --- |
| [BELT_SUBMISSIONS.md](./BELT_SUBMISSIONS.md) | White → Blue belt submission evidence: screenshots, tx hashes and rubric tables |
| [IDEA_SUBMISSION.md](./IDEA_SUBMISSION.md) | Builder-Track idea submission and its Stellar anchor angle |
| [PITCH_DECK.md](./PITCH_DECK.md) | Pitch deck content, slide by slide |
| [pitch-deck.pdf](./pitch-deck.pdf) | The designed 12-slide deck |
| [GTM.md](./GTM.md) | Go-to-market kit for the traction sprint |
| [MARKETING.md](./MARKETING.md) | Launch content: the X thread and promotion kit |
| [DEMO_SCRIPT.md](./DEMO_SCRIPT.md) | Script for the demo video |
| [USER_FEEDBACK.md](./USER_FEEDBACK.md) | User onboarding & feedback: the Google Form spec and the feedback-driven iteration plan |
| [feedback/responses.xlsx](./feedback/responses.xlsx) | Exported feedback-form responses (Excel) |
| [feedback/responses.csv](./feedback/responses.csv) | Exported feedback-form responses (CSV) |
| [testnet-traction.csv](./testnet-traction.csv) | Testnet wallets with their @handle, wallet type and Stellar Expert link |
| [archive/AGENT_HANDOFF.md](./archive/AGENT_HANDOFF.md) | Archived June 2026 session handoff — historical, superseded |
