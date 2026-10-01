#!/usr/bin/env bash
# Offline tests for scripts/deploy-testnet.sh. Nothing here can reach a network: the script
# runs with a stub `stellar` on PATH that records every call and hands out a fixed contract id
# per wasm, so the pre-flight checks and the "print each id as soon as it exists" behavior can
# be checked without building or deploying anything.
#
# Usage: bash scripts/deploy-testnet.test.sh   (needs bash, grep and jq)
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
SCRIPT="${1:-$HERE/deploy-testnet.sh}"
W="$(mktemp -d "${TMPDIR:-/tmp}/deploy-testnet-test.XXXXXX")"
trap 'rm -rf "$W"' EXIT
mkdir -p "$W/bin" "$W/nostellar" "$W/nojq"

# --- stub stellar CLI (STUB_FAIL=<pattern> fails every call matching it) ---
cat >"$W/bin/stellar" <<'STUB'
#!/usr/bin/env bash
set -euo pipefail
echo "stellar $*" >>"$STUB_LOG"
if [ -n "${STUB_FAIL:-}" ] && [[ "$*" == *"$STUB_FAIL"* ]]; then
  echo "stub: simulated failure" >&2
  exit 1
fi
case "$1 ${2:-}" in
  "keys address")
    case "$3" in
      admin) echo GAMXYXRK2NGDVVPJ4N5RIOTTZ7D6NOSG3XYOBO6ZRY3QX4AK6L3I2TXY ;;
      attester) echo GBC2FI2YWJPUU7TGEU7ATSP7PIZC64ZPX2F672OLIHHL7AEH7LUDITHJ ;;
      *) echo "error: Failed to find config identity for $3" >&2; exit 1 ;;
    esac ;;
  "strkey decode")
    [ "$3" = GBC2FI2YWJPUU7TGEU7ATSP7PIZC64ZPX2F672OLIHHL7AEH7LUDITHJ ] || exit 1
    echo '{"public_key_ed25519": "45a2a358b25f4a7e66253e09c9ff7a322f732fbe8befe9cb41cebf8087fae834"}' ;;
  "contract build") ;;
  "contract deploy")
    case "$*" in
      *alvinmunk_reputation.wasm*) echo CREPAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA ;;
      *alvinmunk_quest_registry.wasm*) echo CQUESTAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA ;;
      *alvinmunk_rewards.wasm*) echo CREWARDSAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA ;;
      *) echo "stub: unexpected wasm: $*" >&2; exit 2 ;;
    esac ;;
  "contract invoke") ;;
  *) echo "stub: unexpected command: $*" >&2; exit 2 ;;
esac
STUB
chmod +x "$W/bin/stellar"
ln -s "$W/bin/stellar" "$W/nojq/stellar"

unset USDC_SAC NETWORK ADMIN ATTESTER
export STUB_LOG="$W/stellar.log"
command -v jq >/dev/null || { echo "these tests need jq" >&2; exit 2; }
STUB_PATH="$W/bin:/usr/bin:/bin:$(dirname "$(command -v jq)")"
SAC=CAKT2EK2SFGNXTXVSYZLZXA5YB5QPVHLTVUMRHLJTF5RFFAFMIRNPZT2
REP=CREPAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA
QUEST=CQUESTAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA
REWARDS=CREWARDSAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA
ATTESTER_G=GBC2FI2YWJPUU7TGEU7ATSP7PIZC64ZPX2F672OLIHHL7AEH7LUDITHJ
ATTESTER_KEY=45a2a358b25f4a7e66253e09c9ff7a322f732fbe8befe9cb41cebf8087fae834

PASS=0
FAIL=0
check() { # <name> <command...>
  if "${@:2}"; then PASS=$((PASS + 1)); else FAIL=$((FAIL + 1)); echo "FAIL: $1"; fi
}
run() { # [VAR=val...]: runs the deploy script with the stub first on PATH; sets OUT and RC
  : >"$STUB_LOG"
  OUT="$(env PATH="$STUB_PATH" "$@" bash "$SCRIPT" 2>&1)" && RC=0 || RC=$?
}
calls() { grep -c -e "$1" "$STUB_LOG" || true; }
out_has() { printf '%s\n' "$OUT" | grep -Eq -- "$1"; }
out_lacks() { ! out_has "$1"; }
no_calls() { [ ! -s "$STUB_LOG" ]; }
# Line number of the first output line matching <pattern> (empty when none does).
line_of() { printf '%s\n' "$OUT" | grep -nE -- "$1" | head -1 | cut -d: -f1; }
before() { # <pattern a> <pattern b>: a is printed, and before b
  local a b
  a="$(line_of "$1")"
  b="$(line_of "$2")"
  [ -n "$a" ] && [ -n "$b" ] && [ "$a" -lt "$b" ]
}

