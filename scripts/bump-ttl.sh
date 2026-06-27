#!/usr/bin/env bash
# TTL keeper (Green-belt prod hardening). Soroban storage is archived if its TTL
# lapses; instance archival BRICKS a contract. Persistent entries are bumped on every
# write by the contracts themselves, but instance storage (admin/config/attester wiring,
# daily cap, pause flag) is only bumped when those rarely-written keys change — so a keeper
# must extend it on a schedule. Run this from cron (e.g. weekly) against the live IDs.
#
# Usage: SOURCE=alvinmunk-admin NETWORK=testnet ./scripts/bump-ttl.sh
set -euo pipefail

SOURCE="${SOURCE:-alvinmunk-admin}"
NETWORK="${NETWORK:-testnet}"
LEDGERS="${LEDGERS:-535679}" # ~30 days at 5s/ledger (max bump is ~1y)

# Live testnet IDs (keep in sync with apps/web/.env.local).
REPUTATION="${REPUTATION:-CBNIZXITUVTRVW6RZGEGCI7KNF46REG4EDM4XUVHKDAV63WOHWW75SZM}"
QUEST="${QUEST:-CD6RZUVNQ3TV3X6MNQM25NB2YRFRGMSUGKWTMAIGJOC23C6ESHJKYNFO}"
REWARDS="${REWARDS:-CBUKGIFOEOS74I2IUUHYNRBZODQFOFCFWIJY3DUJHOUUJV7TT2QYADOU}"

bump () { # $1 = contract id, $2 = label
  # No --key => the CLI extends the contract instance (instance storage + wasm ref).
  echo "==> extending instance TTL: $2 ($1)"
  stellar contract extend \
    --id "$1" \
    --source "$SOURCE" \
    --network "$NETWORK" \
    --ledgers-to-extend "$LEDGERS"
}

bump "$REPUTATION" reputation
bump "$QUEST" quest_registry
bump "$REWARDS" rewards

echo "✅ instance storage extended by ~$LEDGERS ledgers on all 3 contracts."
echo "Note: persistent entries (XP, rewards table, attester allowlist) self-bump on write;"
echo "schedule this keeper (weekly) so the rarely-written instance config never archives."
