#!/usr/bin/env bash
# Offline tests for scripts/deploy-mainnet.sh. Nothing here can reach a network: the script
# runs in a throwaway git repo with a stub `stellar` on PATH that records every call and
# answers from canned data (wasm = the committed contracts/*/testdata fixtures).
# Gate 3 needs a real terminal, so confirmations are typed through a pty (python3).
#
# Usage: bash scripts/deploy-mainnet.test.sh   (needs bash, git, jq, python3)
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
SCRIPT="${1:-$HERE/deploy-mainnet.sh}"
W=$(mktemp -d "${TMPDIR:-/tmp}/deploy-mainnet-test.XXXXXX")
trap 'rm -rf "$W"' EXIT
mkdir -p "$W/bin" "$W/wasm" "$W/tmp"
cp "$HERE"/../contracts/*/testdata/alvinmunk_*.wasm "$W/wasm/"

TEST="Test SDF Network ; September 2015"
CIRCLE_USDC=CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75
TESTNET_USDC=CA2E53VHFZ6YSWQIEIPBXJQGT6VW3VKWWZO555XKRQXYJ63GEBJJGHY7 # same issuer, testnet passphrase
ADMIN_G=GAMXYXRK2NGDVVPJ4N5RIOTTZ7D6NOSG3XYOBO6ZRY3QX4AK6L3I2TXY
ATTESTER_G=GBC2FI2YWJPUU7TGEU7ATSP7PIZC64ZPX2F672OLIHHL7AEH7LUDITHJ
ATTESTER_HEX=45a2a358b25f4a7e66253e09c9ff7a322f732fbe8befe9cb41cebf8087fae834
SECRET=SBZVMB74Z76QZ3ZOY7UTDFYKMEGKW5XFJEB6PFKBF4UYSSWHG4EDH7PY # random, never funded

# --- stub stellar CLI (STUB_* env vars pick the scenario) ---
cat >"$W/bin/stellar" <<'STUB'
#!/usr/bin/env bash
set -uo pipefail
PUB="Public Global Stellar Network ; September 2015"
echo "stellar $*" >>"$STUB_LOG"
hit() { [ -n "${1:-}" ] && [[ "$ARGS" == *"$1"* ]]; }
ARGS="$*"
if hit "${STUB_INT:-}"; then kill -INT 0; sleep 5; fi
if hit "${STUB_FAIL:-}"; then echo "stub: simulated failure" >&2; exit 1; fi
sha() { if command -v sha256sum >/dev/null; then sha256sum "$1"; else shasum -a 256 "$1"; fi | cut -c1-64; }
opt() { local want=$1; shift; while [ $# -gt 1 ]; do [ "$1" = "$want" ] && { echo "$2"; return; }; shift; done; }
case "$1 ${2:-}" in
  "--version "*) printf 'stellar 27.1.0 (stub)\nstellar-xdr 27.0.0\n' ;;
  "keys address")
    case "$3" in
      admin | sameasadmin) echo GAMXYXRK2NGDVVPJ4N5RIOTTZ7D6NOSG3XYOBO6ZRY3QX4AK6L3I2TXY ;;
      attester) echo GBC2FI2YWJPUU7TGEU7ATSP7PIZC64ZPX2F672OLIHHL7AEH7LUDITHJ ;;
      *) echo "error: Failed to find config identity for $3" >&2; exit 1 ;;
    esac ;;
  "strkey decode")
    [ "$3" = GBC2FI2YWJPUU7TGEU7ATSP7PIZC64ZPX2F672OLIHHL7AEH7LUDITHJ ] || exit 1
    echo '{"public_key_ed25519": "45a2a358b25f4a7e66253e09c9ff7a322f732fbe8befe9cb41cebf8087fae834"}' ;;
  "network ls")
    printf 'Name: mainnet\nRPC url: https://rpc.example/\nRPC headers: not set\nNetwork passphrase: %s\n\n' "${STUB_CONFIGURED:-$PUB}"
    printf 'Name: mainnet\nRPC url: Bring Your Own\nRPC headers: not set\nNetwork passphrase: %s\n' "$PUB" ;;
  "network info")
    [ -z "${STUB_RPC_DOWN:-}" ] || { echo "error: client error (Connect)" >&2; exit 1; }
    printf '{"id":"x","protocol_version":23,"passphrase":"%s","friendbot_url":null}\n' "${STUB_RPC:-$PUB}" ;;
  "contract id")
    # Real `stellar contract id asset` output for each (asset, passphrase) pair.
    mainnet=0; [ "${STUB_RESOLVED:-$PUB}" = "$PUB" ] && mainnet=1
    case "$(opt --asset "$@"):$mainnet" in
      native:1) echo CAS3J7GYLGXMF6TDJBBYYSE3HQ6BBSMLNUQ34T6TZMYMW2EVH34XOWMA ;;
      native:0) echo CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC ;;
      USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN:1) echo CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75 ;;
      USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN:0) echo CA2E53VHFZ6YSWQIEIPBXJQGT6VW3VKWWZO555XKRQXYJ63GEBJJGHY7 ;;
      *) exit 1 ;;
    esac ;;
  "contract build")
    [ -z "${STUB_BUILD_FAIL:-}" ] || exit 1
    cp "$STUB_WASM"/alvinmunk_*.wasm "$(opt --out-dir "$@")/" ;;
  "contract upload")
    if [ -n "${STUB_BAD_UPLOAD:-}" ]; then printf '%064d\n' 0; else sha "$(opt --wasm "$@")"; fi ;;
  "contract deploy")
    printf 'C%s\n' "$(opt --wasm-hash "$@" | tr '0-9a-f' 'A-P' | cut -c1-55)" ;;
  "contract invoke")
    fn=$(printf '%s\n' "$@" | sed -n '/^--$/{n;p;q;}')
    case "$ARGS" in
      *--send=no*)
        case "$fn" in
          get_require_funding) echo "${STUB_VIEW_FUNDING:-true}" ;;
          get_daily_cap) echo "\"$DAILY_CAP\"" ;;
          is_attester) echo true ;;
          *) exit 98 ;;
        esac ;;
      *--send=yes*) echo null ;;
      *) echo "stub: write without --send=yes" >&2; exit 97 ;;
    esac ;;
  *) echo "stub: unexpected call: $*" >&2; exit 99 ;;
esac
STUB
chmod +x "$W/bin/stellar"

# Runs a command on a pty and types argv[1] once the mainnet prompt shows.
cat >"$W/type_answer.py" <<'PY'
import os, pty, select, sys
answer, cmd = sys.argv[1].encode() + b"\n", sys.argv[2:]
pid, fd = pty.fork()
if pid == 0:
    os.execvp(cmd[0], cmd)
buf, sent = b"", False
while True:
    try:
        if not select.select([fd], [], [], 60)[0]:
            os.kill(pid, 9)
            break
        data = os.read(fd, 4096)
    except OSError:
        break
    if not data:
        break
    buf += data
    sys.stdout.write(data.decode(errors="replace").replace("\r", ""))
    if not sent and b"to continue: " in buf:
        os.write(fd, answer)
        sent = True
sys.exit(os.waitstatus_to_exitcode(os.waitpid(pid, 0)[1]))
PY

# Runs a command in a new session with no controlling terminal, so /dev/tty cannot be opened
# even when these tests are started from an interactive shell.
cat >"$W/notty.py" <<'PY'
import os, sys
pid = os.fork()
if pid:
    sys.exit(os.waitstatus_to_exitcode(os.waitpid(pid, 0)[1]))
os.setsid()
os.execvp(sys.argv[1], sys.argv[1:])
PY

sha256() { if command -v sha256sum >/dev/null; then sha256sum "$1"; else shasum -a 256 "$1"; fi | cut -c1-64; }

PASS=0 FAIL=0 OUT="" RC=0
REPO="$W/repo" LOG="$W/stub.log" DLOG="$W/repo/deployment-log.md"
BASE=(ADMIN=admin ATTESTER=attester "USDC_SAC=$CIRCLE_USDC" DAILY_CAP=500000000)

fresh_repo() {
  rm -rf "$REPO" && mkdir -p "$REPO/scripts" "$REPO/contracts/reputation/test_snapshots"
  cp "$SCRIPT" "$REPO/scripts/deploy-mainnet.sh"
  echo "[workspace]" >"$REPO/contracts/Cargo.toml"
  echo "{}" >"$REPO/contracts/reputation/test_snapshots/a.json"
  git -C "$REPO" init -q && git -C "$REPO" add -A &&
    git -C "$REPO" -c user.name=t -c user.email=t@t commit -qm init
  : >"$LOG"
}
# env for the script under test: nothing inherited except HOME and a PATH with the stub first
clean_env() {
  env -i HOME="$HOME" PATH="$W/bin:/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin:/usr/local/bin" \
    STUB_LOG="$LOG" STUB_WASM="$W/wasm" TMPDIR="$W/tmp" "$@"
}
exec_script() { # [VAR=val...] [-- script args]: stdin is /dev/null, so no terminal
  local envs=()
  while [ $# -gt 0 ] && [ "$1" != "--" ]; do envs+=("$1"); shift; done
  [ "${1:-}" = "--" ] && shift
  OUT=$(cd "$W" && clean_env "${envs[@]+"${envs[@]}"}" python3 "$W/notty.py" bash "$REPO/scripts/deploy-mainnet.sh" "$@" </dev/null 2>&1)
  RC=$?
}
typed() { # <answer> [VAR=val...]: run with a terminal and type <answer> at the prompt
  local answer=$1
  shift
  fresh_repo
  OUT=$(cd "$W" && python3 "$W/type_answer.py" "$answer" env -i HOME="$HOME" \
    PATH="$W/bin:/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin:/usr/local/bin" \
    STUB_LOG="$LOG" STUB_WASM="$W/wasm" TMPDIR="$W/tmp" "$@" bash "$REPO/scripts/deploy-mainnet.sh" 2>&1)
  RC=$?
}
check() { # <name> <command...>
  local name=$1
  shift
  if "$@"; then PASS=$((PASS + 1)); else FAIL=$((FAIL + 1)) && printf 'FAIL  %s\n%s\n' "$name" "$(printf '%s\n' "$OUT" | tail -5 | sed 's/^/      | /')"; fi
}
out_has() { printf '%s\n' "$OUT" | grep -Eq -- "$1"; }
out_lacks() { ! printf '%s\n' "$OUT" | grep -Eq -- "$1"; }
rejects() { # <name> <message regex> [VAR=val...]: exits 1 before any network call or write
  local name=$1 re=$2
  shift 2
  fresh_repo
  exec_script "$@"
  check "$name: exits 1" [ "$RC" = 1 ]
  check "$name: says /$re/" out_has "$re"
  check "$name: no network call or write" no_writes
  check "$name: no log" no_log
}
no_writes() { ! grep -Eq 'network info|contract (build|upload|deploy|invoke)' "$LOG"; }
no_submits() { ! grep -Eq 'contract (upload|deploy|invoke)' "$LOG"; }
no_log() { [ ! -e "$DLOG" ]; }
log_has() { grep -Eq -- "$1" "$DLOG" 2>/dev/null; }
calls() { grep -c -e "$1" "$LOG"; }
no_secret_in_log() { ! grep -Eq "S[A-Z2-7]{55}" "$DLOG"; }
nothing_deployed() { ! grep -q "contract deploy" "$LOG" && no_log; }

# --- inputs are validated before anything else runs ---
fresh_repo && exec_script -- --help
check "--help exits 0 with usage" [ "$RC" = 0 ]
check "--help prints the gates" out_has "Gate 1  the .mainnet. network"
fresh_repo && exec_script "${BASE[@]}" -- --dry-run
check "--dry-run flag refused (not a silent real run)" [ "$RC" = 1 ]
check "--dry-run flag: no stellar call" [ ! -s "$LOG" ]
fresh_repo && exec_script -- "$SECRET"
check "positional secret is not echoed" out_lacks "$SECRET"
rejects "missing ADMIN" "ADMIN is required" ATTESTER=attester USDC_SAC=$CIRCLE_USDC DAILY_CAP=1
rejects "missing ATTESTER" "ATTESTER is required" ADMIN=admin USDC_SAC=$CIRCLE_USDC DAILY_CAP=1
rejects "missing USDC_SAC" "USDC_SAC is required" ADMIN=admin ATTESTER=attester DAILY_CAP=1
rejects "missing DAILY_CAP" "DAILY_CAP is required" ADMIN=admin ATTESTER=attester USDC_SAC=$CIRCLE_USDC
for cap in 0 -5 50USDC 1000000000000000000; do
  rejects "DAILY_CAP=$cap" "positive whole number" "${BASE[@]}" DAILY_CAP=$cap
done
rejects "DAILY_CAP below a reward" "DAILY_CAP must be at least 20000000 stroops: reward 3" "${BASE[@]}" DAILY_CAP=19999999
fresh_repo && exec_script "${BASE[@]}" DRY_RUN=1 DAILY_CAP=20000000
check "DAILY_CAP equal to the largest reward is accepted" [ "$RC" = 0 ]
for dr in true yes 2; do rejects "DRY_RUN=$dr" "DRY_RUN must be 0 or 1" "${BASE[@]}" DRY_RUN=$dr; done
rejects "ADMIN secret key" "never a secret key" "${BASE[@]}" ADMIN=$SECRET
check "ADMIN secret key is not echoed" out_lacks "$SECRET"
rejects "ADMIN seed phrase" "never a secret key" "${BASE[@]}" "ADMIN=abandon ability able about"
check "ADMIN seed phrase is not echoed" out_lacks "abandon"
rejects "ADMIN address" "identity name" "${BASE[@]}" ADMIN=$ADMIN_G
rejects "ADMIN flag-like" "identity name" "${BASE[@]}" ADMIN=--network
rejects "ATTESTER secret key" "never a secret key" "${BASE[@]}" ATTESTER=$SECRET
check "ATTESTER secret key is not echoed" out_lacks "$SECRET"
rejects "USDC_SAC not a contract id" "must be a C\.\.\. contract id" "${BASE[@]}" USDC_SAC=$ADMIN_G
rejects "unknown identity" "no stellar identity named 'nobody'" "${BASE[@]}" ADMIN=nobody
rejects "ATTESTER same key as ADMIN" "different key from ADMIN" "${BASE[@]}" ATTESTER=sameasadmin

# --- Gate 1: passphrase (config, run-time resolution, RPC) ---
rejects "gate 1: testnet passphrase in config" "configured with passphrase '$TEST'" "${BASE[@]}" "STUB_CONFIGURED=$TEST"
rejects "gate 1: testnet config in a dry run" "configured with passphrase '$TEST'" "${BASE[@]}" DRY_RUN=1 "STUB_CONFIGURED=$TEST"
rejects "gate 1: env/.env override" "does not resolve to the mainnet passphrase at run time" "${BASE[@]}" "STUB_RESOLVED=$TEST"
fresh_repo && exec_script "${BASE[@]}" "STUB_RPC=$TEST"
check "gate 1: testnet RPC server refused" out_has "RPC server reports passphrase '$TEST'"
check "gate 1: testnet RPC: nothing submitted" no_submits
fresh_repo && exec_script "${BASE[@]}" STUB_RPC_DOWN=1
check "gate 1: unreachable RPC refused" out_has "could not query the 'mainnet' RPC"

# --- Gate 2: Circle USDC ---
fresh_repo && exec_script "${BASE[@]}" USDC_SAC=$TESTNET_USDC
check "gate 2: non-Circle SAC refused" out_has "USDC_SAC=$TESTNET_USDC is not Circle's mainnet USDC SAC. Use USDC_SAC=$CIRCLE_USDC"
check "gate 2: nothing submitted" no_submits
check "gate 2: no log" no_log

# --- dry run ---
fresh_repo && exec_script "${BASE[@]}" DRY_RUN=1
check "dry run exits 0" [ "$RC" = 0 ]
check "dry run: nothing submitted" no_submits
check "dry run: deployment-log.md untouched" no_log
check "dry run: build dir cleaned up" [ -z "$(ls -A "$W/tmp")" ]
for re in \
  "contract upload --wasm .*/alvinmunk_reputation.wasm --optimize=false --source-account admin --network mainnet$" \
  "contract deploy --wasm-hash [0-9a-f]{64} --source-account admin --network mainnet$" \
  "--id <reputation-id> .* -- init --admin $ADMIN_G$" \
  "--id <quest_registry-id> .* -- init --admin $ADMIN_G --reputation <reputation-id>$" \
  "--id <rewards-id> .* -- init --admin $ADMIN_G --usdc $CIRCLE_USDC --reputation <reputation-id>$" \
  "--id <registry-id> .* -- init --admin $ADMIN_G$" \
  "--id <gate-id> .* -- init --admin $ADMIN_G --reputation <reputation-id>$" \
  "--id <rewards-id> .* -- set_daily_cap --cap 500000000$" \
  "--id <rewards-id> .* -- set_require_funding --on true$" \
  "--id <reputation-id> .* -- add_attester --attester <quest_registry-id>$" \
  "--id <quest_registry-id> .* -- add_attester_key --key $ATTESTER_HEX$" \
  "-- create_quest --id 4 --schema_id 2 --xp 25$" \
  "-- add_reward --reward_id 3 --threshold 100 --amount 20000000$" \
  "-- create_gate --id 2 --track 1 --min 30 --label '\"Bounty board\"'$" \
  "Daily cap +500000000 stroops = 50.0000000 USDC" \
  "rewards +$(sha256 "$W/wasm/alvinmunk_rewards.wasm")$"; do
  check "dry run prints /$re/" out_has "$re"