check "the script keeps set -euo pipefail" grep -q '^set -euo pipefail$' "$SCRIPT"

# --- pre-flight: bad input exits 2 before any stellar call (so before any build or deploy) ---
run
check "no USDC_SAC: exits 2" [ "$RC" = 2 ]
check "no USDC_SAC: says why" out_has "USDC_SAC must be a contract id"
check "no USDC_SAC: nothing built or deployed" no_calls

for bad in REPLACE_WITH_USDC_SAC_CONTRACT_ID \
  GAMXYXRK2NGDVVPJ4N5RIOTTZ7D6NOSG3XYOBO6ZRY3QX4AK6L3I2TXY \
  cakt2ek2sfgnxtxvsyzlzxa5yb5qpvhltvumrhljtf5rffafmirnpzt2 \
  CAKT2EK2SFGNXTXVSYZLZXA5YB5QPVHLTVUMRHLJTF5RFFAFMIRNPZT \
  "${SAC}X" \
  "$SAC "; do
  run USDC_SAC="$bad"
  check "USDC_SAC='$bad': rejected" [ "$RC" = 2 ]
  check "USDC_SAC='$bad': nothing called" no_calls
done

for net in mainnet pubnet public TESTNET "testnet "; do
  run USDC_SAC="$SAC" NETWORK="$net"
  check "NETWORK='$net': exits 2" [ "$RC" = 2 ]
  check "NETWORK='$net': says why" out_has "refusing NETWORK=$net"
  check "NETWORK='$net': nothing called" no_calls
done

if [ -z "$(PATH="$W/nostellar:/usr/bin:/bin" command -v stellar || true)" ]; then
  : >"$STUB_LOG"
  OUT="$(env PATH="$W/nostellar:/usr/bin:/bin" USDC_SAC="$SAC" bash "$SCRIPT" 2>&1)" && RC=0 || RC=$?
  check "no stellar CLI: exits 2" [ "$RC" = 2 ]
  check "no stellar CLI: says why" out_has "stellar CLI not found"
else
  echo "(a stellar CLI is installed in /usr/bin or /bin: skipped the missing-CLI check)"
fi

# A PATH holding only the stub stellar: the jq check must fire before anything runs.
: >"$STUB_LOG"
OUT="$(env PATH="$W/nojq" USDC_SAC="$SAC" "$BASH" "$SCRIPT" 2>&1)" && RC=0 || RC=$?
check "no jq: exits 2" [ "$RC" = 2 ]
check "no jq: says why" out_has "jq not found"
check "no jq: nothing called" no_calls

# The attester key is derived up front, so an underivable key costs no build or deploy.
run USDC_SAC="$SAC" STUB_FAIL="strkey decode"
check "no attester key: exits 2" [ "$RC" = 2 ]
check "no attester key: says why" out_has "cannot derive the attester's ed25519 key from $ATTESTER_G"
check "no attester key: nothing built" [ "$(calls 'contract build')" = 0 ]
check "no attester key: nothing deployed" [ "$(calls 'contract deploy')" = 0 ]

# --- happy path ---
run USDC_SAC="$SAC"
check "happy path exits 0" [ "$RC" = 0 ]
check "defaults to testnet" [ "$(calls 'contract deploy .*--network testnet -- ')" = 3 ]
check "builds once" [ "$(calls 'contract build')" = 1 ]
check "builds before the first deploy" \
  [ "$(grep -nE 'contract (build|deploy)' "$STUB_LOG" | head -1 | cut -d' ' -f3)" = build ]
check "three deploys" [ "$(calls 'contract deploy')" = 3 ]
ADMIN_G=GAMXYXRK2NGDVVPJ4N5RIOTTZ7D6NOSG3XYOBO6ZRY3QX4AK6L3I2TXY
check "reputation's constructor gets the admin" \
  [ "$(calls "alvinmunk_reputation.wasm .* -- --admin $ADMIN_G$")" = 1 ]
check "quest_registry's constructor gets the admin and reputation" \
  [ "$(calls "alvinmunk_quest_registry.wasm .* -- --admin $ADMIN_G --reputation $REP$")" = 1 ]
