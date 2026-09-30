#!/usr/bin/env bash
# Deploy the 3 Passport contracts to testnet and wire them together.
# Prereq: `stellar` CLI (with `strkey decode`) and jq installed, an identity funded on testnet (`stellar keys generate --fund admin --network testnet`).
# Usage: USDC_SAC=C… ADMIN=admin ATTESTER=attester [NETWORK=testnet|futurenet] ./scripts/deploy-testnet.sh
set -euo pipefail

ADMIN="${ADMIN:-admin}"
ATTESTER="${ATTESTER:-attester}"
NETWORK="${NETWORK:-testnet}"
# The USDC SAC rewards moves (docs/DEPLOY.md §2). Required: there is no usable default.
USDC_SAC="${USDC_SAC:-}"

# Pre-flight: every check runs before the first build or deploy, so a bad input costs nothing.
[[ "$USDC_SAC" =~ ^C[A-Z2-7]{55}$ ]] || { echo "USDC_SAC must be a contract id (C…), got '$USDC_SAC'" >&2; exit 2; }
case "$NETWORK" in
  testnet|futurenet) ;;
  *) echo "refusing NETWORK=$NETWORK: this script is for testnet/futurenet (mainnet: scripts/deploy-mainnet.sh)" >&2; exit 2 ;;
esac
command -v stellar >/dev/null || { echo "stellar CLI not found" >&2; exit 2; }
command -v jq >/dev/null || { echo "jq not found" >&2; exit 2; }

ADMIN_ADDR=$(stellar keys address "$ADMIN")
ATTESTER_ADDR=$(stellar keys address "$ATTESTER")
# quest_registry allowlists the attester by its raw ed25519 public key (what /api/attest signs with).
ATTESTER_KEY=$(stellar strkey decode "$ATTESTER_ADDR" 2>/dev/null | jq -r '.public_key_ed25519 // empty' 2>/dev/null) || true
[[ "$ATTESTER_KEY" =~ ^[0-9a-f]{64}$ ]] || {
  echo "cannot derive the attester's ed25519 key from $ATTESTER_ADDR (needs a stellar CLI with 'strkey decode')" >&2
  exit 2
}

echo "==> Building contracts"
( cd "$(dirname "$0")/../contracts" && stellar contract build )

# stellar-cli 25.x builds to the wasm32v1-none target.
WASM_DIR="$(dirname "$0")/../contracts/target/wasm32v1-none/release"

# $1 = wasm filename; the rest are the contract's constructor arguments. The constructor
# sets the admin inside the deploy transaction (#127), so there is no separate `init` that
# anyone watching the network could call first.
deploy () {
  stellar contract deploy --wasm "$WASM_DIR/$1" --source "$ADMIN" --network "$NETWORK" -- "${@:2}"
}

# Each id goes to stderr as soon as its deploy returns, so a later failure never loses it.
echo "==> Deploying reputation"
REP_ID=$(deploy alvinmunk_reputation.wasm --admin "$ADMIN_ADDR")
echo "REP_ID=$REP_ID" >&2
echo "==> Deploying quest_registry"
QUEST_ID=$(deploy alvinmunk_quest_registry.wasm --admin "$ADMIN_ADDR" --reputation "$REP_ID")
echo "QUEST_ID=$QUEST_ID" >&2
echo "==> Deploying rewards"
REWARDS_ID=$(deploy alvinmunk_rewards.wasm --admin "$ADMIN_ADDR" --usdc "$USDC_SAC" --reputation "$REP_ID")
echo "REWARDS_ID=$REWARDS_ID" >&2

inv () { stellar contract invoke --id "$1" --source "$ADMIN" --network "$NETWORK" -- "${@:2}"; }

echo "==> Wiring rewards to the quest registry (streak-gated rewards read get_streak)"
inv "$REWARDS_ID" set_quest_registry --quest_registry "$QUEST_ID"

# quest_registry is reputation's only attester: it mints Earned XP through award_quest, behind
# its quest table and replay guard. The off-chain attester is never a reputation attester; it
# only signs quest claims, which quest_registry checks against this key allowlist.
echo "==> Wiring attesters (quest_registry -> reputation, attester ed25519 key -> quest_registry)"
inv "$REP_ID" add_attester --attester "$QUEST_ID"
inv "$QUEST_ID" add_attester_key --key "$ATTESTER_KEY"

# The quest table redeploy-all.sh and deploy-mainnet.sh seed (id, schema_id, xp). The web's
# default quest ids (DEFAULT_QUEST_IDS: referral 2, invite 3, vouch-back 4) point into it.
echo "==> Seeding quests"
inv "$QUEST_ID" create_quest --id 1 --schema_id 2 --xp 50
inv "$QUEST_ID" create_quest --id 2 --schema_id 2 --xp 30
inv "$QUEST_ID" create_quest --id 3 --schema_id 2 --xp 50
inv "$QUEST_ID" create_quest --id 4 --schema_id 2 --xp 25

cat <<EOF

✅ Deployed. Put these in apps/web/.env.local:

NEXT_PUBLIC_REPUTATION_CONTRACT_ID=$REP_ID
NEXT_PUBLIC_QUEST_REGISTRY_CONTRACT_ID=$QUEST_ID
NEXT_PUBLIC_REWARDS_CONTRACT_ID=$REWARDS_ID
NEXT_PUBLIC_USDC_SAC_ID=$USDC_SAC
EOF
