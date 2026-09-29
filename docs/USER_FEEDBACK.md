# alvinmunk — User onboarding & feedback (Green / Blue / Black)

The belt program requires a Google Form that collects user details + a product rating, an exported sheet linked from the README, and a feedback-driven improvement plan with commit links. This file is the spec + the ready-to-paste README section.

---

## 1. Google Form spec

Create a Google Form titled **"alvinmunk — early access & feedback"**. Add exactly these fields (the belt rubric names wallet address, email, name, and a rating).

| # | Question | Type | Required | Notes |
|---|---|---|---|---|
| 1 | Your name or @handle | Short answer | Yes | matches their alvinmunk handle |
| 2 | Email | Short answer (email validation) | Yes | for follow-up |
| 3 | Your Stellar wallet address (G… or C…) | Short answer | Yes | ties the response to on-chain activity |
| 4 | How did you use alvinmunk? | Checkboxes | Yes | created a profile / vouched for someone / claimed a vouch / completed a quest / sent or received USDC |
| 5 | Rate the product (1–5) | Linear scale 1–5 | Yes | the required rating |
| 6 | What worked well? | Paragraph | No | qualitative |
| 7 | What was confusing or missing? | Paragraph | No | the gold for iteration |
| 8 | One feature you want next | Short answer | No | feeds the roadmap |
| 9 | Can we contact you for a quick chat? | Yes/No | No | recruit power users |

Settings: collect email off (field 2 captures it), one response per person off (allow edits), show a link to `alvinmunk.vercel.app` on the confirmation screen.

**Export:** Responses tab → link to Google Sheets → File → Download → Microsoft Excel (.xlsx). Commit the file to the repo as `docs/feedback/responses.xlsx` (or link the shared Sheet, view-only) and reference it from the README.

**Getting the 10 / 50 / 20-mainnet users:** onboard whole cohorts where people already know each other (a student club, a builder Discord, an ambassador group). Because a vouch names a specific person, seed 3–4 real users and have each vouch 3 people; the share links pull the rest in. Keep the form link in the app footer and in the post-vouch success toast.

---

## 2. README section — paste this in

Add this block to `README.md` (update the numbers, the sheet link, and the commit links as you iterate).

```markdown
## Users & feedback

- **Onboarding form:** <Google Form link>
- **Responses (exported):** [docs/feedback/responses.xlsx](./docs/feedback/responses.xlsx)
- **Users onboarded:** N (wallet interactions verifiable on Stellar Expert — see the wallet column in the sheet)
- **Average rating:** X.X / 5 (N responses)

### What users told us
- Theme 1 (e.g. "the vouch link is delightful, but people wanted to see who vouched them faster") — M mentions
- Theme 2 (e.g. "USDC cash-out was unclear") — M mentions
- Theme 3 …

### How we are improving next (feedback → commit)
| Feedback | Change | Commit |
| --- | --- | --- |
| "Recipient keys are impossible to type" | **Tip by `@handle`** — registry resolves the handle to a wallet on-chain, with inline confirmation before sending (`components/Tip.tsx`) | [`2bac3c1`](https://github.com/mericcintosun/alvinmunk/commit/2bac3c1) |
| "weighted vouch" (top request) | Scoped weighted-vouch for the reputation track (weight by voucher reputation, split across vouchees, seed-set anchored) | <planned> |
```

> The rubric specifically wants a **git commit link** next to each improvement. Ship the change, then paste the commit URL (`github.com/mericcintosun/alvinmunk/commit/<sha>`) into the table.

---

## 3. Proof of wallet interactions (Green/Blue/Black)

For each onboarded user you need on-chain proof:
- The wallet address column in the sheet is the anchor.
- For a quick proof list, pull recent `vouch:claimed` / `tipped` events and link the tx or the account on Stellar Expert. The leaderboard/activity feed and `/api/stats` already read these events over RPC `getEvents` (`lib/events.ts`, `app/api/stats/route.ts`); `scripts/status.mjs` only reads contract state via simulation — it does not read events. Since #144 a `tipped` event always carries a positive `amount` between two *different* wallets, so a row backed by one is real traction rather than a zero or self-tip.
- Keep a short `docs/feedback/onboarded_users.md` table: handle, address, first on-chain action, Stellar Expert link.

---

## 4. Analytics cross-check

Vercel Analytics (already wired via `apps/web/src/lib/track.ts`) gives you the quantitative side to pair with the form:
- Autocaptured pageviews + visitors (any plan), plus Web Vitals from Speed Insights.
- `profile_created`, `vouch_minted` and `vouch_batch_minted` custom events fired by `lib/track.ts` — **Vercel Pro plan only**; on Hobby these calls are harmless no-ops.
- Vercel Analytics is anonymous/privacy-first (no `identify`), so per-user funnels and 7-day retention are **not** measurable with this setup — read those from the form and the on-chain event readers (`/api/stats`, the leaderboard) instead.
- Export a screenshot of the Vercel Analytics dashboard (pageviews/visitors; custom events on Pro) for the "analytics or monitoring setup" submission screenshot.
