#!/usr/bin/env bash
# Offline tests for scripts/bump-ttl.sh. Nothing here can reach a network: the script runs
# with a stub `stellar` on PATH that accepts only the stellar CLI 27 flags of each command,
# records every call and answers with canned TTL ledgers. If a real `stellar` is installed,
# the flags the script used are also checked against its `--help` (offline).
#
# The id-loading cases run the real scripts/lib/env.mjs against fixture config roots, so they
# need node; without it they are skipped.
#
# Usage: bash scripts/bump-ttl.test.sh   (needs bash and grep; node for the id-loading cases)
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
SCRIPT="${1:-$HERE/bump-ttl.sh}"
REAL_STELLAR="$(command -v stellar || true)"
REAL_NODE="$(command -v node || true)"
W="$(mktemp -d "${TMPDIR:-/tmp}/bump-ttl-test.XXXXXX")"
trap 'rm -rf "$W"' EXIT
mkdir -p "$W/bin" "$W/tmp"

# --- stub stellar CLI (STUB_FAIL=<pattern> fails the first call matching it) ---
cat >"$W/bin/stellar" <<'STUB'
#!/usr/bin/env bash
set -euo pipefail
echo "stellar $*" >>"$STUB_LOG"
if [ -n "${STUB_FAIL:-}" ] && [[ "$*" == *"$STUB_FAIL"* ]]; then
  echo "stub: simulated failure" >&2
  exit 1
fi
# Flags each command takes in stellar CLI 27 (`stellar contract <cmd> --help`).
cmd="$1 ${2:-}"
case "$cmd" in
  "contract extend")
    valued=" --ledgers-to-extend --id --key --key-xdr --wasm --wasm-hash --durability --source --source-account -s --network -n --rpc-url --network-passphrase --inclusion-fee "
    flags=" --ttl-ledger-only --build-only -q --quiet " ;;
  "contract fetch")
    valued=" --id --wasm-hash --out-file -o --network -n --rpc-url --network-passphrase "
    flags=" -q --quiet " ;;
  *) echo "stub: unexpected command: $*" >&2; exit 2 ;;
