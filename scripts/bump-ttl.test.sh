#!/usr/bin/env bash
# Offline behavior tests for scripts/bump-ttl.sh. The stub records CLI calls and
# returns deterministic TTLs; no Stellar network or account is used.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/bump-ttl-test.XXXXXX")"
trap 'rm -rf "$WORK"' EXIT
mkdir -p "$WORK/bin" "$WORK/tmp"

cat >"$WORK/bin/stellar" <<'STUB'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >>"$STUB_LOG"

if [[ "$*" == *"contract fetch"* ]]; then
  if [[ -n "${STUB_FAIL_FETCH:-}" ]]; then exit 17; fi
  out=""
  while (($#)); do
    if [[ "$1" == "--out-file" ]]; then out="$2"; shift 2; continue; fi
    shift
  done
  printf 'wasm' >"$out"
elif [[ "$*" == *"contract extend"* && "$*" == *"--wasm"* ]]; then
  if [[ -n "${STUB_FAIL_WASM:-}" ]]; then exit 18; fi
  printf '222\n'
elif [[ "$*" == *"contract extend"* && "$*" == *"--id"* ]]; then
  if [[ -n "${STUB_FAIL_INSTANCE:-}" ]]; then exit 19; fi
  printf '111\n'
else
  echo "unexpected stellar call: $*" >&2
  exit 20
fi
STUB
chmod +x "$WORK/bin/stellar"

export PATH="$WORK/bin:/usr/bin:/bin"
export STUB_LOG="$WORK/stellar.log"
export TMPDIR="$WORK/tmp"
export SOURCE=test-admin NETWORK=testnet LEDGERS=123
export REPUTATION=CREP QUEST=CQUEST REWARDS=CREWARDS

pass=0
fail=0
check() {
  local name=$1
  shift
  if "$@"; then
    pass=$((pass + 1))
  else
    fail=$((fail + 1))
    printf 'FAIL: %s\n' "$name"
  fi
}

output=""
if output="$(bash "$HERE/bump-ttl.sh" 2>&1)"; then :; else
  echo "$output"
  echo 'FAIL: happy path exited non-zero'
  exit 1
fi

check 'three instance extensions' test "$(grep -c 'contract extend --id' "$STUB_LOG")" = 3
check 'three WASM fetches' test "$(grep -c 'contract fetch --id' "$STUB_LOG")" = 3
check 'three WASM extensions' test "$(grep -c 'contract extend --wasm' "$STUB_LOG")" = 3
check 'all configured contract IDs are covered' test "$(grep -c -- '--id CREP' "$STUB_LOG")" = 2
check 'quest contract is covered' grep -q -- '--id CQUEST' "$STUB_LOG"
check 'rewards contract is covered' grep -q -- '--id CREWARDS' "$STUB_LOG"
check 'TTL-only output is requested for every extension' test "$(grep -c -- '--ttl-ledger-only' "$STUB_LOG")" = 6
check 'instance TTL output' test "$(grep -c '^instance TTL: 111$' <<<"$output")" = 3
check 'WASM TTL output' test "$(grep -c '^WASM TTL: 222$' <<<"$output")" = 3

: >"$STUB_LOG"
if STUB_FAIL_FETCH=1 bash "$HERE/bump-ttl.sh" >/dev/null 2>&1; then
  echo 'FAIL: fetch failure was swallowed'
  fail=$((fail + 1))
else
  pass=$((pass + 1))
fi
check 'failed fetch stops before WASM extension' test "$(grep -c 'contract extend --wasm' "$STUB_LOG" || true)" = 0

: >"$STUB_LOG"
if STUB_FAIL_WASM=1 bash "$HERE/bump-ttl.sh" >/dev/null 2>&1; then
  echo 'FAIL: WASM extension failure was swallowed'
  fail=$((fail + 1))
else
  pass=$((pass + 1))
fi

printf '%s passed, %s failed\n' "$pass" "$fail"
test "$fail" -eq 0
