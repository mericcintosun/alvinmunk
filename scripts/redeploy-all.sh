#!/usr/bin/env bash
# One-shot clean redeploy of all 5 alvinmunk contracts (now with upgrade() + att_set v1),
# fully wired: init → attesters → quests → reward table + treasury → gates.
# Prereq: `passport-admin` funded on testnet; contracts built (stellar contract build).
set -uo pipefail

ADMIN=passport-admin
NET=testnet
USDC=CAKT2EK2SFGNXTXVSYZLZXA5YB5QPVHLTVUMRHLJTF5RFFAFMIRNPZT2
ATTKEY=45a2a358b25f4a7e66253e09c9ff7a322f732fbe8befe9cb41cebf8087fae834
W="$(dirname "$0")/../contracts/target/wasm32v1-none/release"
ADMIN_ADDR=$(stellar keys address "$ADMIN")

dep() { stellar contract deploy --wasm "$W/$1" --source "$ADMIN" --network "$NET" 2>/dev/null; }
# retry wrapper for the (idempotent) post-deploy calls — survives transient TxBadSeq races.
inv() {
  local n=1
  while ! stellar contract invoke --id "$1" --source "$ADMIN" --network "$NET" -- "${@:2}" >/dev/null 2>&1; do
    [ $n -ge 5 ] && { echo "  ✗ FAILED: $*" >&2; return 1; }
    n=$((n + 1))
  done
}

echo "==> deploying 5 contracts"
REP=$(dep alvinmunk_reputation.wasm);        echo "  reputation=$REP"
QUEST=$(dep alvinmunk_quest_registry.wasm);  echo "  quest=$QUEST"
REWARDS=$(dep alvinmunk_rewards.wasm);        echo "  rewards=$REWARDS"
REGISTRY=$(dep alvinmunk_registry.wasm);      echo "  registry=$REGISTRY"
GATE=$(dep alvinmunk_gate.wasm);              echo "  gate=$GATE"

echo "==> init"
inv "$REP" init --admin "$ADMIN_ADDR"
inv "$QUEST" init --admin "$ADMIN_ADDR" --reputation "$REP"
inv "$REWARDS" init --admin "$ADMIN_ADDR" --usdc "$USDC" --reputation "$REP"
inv "$REGISTRY" init --admin "$ADMIN_ADDR"
inv "$GATE" init --admin "$ADMIN_ADDR" --reputation "$REP"

echo "==> attesters"
inv "$REP" add_attester --attester "$QUEST"     # quest_registry mints Earned via cross-call
inv "$QUEST" add_attester_key --key "$ATTKEY"    # off-chain attester ed25519 pubkey

echo "==> quests (schema 2)"
inv "$QUEST" create_quest --id 1 --schema_id 2 --xp 50
inv "$QUEST" create_quest --id 2 --schema_id 2 --xp 30
inv "$QUEST" create_quest --id 3 --schema_id 2 --xp 50
inv "$QUEST" create_quest --id 4 --schema_id 2 --xp 25

echo "==> reward table + daily cap + treasury"
inv "$REWARDS" add_reward --reward_id 1 --threshold 30 --amount 5000000
inv "$REWARDS" add_reward --reward_id 2 --threshold 60 --amount 10000000
inv "$REWARDS" add_reward --reward_id 3 --threshold 100 --amount 20000000
inv "$REWARDS" set_daily_cap --cap 500000000
inv "$USDC" transfer --from "$ADMIN_ADDR" --to "$REWARDS" --amount 100000000  # 10 USDC treasury

echo "==> gates"
inv "$GATE" create_gate --id 1 --track 0 --min 20 --label '"Inner circle"'
inv "$GATE" create_gate --id 2 --track 1 --min 30 --label '"Bounty board"'

echo ""
echo "===== NEW CONTRACT IDS ====="
echo "NEXT_PUBLIC_REPUTATION_CONTRACT_ID=$REP"
echo "NEXT_PUBLIC_QUEST_REGISTRY_CONTRACT_ID=$QUEST"
echo "NEXT_PUBLIC_REWARDS_CONTRACT_ID=$REWARDS"
echo "NEXT_PUBLIC_REGISTRY_CONTRACT_ID=$REGISTRY"
echo "NEXT_PUBLIC_GATE_CONTRACT_ID=$GATE"
