# Demo video script — alvinmunk (Orange Belt)

Plain script. Read it in a calm, normal voice. Short sentences, simple words.
No timings — just say each line while you show that part of the screen.

---

## 1. Open (show the home page)

Hi. This is alvinmunk.
It is a social reputation game on Stellar.
The idea is simple: you collect people, not points.
You earn trust when you vouch for a real person, and when they vouch back.

## 2. Connect a wallet (click Connect)

First I connect my wallet.
The app supports many wallets in one window — Freighter, xBull, Albedo, and more.
I pick one, and now I am signed in.

## 3. Vouch for someone (open the Vouch page)

Here I can vouch for a friend.
When I do this, the app calls a smart contract on Stellar.
That contract writes my vouch on chain, so it is public and real.
This is the core loop of the app.

## 4. Show the contracts talk to each other (Quests or Gate page)

The app has five smart contracts, and they work together.
For example, when I finish a quest, one contract asks the reputation contract to add my points.
And a gate contract can read my score to open a reward.
So the contracts call each other. It is not one big contract — it is a small team of them.

## 5. Show live events (open the Leaderboard)

This is the leaderboard.
It updates on its own.
The app listens to events from the chain every few seconds.
So when someone earns points, you see it here without a refresh.

## 6. Show rewards (open the Rewards page)

You can also send a small tip in USDC.
And you can claim a reward when your score is high enough.
Every action here is a real transaction on the test network.

## 7. Show it works on mobile (resize or use phone view)

The app also works well on a phone.
The layout changes to fit a small screen.
Buttons stay easy to tap, and nothing breaks.

## 8. Show the tests and the pipeline (show GitHub / terminal)

Under the hood, the project is tested.
There are 134 tests. Fifty-seven for the contracts, and the rest for the app.
Every time I push code, a pipeline runs all the tests for me.
If a test fails, the pipeline turns red, so I catch problems early.

## 9. Close (back to home page)

So that is alvinmunk.
Real contracts, real events, real tests, and a clean mobile app.
Collect people, not points.
Thank you for watching.