done
check "dry run: never friendbot / faucet / --fund" out_lacks "friendbot|faucet|--fund"
check "dry run: attester G-address is not a reputation attester" out_lacks "add_attester --attester G"
fresh_repo && exec_script "${BASE[@]}" DRY_RUN=1 ATTESTER=$ATTESTER_G
check "ATTESTER as a G... public key works" out_has "add_attester_key --key $ATTESTER_HEX$"

# --- dirty checkout ---
fresh_repo && echo "edit" >>"$REPO/contracts/Cargo.toml" && exec_script "${BASE[@]}"
check "uncommitted contracts/ changes: real run refused" out_has "uncommitted changes: commit them"
check "uncommitted contracts/ changes: nothing submitted" no_submits
fresh_repo && echo "edit" >>"$REPO/contracts/Cargo.toml" && exec_script "${BASE[@]}" DRY_RUN=1
check "uncommitted contracts/ changes: dry run warns, completes" [ "$RC" = 0 ]
fresh_repo && echo '{"x":1}' >"$REPO/contracts/reputation/test_snapshots/a.json" && exec_script "${BASE[@]}"
check "test_snapshots changes alone do not block" out_has "Gate 3/3"

# --- Gate 3: typed confirmation on the terminal ---
fresh_repo && exec_script "${BASE[@]}"
check "gate 3: no terminal -> refused" out_has "must be typed in an interactive terminal"
check "gate 3: no terminal: nothing submitted" no_submits
fresh_repo
OUT=$(cd "$W" && printf 'mainnet\n' | clean_env "${BASE[@]}" python3 "$W/notty.py" bash "$REPO/scripts/deploy-mainnet.sh" 2>&1)
check "gate 3: 'mainnet' piped on stdin does not confirm" no_submits
for answer in Mainnet yes ""; do
  typed "$answer" "${BASE[@]}"
  check "gate 3: '$answer' is not a confirmation" out_has "not confirmed; nothing was submitted"
  check "gate 3: '$answer': nothing submitted" no_submits
