#!/usr/bin/env bash
# TTL keeper (Green-belt prod hardening). Soroban storage is archived if its TTL
# lapses; instance archival BRICKS a contract. The contracts extend the persistent
# entries they write to ~150 days (BUMP_EXTEND, at most once a day per entry; the
# attester allowlists are the exception), but never extend instance storage (admin,
# contract wiring, daily cap, pause flag), so a keeper must extend it on a schedule.
# Each contract's WASM code is a separate ledger entry with its own TTL (extending the
# instance does not renew it), so the keeper extends both, and prints the new TTL ledger
# of each entry.
# Run this from cron (e.g. weekly) against the live IDs.
#
# Usage: SOURCE=alvinmunk-admin NETWORK=testnet ./scripts/bump-ttl.sh
# Contract ids: set REPUTATION, QUEST and REWARDS together, or none of them. With none set
# they come from scripts/lib/env.mjs (needs node): NEXT_PUBLIC_* env, then apps/web/.env.local,
# then deployments/<NETWORK>.json. A missing id stops the keeper before any call.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
SOURCE="${SOURCE:-alvinmunk-admin}"
NETWORK="${NETWORK:-testnet}"
LEDGERS="${LEDGERS:-535679}" # ~31 days at 5s/ledger (max_entry_ttl is 3,110,400, ~180 days)

if [ -n "${REPUTATION:-}${QUEST:-}${REWARDS:-}" ]; then
  # A partial override would extend some contracts of one deployment and some of another.
  if [ -z "${REPUTATION:-}" ] || [ -z "${QUEST:-}" ] || [ -z "${REWARDS:-}" ]; then
    echo "set all of REPUTATION, QUEST and REWARDS, or none of them" >&2
    exit 2
  fi
else
  command -v node >/dev/null || {
    echo "node is needed to read the contract ids (or set REPUTATION, QUEST and REWARDS)" >&2
    exit 2
  }
  ids="$(node "$HERE/lib/env.mjs" --network "$NETWORK" reputation questRegistry rewards)" || exit 2
  while IFS='=' read -r key value; do
    case "$key" in
      NEXT_PUBLIC_REPUTATION_CONTRACT_ID) REPUTATION="$value" ;;
      NEXT_PUBLIC_QUEST_REGISTRY_CONTRACT_ID) QUEST="$value" ;;
      NEXT_PUBLIC_REWARDS_CONTRACT_ID) REWARDS="$value" ;;
    esac
  done <<<"$ids"
fi

tmp="$(mktemp -d "${TMPDIR:-/tmp}/bump-ttl.XXXXXX")"
trap 'rm -rf "$tmp"' EXIT

bump () { # $1 = contract id, $2 = label
  local wasm="$tmp/$2.wasm"
  local instance_ttl wasm_ttl

  # No --key => the CLI extends the contract instance entry only (not its WASM code).
  echo "==> extending instance TTL: $2 ($1)"
  instance_ttl="$(stellar contract extend \
    --id "$1" \
    --source "$SOURCE" \
    --network "$NETWORK" \
    --ledgers-to-extend "$LEDGERS" \
    --ttl-ledger-only)"
  echo "instance TTL ledger: $instance_ttl"

  # The code entry is keyed by the WASM hash: fetch the contract's current WASM (so an
  # upgraded contract extends its new code) and extend that.
  echo "==> fetching WASM code: $2 ($1)"
  stellar contract fetch \
    --id "$1" \
    --network "$NETWORK" \
    --out-file "$wasm"

  echo "==> extending WASM TTL: $2 ($1)"
  wasm_ttl="$(stellar contract extend \
    --wasm "$wasm" \
    --source "$SOURCE" \
    --network "$NETWORK" \
    --ledgers-to-extend "$LEDGERS" \
    --ttl-ledger-only)"
  echo "WASM TTL ledger: $wasm_ttl"
}

bump "$REPUTATION" reputation
bump "$QUEST" quest_registry
bump "$REWARDS" rewards

echo "✅ instance and WASM TTLs extended to ~$LEDGERS ledgers on all 3 contracts."
echo "Note: the contracts extend persistent entries (XP, vouches, quest and reward claims) to"
echo "~150 days when they write them, but not the attester allowlists or entries only read between"
echo "admin edits (reward table). Schedule this keeper (weekly) so neither the instance nor the"
echo "WASM code of a contract ever archives."
