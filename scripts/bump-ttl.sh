#!/usr/bin/env bash
# TTL keeper (Green-belt prod hardening). Soroban storage is archived if its TTL
# lapses; instance archival BRICKS a contract. The contracts extend the persistent
# entries they write to ~150 days (BUMP_EXTEND, at most once a day per entry; the
# attester allowlists are the exception), but never extend instance storage (admin,
# contract wiring, daily cap, pause flag), so a keeper must extend it on a schedule.
# Run this from cron (e.g. weekly) against the live IDs.
#
# Usage: SOURCE=alvinmunk-admin NETWORK=testnet ./scripts/bump-ttl.sh
set -euo pipefail

SOURCE="${SOURCE:-alvinmunk-admin}"
NETWORK="${NETWORK:-testnet}"
LEDGERS="${LEDGERS:-535679}" # ~31 days at 5s/ledger (max_entry_ttl is 3,110,400, ~180 days)

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

echo "✅ instance storage extended to ~$LEDGERS ledgers on all 3 contracts."
echo "Note: the contracts extend persistent entries (XP, vouches, quest and reward claims) to"
echo "~150 days when they write them, but not the attester allowlists or entries only read between"
echo "admin edits (reward table). Schedule this keeper (weekly) so instance storage never archives."