done

# --- full run (stub) ---
typed mainnet "${BASE[@]}"
check "full run exits 0" [ "$RC" = 0 ]
check "full run: COMPLETE entry" log_has "mainnet, COMPLETE$"
check "full run: commit SHA logged" log_has "Commit: \`$(git -C "$REPO" rev-parse HEAD)\`"
check "full run: deployer logged" log_has "Deployer / admin: \`$ADMIN_G\`"
for c in reputation quest_registry rewards registry gate; do
  h=$(sha256 "$W/wasm/alvinmunk_$c.wasm")
  check "full run: $c id + wasm hash logged" log_has "^\| $c \| \[\`C[A-Z2-7]{55}\`\]\(https://stellar.expert/explorer/public/contract/C[A-Z2-7]{55}\) \| \`$h\` \|$"
done
check "full run: no secret in the log" no_secret_in_log
check "full run: upload, deploy, init per contract" \
  [ "$(grep -E 'contract (upload|deploy)| -- init ' "$LOG" | awk '{ print $3 }' | tr '\n' ' ')" = "$(printf 'upload deploy invoke %.0s' 1 2 3 4 5)" ]
check "full run: 5 inits" [ "$(calls ' -- init ')" = 5 ]
check "full run: safety settings before the reward table" \
  [ "$(grep -n set_require_funding "$LOG" | cut -d: -f1)" -lt "$(grep -n add_reward "$LOG" | head -1 | cut -d: -f1)" ]