check "rewards' constructor gets the admin, the given SAC and reputation" \
  [ "$(calls "alvinmunk_rewards.wasm .* -- --admin $ADMIN_G --usdc $SAC --reputation $REP$")" = 1 ]
check "no post-deploy init (#127)" [ "$(calls ' init ')" = 0 ]
check "rewards is wired to the quest registry" \
  [ "$(calls "--id $REWARDS .* set_quest_registry --quest_registry $QUEST$")" = 1 ]
# #246: quest_registry is reputation's only attester, and the off-chain attester is allowlisted
# on quest_registry by its ed25519 key (award_quest reads only that list).
check "quest_registry is an attester of reputation" \
  [ "$(calls "--id $REP .* add_attester --attester $QUEST$")" = 1 ]
check "nothing else is an attester of reputation" [ "$(calls "--id $REP .* add_attester ")" = 1 ]
check "the off-chain attester is never an attester by address" [ "$(calls "add_attester --attester $ATTESTER_G")" = 0 ]
check "quest_registry allowlists the attester's ed25519 key" \
  [ "$(calls "--id $QUEST .* add_attester_key --key $ATTESTER_KEY$")" = 1 ]
check "quest_registry's legacy address list is left empty" [ "$(calls "--id $QUEST .* add_attester ")" = 0 ]
for q in 1:2:50 2:2:30 3:2:50 4:2:25; do
  IFS=: read -r qid schema xp <<<"$q"
  check "seeds quest $qid" [ "$(calls "--id $QUEST .* create_quest --id $qid --schema_id $schema --xp $xp$")" = 1 ]
done
check "seeds exactly four quests" [ "$(calls ' create_quest ')" = 4 ]
check "each id printed right after its deploy (reputation)" before "^REP_ID=$REP$" "Deploying quest_registry"
check "each id printed right after its deploy (quest_registry)" before "^QUEST_ID=$QUEST$" "Deploying rewards"
check "each id printed right after its deploy (rewards)" before "^REWARDS_ID=$REWARDS$" "Wiring rewards"
check "summary: reputation" out_has "^NEXT_PUBLIC_REPUTATION_CONTRACT_ID=$REP$"
check "summary: quest_registry" out_has "^NEXT_PUBLIC_QUEST_REGISTRY_CONTRACT_ID=$QUEST$"
check "summary: rewards" out_has "^NEXT_PUBLIC_REWARDS_CONTRACT_ID=$REWARDS$"
check "summary: USDC SAC" out_has "^NEXT_PUBLIC_USDC_SAC_ID=$SAC$"

run USDC_SAC="$SAC" NETWORK=futurenet
check "futurenet: exits 0" [ "$RC" = 0 ]
check "futurenet: deploys to futurenet" [ "$(calls 'contract deploy .*--network futurenet -- ')" = 3 ]

# --- a later failure never loses the ids deployed before it ---
run USDC_SAC="$SAC" STUB_FAIL="set_quest_registry"
check "wiring failure: exits non-zero" [ "$RC" != 0 ]
check "wiring failure: reputation id printed" out_has "^REP_ID=$REP$"
check "wiring failure: quest_registry id printed" out_has "^QUEST_ID=$QUEST$"
check "wiring failure: rewards id printed" out_has "^REWARDS_ID=$REWARDS$"
check "wiring failure: no success summary" out_lacks "✅"

run USDC_SAC="$SAC" STUB_FAIL="alvinmunk_rewards.wasm"
check "rewards deploy failure: exits non-zero" [ "$RC" != 0 ]
check "rewards deploy failure: earlier ids printed" out_has "^QUEST_ID=$QUEST$"
check "rewards deploy failure: nothing invoked" [ "$(calls 'contract invoke')" = 0 ]

run USDC_SAC="$SAC" STUB_FAIL="alvinmunk_quest_registry.wasm"
check "second deploy failure: exits non-zero" [ "$RC" != 0 ]
check "second deploy failure: reputation id printed" out_has "^REP_ID=$REP$"
check "second deploy failure: rewards never deployed" [ "$(calls alvinmunk_rewards.wasm)" = 0 ]
check "second deploy failure: nothing invoked" [ "$(calls 'contract invoke')" = 0 ]

run USDC_SAC="$SAC" STUB_FAIL="contract build"
check "build failure: exits non-zero" [ "$RC" != 0 ]
check "build failure: nothing deployed" [ "$(calls 'contract deploy')" = 0 ]

echo "deploy-testnet.sh: $PASS passed, $FAIL failed"
[ "$FAIL" = 0 ]
