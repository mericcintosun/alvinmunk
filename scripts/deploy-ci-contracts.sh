#!/usr/bin/env bash
# Deploy a DEDICATED CI contract set and print the repository variables to publish it as.
#
# Why a second set: the e2e smoke test writes on-chain (a Friendbot wallet, a genesis tx, a
# registry.claim handle, a vouch). Against the contracts the README publishes, every CI run —
# ×3 with Playwright's retries, on every push and PR — added a bot wallet to the live registry
# and reputation event streams that /api/stats counts and scripts/scan-roster.mjs commits into
# the roster forever (#250). CI now runs against its own throwaway set, so its garbage never
# reaches the traction numbers or people search.
#
# Run ONCE, from a machine with the `stellar` CLI and a funded testnet identity that is NOT the
# production admin (the set is disposable; nothing seeds it with real users):
#   stellar keys generate --fund ci-contracts --network testnet
#   ADMIN=ci-contracts ./scripts/deploy-ci-contracts.sh
# Optional: USDC=<testnet USDC SAC id> (only needed if a future e2e test tips), ATTKEY=<hex
# ed25519 pubkey> (only if a future e2e test attests a quest).
#
# The last block prints `gh variable set …` commands — run them from a clone of the upstream
# repo (needs admin) to publish the ids. Then the e2e job boots against this set. Runbook:
# docs/CI_CONTRACTS.md
set -euo pipefail

ADMIN="${ADMIN:-}"
NET="${NET:-testnet}"
# Testnet USDC SAC (a wrapped SAC is fine — the CI set never holds real value).
USDC="${USDC:-}"
# Off-chain attester pubkey (hex), allowlisted on quest_registry.
ATTKEY="${ATTKEY:-}"

if [ -z "$ADMIN" ]; then
  echo "ADMIN is required: the name of the funded testnet identity that deploys the CI set." >&2
  echo "It must NOT be the identity behind the contracts in the README table — CI writes to" >&2
  echo "whatever it deploys. Generate a throwaway one:" >&2
  echo "  stellar keys generate --fund ci-contracts --network testnet" >&2
  exit 1
fi
case "$ADMIN" in
  S[A-Z2-7]* | [0-9]* | *[!A-Za-z0-9_-]*)
    echo "ADMIN must be a \`stellar keys\` identity name (stellar keys ls), never a secret key," >&2
    echo "a seed phrase or an address — this script deploys, it never signs with one." >&2
    exit 1
    ;;
esac
if ! command -v stellar >/dev/null 2>&1; then
  echo "the \`stellar\` CLI is required" >&2
  exit 1
fi

W="$(cd "$(dirname "$0")" && pwd)/../contracts"
# stellar-cli 25.x builds to the wasm32v1-none target.
WASM_DIR="$W/target/wasm32v1-none/release"
ADMIN_ADDR=$(stellar keys address "$ADMIN" 2>/dev/null) || {
  echo "no stellar identity named '$ADMIN' (stellar keys ls)" >&2
  exit 1
}

echo "==> Building contracts"
( cd "$W" && stellar contract build )

dep() { stellar contract deploy --wasm "$WASM_DIR/$1.wasm" --source "$ADMIN" --network "$NET" 2>/dev/null; }
# Retry wrapper for the idempotent post-deploy calls — survives transient TxBadSeq races.
inv() {
  local n=1
  while ! stellar contract invoke --id "$1" --source "$ADMIN" --network "$NET" -- "${@:2}" >/dev/null 2>&1; do
    [ $n -ge 5 ] && { echo "  ✗ FAILED: $*" >&2; return 1; }
    n=$((n + 1))
  done
}

echo "==> deploying the CI set (5 contracts)"
REP=$(dep alvinmunk_reputation)
QUEST=$(dep alvinmunk_quest_registry)
REWARDS=$(dep alvinmunk_rewards)
REGISTRY=$(dep alvinmunk_registry)
GATE=$(dep alvinmunk_gate)

echo "==> init"
inv "$REP" init --admin "$ADMIN_ADDR"
inv "$QUEST" init --admin "$ADMIN_ADDR" --reputation "$REP"
# rewards' init wants a USDC SAC. Without one the contract is deployed but un-initializable,
# and the smoke test never touches it — so report it instead of half-wiring the set.
if [ -n "$USDC" ]; then
  inv "$REWARDS" init --admin "$ADMIN_ADDR" --usdc "$USDC" --reputation "$REP"
else
  echo "  ! USDC not set — rewards stays uninitialized (fine: the smoke test does not tip)."
  echo "    Re-run with USDC=<testnet USDC SAC id> if you add a tipping e2e test."
fi
inv "$REGISTRY" init --admin "$ADMIN_ADDR"
inv "$GATE" init --admin "$ADMIN_ADDR" --reputation "$REP"

echo "==> attesters"
inv "$REP" add_attester --attester "$QUEST"  # quest_registry mints Earned via cross-call
if [ -n "$ATTKEY" ]; then
  inv "$QUEST" add_attester_key --key "$ATTKEY"
else
  echo "  ! ATTKEY not set — no off-chain attester on quest_registry (fine for the smoke test)."
fi

USDC_LINE=""
if [ -n "$USDC" ]; then
  USDC_LINE="  gh variable set CI_USDC_SAC_ID             --body '$USDC'"
fi

cat <<EOF

✅ CI contract set deployed by $ADMIN_ADDR ($ADMIN).

Local run of the e2e test against this set:

  CI_REPUTATION_CONTRACT_ID=$REP \\
  CI_QUEST_REGISTRY_CONTRACT_ID=$QUEST \\
  CI_REWARDS_CONTRACT_ID=$REWARDS \\
  CI_REGISTRY_CONTRACT_ID=$REGISTRY \\
  CI_GATE_CONTRACT_ID=$GATE \\
  node scripts/check-ci-contracts.mjs

Publish them as repository variables of the upstream repo (run from a clone with admin rights):

  gh variable set CI_REPUTATION_CONTRACT_ID      --body '$REP'
  gh variable set CI_QUEST_REGISTRY_CONTRACT_ID --body '$QUEST'
  gh variable set CI_REWARDS_CONTRACT_ID        --body '$REWARDS'
  gh variable set CI_REGISTRY_CONTRACT_ID       --body '$REGISTRY'
  gh variable set CI_GATE_CONTRACT_ID           --body '$GATE'
$USDC_LINE

Until those are set, .github/workflows/ci.yml fails the web-e2e job on purpose (see
docs/CI_CONTRACTS.md). Nothing here touches the contracts in the README table.
EOF