check "full run: 3 read-backs" [ "$(calls '--send=no')" = 3 ]
check "full run: prints the web env" out_has "NEXT_PUBLIC_GATE_CONTRACT_ID=C[A-Z2-7]{55}"

# --- failures once contracts exist are logged as INCOMPLETE ---
typed mainnet "${BASE[@]}" STUB_FAIL="--usdc"
check "init failure: front-run warning" out_has "init of rewards \(C[A-Z2-7]{55}\) failed. If someone else initialized it first"
check "init failure: init is not retried" [ "$(calls '--usdc')" = 1 ]
check "init failure: INCOMPLETE entry names the step" log_has "INCOMPLETE \(failed during: init rewards\)"
check "init failure: later contracts 'not deployed'" log_has "^\| gate \| not deployed \|"
typed mainnet "${BASE[@]}" STUB_BAD_UPLOAD=1
check "upload hash mismatch: aborts" out_has "is not the local build's sha256"
check "upload hash mismatch: nothing deployed or logged" nothing_deployed
typed mainnet "${BASE[@]}" STUB_FAIL="-- create_quest --id 3"
check "idempotent setter: retried 3 times" [ "$(calls '-- create_quest --id 3')" = 3 ]
check "idempotent setter: INCOMPLETE (seed data)" log_has "INCOMPLETE \(failed during: seed data\)"
typed mainnet "${BASE[@]}" STUB_VIEW_FUNDING=false
check "read-back mismatch: aborts" out_has "get_require_funding is not true"
check "read-back mismatch: INCOMPLETE (verify)" log_has "INCOMPLETE \(failed during: verify\)"
typed mainnet "${BASE[@]}" STUB_INT="add_attester_key"
check "Ctrl-C mid-deploy: INCOMPLETE (attesters)" log_has "INCOMPLETE \(failed during: attesters\)"
check "Ctrl-C mid-deploy: stops submitting" [ "$(calls create_quest)" = 0 ]
fresh_repo && exec_script "${BASE[@]}" DRY_RUN=1 STUB_BUILD_FAIL=1
check "build failure: aborts" out_has "contract build failed"

echo "deploy-mainnet.sh: $PASS passed, $FAIL failed"
[ "$FAIL" = 0 ]
