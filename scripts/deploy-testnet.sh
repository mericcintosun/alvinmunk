#!/usr/bin/env bash
# Deploy the 3 Passport contracts to testnet and wire them together.
# Prereq: `stellar` CLI installed, an identity funded on testnet (`stellar keys generate --fund admin --network testnet`).
# Usage: ADMIN=admin ATTESTER=attester ./scripts/deploy-testnet.sh
set -euo pipefail

ADMIN="${ADMIN:-admin}"
ATTESTER="${ATTESTER:-attester}"
NETWORK="${NETWORK:-testnet}"
# Testnet USDC SAC — replace with the real SAC id you wrap, or the canonical mainnet USDC.
USDC_SAC="${USDC_SAC:-REPLACE_WITH_USDC_SAC_CONTRACT_ID}"

ADMIN_ADDR=$(stellar keys address "$ADMIN")
ATTESTER_ADDR=$(stellar keys address "$ATTESTER")

echo "==> Building contracts"
( cd "$(dirname "$0")/../contracts" && stellar contract build )

# stellar-cli 25.x builds to the wasm32v1-none target.
WASM_DIR="$(dirname "$0")/../contracts/target/wasm32v1-none/release"

deploy () { # $1 = wasm filename
  stellar contract deploy --wasm "$WASM_DIR/$1" --source "$ADMIN" --network "$NETWORK"
}

echo "==> Deploying reputation"
REP_ID=$(deploy passport_reputation.wasm)
echo "==> Deploying quest_registry"
QUEST_ID=$(deploy passport_quest_registry.wasm)
echo "==> Deploying rewards"
REWARDS_ID=$(deploy passport_rewards.wasm)

inv () { stellar contract invoke --id "$1" --source "$ADMIN" --network "$NETWORK" -- "${@:2}"; }

echo "==> Initializing"
inv "$REP_ID" init --admin "$ADMIN_ADDR"
inv "$QUEST_ID" init --admin "$ADMIN_ADDR" --reputation "$REP_ID"
inv "$REWARDS_ID" init --admin "$ADMIN_ADDR" --usdc "$USDC_SAC" --reputation "$REP_ID"

echo "==> Wiring attesters (QuestRegistry contract + off-chain attester key are both attesters of Reputation)"
inv "$REP_ID" add_attester --attester "$QUEST_ID"
inv "$REP_ID" add_attester --attester "$ATTESTER_ADDR"
inv "$QUEST_ID" add_attester --attester "$ATTESTER_ADDR"

cat <<EOF

✅ Deployed. Put these in apps/web/.env.local:

NEXT_PUBLIC_REPUTATION_CONTRACT_ID=$REP_ID
NEXT_PUBLIC_QUEST_REGISTRY_CONTRACT_ID=$QUEST_ID
NEXT_PUBLIC_REWARDS_CONTRACT_ID=$REWARDS_ID
NEXT_PUBLIC_USDC_SAC_ID=$USDC_SAC
EOF
