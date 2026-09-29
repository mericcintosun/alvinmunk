#!/usr/bin/env bash
# Offline tests for scripts/bump-ttl.sh. Nothing here can reach a network: the script runs
# with a stub `stellar` on PATH that accepts only the stellar CLI 27 flags of each command,
# records every call and answers with canned TTL ledgers. If a real `stellar` is installed,
# the flags the script used are also checked against its `--help` (offline).
#
# Usage: bash scripts/bump-ttl.test.sh   (needs bash and grep)
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
SCRIPT="${1:-$HERE/bump-ttl.sh}"
REAL_STELLAR="$(command -v stellar || true)"
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

export PATH="$W/bin:/usr/bin:/bin"
export STUB_LOG="$W/stellar.log"
export TMPDIR="$W/tmp"
export SOURCE=test-admin NETWORK=testnet LEDGERS=123
export REPUTATION=CREP QUEST=CQUEST REWARDS=CREWARDS

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

echo "bump-ttl.sh: $PASS passed, $FAIL failed"
[ "$FAIL" = 0 ]