esac
shift 2
ARGS=" $* "
ARGV=("$@")
while [ $# -gt 0 ]; do
  if [[ "$valued" == *" $1 "* ]] && [ $# -ge 2 ]; then shift 2
  elif [[ "$flags" == *" $1 "* ]]; then shift
  else echo "error: unexpected argument '$1' for 'stellar $cmd'" >&2; exit 2; fi
done
get() { # <flag>: its value, or nothing
  local i
  for ((i = 0; i + 1 < ${#ARGV[@]}; i++)); do
    if [ "${ARGV[i]}" = "$1" ]; then echo "${ARGV[i + 1]}"; return; fi
  done
}
case "$cmd" in
  "contract fetch")
    out="$(get --out-file)"
    [ -n "$out" ] || { echo "stub: fetch without --out-file writes the WASM to stdout" >&2; exit 2; }
    printf 'wasm of %s' "$(get --id)" >"$out" ;;
  "contract extend")
    [ -n "$(get --ledgers-to-extend)" ] || { echo "stub: --ledgers-to-extend is required" >&2; exit 2; }
    [ -n "$(get --source)" ] || { echo "stub: --source is required" >&2; exit 2; }
    wasm="$(get --wasm)"
    if [ -n "$wasm" ]; then
      [ -f "$wasm" ] || { echo "stub: no such file $wasm" >&2; exit 2; }
      echo "  extended code: $(cat "$wasm")" >>"$STUB_LOG"
      ttl=2222
    else
      ttl=1111
    fi
    if [[ "$ARGS" == *" --ttl-ledger-only "* ]]; then echo "$ttl"; else echo "New ttl ledger: $ttl"; fi ;;
esac
STUB
chmod +x "$W/bin/stellar"
[ -z "$REAL_NODE" ] || ln -s "$REAL_NODE" "$W/bin/node"

export PATH="$W/bin:/usr/bin:/bin"
export STUB_LOG="$W/stellar.log"
export TMPDIR="$W/tmp"
export SOURCE=test-admin NETWORK=testnet LEDGERS=123
export REPUTATION=CREP QUEST=CQUEST REWARDS=CREWARDS
# The id-loading cases decide these themselves.
unset NEXT_PUBLIC_STELLAR_NETWORK NEXT_PUBLIC_NETWORK_PASSPHRASE NEXT_PUBLIC_REPUTATION_CONTRACT_ID \
  NEXT_PUBLIC_QUEST_REGISTRY_CONTRACT_ID NEXT_PUBLIC_REWARDS_CONTRACT_ID ALVINMUNK_CONFIG_ROOT

PASS=0
FAIL=0
check() { # <name> <command...>
  if "${@:2}"; then PASS=$((PASS + 1)); else FAIL=$((FAIL + 1)); echo "FAIL: $1"; fi
}
run() { # [VAR=val...]: runs the keeper; sets OUT and RC
  : >"$STUB_LOG"
  OUT="$(env "$@" bash "$SCRIPT" 2>&1)" && RC=0 || RC=$?
}
calls() { grep -c -e "$1" "$STUB_LOG" || true; }
out_has() { printf '%s\n' "$OUT" | grep -Eq -- "$1"; }
out_lacks() { ! out_has "$1"; }
tmp_clean() { [ -z "$(ls -A "$TMPDIR")" ]; }
# The call log with the keeper's random temp dir replaced by TMP.
log() { sed "s|$TMPDIR/bump-ttl\.[A-Za-z0-9]*|TMP|g" "$STUB_LOG"; }
expected() { # <contract id> <label>...: the calls for each contract, in order
  while [ $# -gt 1 ]; do
    echo "stellar contract extend --id $1 --source test-admin --network testnet --ledgers-to-extend 123 --ttl-ledger-only"
    echo "stellar contract fetch --id $1 --network testnet --out-file TMP/$2.wasm"
    echo "stellar contract extend --wasm TMP/$2.wasm --source test-admin --network testnet --ledgers-to-extend 123 --ttl-ledger-only"
    echo "  extended code: wasm of $1"
    shift 2
  done
}

check "the keeper keeps set -euo pipefail" grep -q '^set -euo pipefail$' "$SCRIPT"

# --- happy path ---
run
check "happy path exits 0" [ "$RC" = 0 ]
check "three instance extensions" [ "$(calls 'contract extend --id')" = 3 ]
check "three WASM fetches" [ "$(calls 'contract fetch --id')" = 3 ]
check "three code extensions" [ "$(calls 'contract extend --wasm')" = 3 ]
check "each contract: instance, then its own fetched code" \
  [ "$(log)" = "$(expected CREP reputation CQUEST quest_registry CREWARDS rewards)" ]
check "prints each instance TTL ledger" [ "$(printf '%s\n' "$OUT" | grep -c '^instance TTL ledger: 1111$')" = 3 ]
check "prints each code TTL ledger" [ "$(printf '%s\n' "$OUT" | grep -c '^WASM TTL ledger: 2222$')" = 3 ]
check "summary names both entries" out_has "instance and WASM TTLs extended to ~123 ledgers on all 3 contracts"
check "fetched WASM is removed" tmp_clean

# --- failures stop the run with a non-zero exit ---
run STUB_FAIL="extend --id CQUEST"
check "instance failure: exits non-zero" [ "$RC" != 0 ]
check "instance failure: that contract's code is not fetched" [ "$(calls 'fetch --id CQUEST')" = 0 ]
check "instance failure: later contracts untouched" [ "$(calls CREWARDS)" = 0 ]
check "instance failure: no success summary" out_lacks "✅"
check "instance failure: fetched WASM is removed" tmp_clean

run STUB_FAIL="fetch --id CREP"
check "fetch failure: exits non-zero" [ "$RC" != 0 ]
check "fetch failure: no code extension" [ "$(calls 'contract extend --wasm')" = 0 ]
check "fetch failure: later contracts untouched" [ "$(calls CQUEST)" = 0 ]

run STUB_FAIL="quest_registry.wasm --source"
check "code extension failure: exits non-zero" [ "$RC" != 0 ]
check "code extension failure: no TTL printed for it" [ "$(printf '%s\n' "$OUT" | grep -c '^WASM TTL ledger')" = 1 ]
check "code extension failure: later contracts untouched" [ "$(calls CREWARDS)" = 0 ]
check "code extension failure: fetched WASM is removed" tmp_clean

# --- the flags used exist in the installed stellar CLI (offline: --help only) ---
run
if [ -n "$REAL_STELLAR" ]; then
  for sub in extend fetch; do
    help="$("$REAL_STELLAR" contract "$sub" --help 2>&1)"
    for flag in $(grep "contract $sub " "$STUB_LOG" | grep -oE -- ' --[a-z-]+' | sort -u); do
      check "stellar contract $sub accepts$flag" grep -qE -- "(^|[ ,])$flag([ ,]|]|$)" <<<"$help" # a flag or an alias
    done
  done
else
  echo "(no stellar CLI installed: skipped the --help flag check)"
fi

# --- contract ids from scripts/lib/env.mjs (no REPUTATION/QUEST/REWARDS set) ---
cid() { printf 'C%55s' "$1" | tr ' ' A; } # a well-formed contract id ending in $1
M_REP="$(cid REP)" M_QUEST="$(cid QUEST)" M_REWARDS="$(cid REWARDS)" L_REWARDS="$(cid LOCALREWARDS)"
manifest() { # <config root> <reputation> <quest_registry> <rewards>
  mkdir -p "$1/deployments"
  printf '{"network":"testnet","passphrase":"Test SDF Network ; September 2015","contracts":{"reputation":"%s","questRegistry":"%s","rewards":"%s"}}\n' \
    "$2" "$3" "$4" >"$1/deployments/testnet.json"
}
NO_IDS=(-u REPUTATION -u QUEST -u REWARDS)
EMPTY="$W/cfg-empty" FROM_MANIFEST="$W/cfg-manifest" WITH_LOCAL="$W/cfg-local" BAD="$W/cfg-bad"
mkdir -p "$EMPTY" "$WITH_LOCAL/apps/web"
manifest "$FROM_MANIFEST" "$M_REP" "$M_QUEST" "$M_REWARDS"
manifest "$WITH_LOCAL" "$M_REP" "$M_QUEST" "$M_REWARDS"
printf 'NEXT_PUBLIC_REWARDS_CONTRACT_ID=%s\n' "$L_REWARDS" >"$WITH_LOCAL/apps/web/.env.local"
manifest "$BAD" "$M_REP" REPLACE_WITH_QUEST_ID "$M_REWARDS"
no_calls() { [ ! -s "$STUB_LOG" ]; }

run "${NO_IDS[@]}" ALVINMUNK_CONFIG_ROOT="$EMPTY"
check "no ids anywhere: exits 2" [ "$RC" = 2 ]
check "no ids anywhere: names the missing reputation id" out_has "NEXT_PUBLIC_REPUTATION_CONTRACT_ID is not set"
check "no ids anywhere: names the missing rewards id" out_has "NEXT_PUBLIC_REWARDS_CONTRACT_ID is not set"
check "no ids anywhere: no stellar call" no_calls

run -u QUEST -u REWARDS ALVINMUNK_CONFIG_ROOT="$FROM_MANIFEST"
check "partial override: exits 2" [ "$RC" = 2 ]
check "partial override: says why" out_has "set all of REPUTATION, QUEST and REWARDS, or none of them"
check "partial override: no stellar call" no_calls

if [ -n "$REAL_NODE" ]; then
  run "${NO_IDS[@]}" ALVINMUNK_CONFIG_ROOT="$FROM_MANIFEST"
  check "manifest ids: exits 0" [ "$RC" = 0 ]
  check "manifest ids: extends exactly the manifest's contracts" \
    [ "$(log)" = "$(expected "$M_REP" reputation "$M_QUEST" quest_registry "$M_REWARDS" rewards)" ]

  run "${NO_IDS[@]}" ALVINMUNK_CONFIG_ROOT="$WITH_LOCAL"
  check ".env.local over the manifest: its rewards id wins" [ "$(calls "extend --id $L_REWARDS")" = 1 ]
  check ".env.local over the manifest: not the manifest's rewards id" [ "$(calls "$M_REWARDS")" = 0 ]
  check ".env.local over the manifest: the others still come from the manifest" [ "$(calls "extend --id $M_REP")" = 1 ]

  run "${NO_IDS[@]}" ALVINMUNK_CONFIG_ROOT="$WITH_LOCAL" NEXT_PUBLIC_REWARDS_CONTRACT_ID="$(cid ENVREWARDS)"
  check "env over .env.local" [ "$(calls "extend --id $(cid ENVREWARDS)")" = 1 ]

  run "${NO_IDS[@]}" ALVINMUNK_CONFIG_ROOT="$BAD"
  check "malformed manifest id: exits 2" [ "$RC" = 2 ]
  check "malformed manifest id: names it" out_has "NEXT_PUBLIC_QUEST_REGISTRY_CONTRACT_ID \(from deployments/testnet.json\) is not a contract id"
  check "malformed manifest id: no stellar call" no_calls

  run "${NO_IDS[@]}" ALVINMUNK_CONFIG_ROOT="$FROM_MANIFEST" NETWORK=mainnet
  check "NETWORK=mainnet never uses the testnet manifest: exits 2" [ "$RC" = 2 ]
  check "NETWORK=mainnet: looks for deployments/mainnet.json" out_has "deployments/mainnet.json \(not found\)"
  check "NETWORK=mainnet: no stellar call" no_calls

  run "${NO_IDS[@]}" ALVINMUNK_CONFIG_ROOT="$FROM_MANIFEST" STUB_FAIL="extend --id $M_QUEST"
  check "manifest ids: a failure still stops the run" [ "$RC" != 0 ]
  check "manifest ids: later contracts untouched after a failure" [ "$(calls "$M_REWARDS")" = 0 ]
else
  echo "(no node installed: skipped the id-loading cases)"
fi

echo "bump-ttl.sh: $PASS passed, $FAIL failed"
[ "$FAIL" = 0 ]
