#!/usr/bin/env bash
# Deploy the five alvinmunk contracts to Stellar MAINNET, fully wired, behind three gates.
# Mainnet is irreversible, so every check runs before anything is submitted:
#
#   Gate 1  the `mainnet` network resolves to "Public Global Stellar Network ; September 2015"
#           in the CLI config, in the CLI's actual resolution (STELLAR_RPC_URL and
#           STELLAR_NETWORK_PASSPHRASE in the env or a .env file override --network), and in
#           what the RPC server itself reports.
#   Gate 2  USDC_SAC is Circle's USDC SAC, derived with `stellar contract id asset`.
#   Gate 3  the operator types `mainnet` at a prompt read from the terminal, never from stdin.
#
# Then it builds (cargo --locked, into a fresh directory), uploads and deploys each contract
# and inits it straight away, turns on set_daily_cap(DAILY_CAP) and set_require_funding(true),
# wires the attesters and rewards -> quest_registry, seeds the quests / reward table / gates
# exactly like scripts/redeploy-all.sh, reads the safety settings back, and appends the
# contract ids, wasm hashes, deployer key and commit SHA to deployment-log.md. It never calls
# friendbot or the faucet and never moves USDC: fund the rewards treasury by hand afterwards.
#
# Usage (inputs are env vars; see docs/DEPLOY_MAINNET.md):
#   ADMIN=<identity> ATTESTER=<identity|G...> USDC_SAC=<C...> DAILY_CAP=<stroops> \
#     ./scripts/deploy-mainnet.sh
#   DRY_RUN=1 ...  same checks and build, prints every transaction, submits nothing.
set -euo pipefail

NETWORK=mainnet
MAINNET_PASSPHRASE="Public Global Stellar Network ; September 2015"
# Both ids only exist under the mainnet passphrase (derived offline by `stellar contract id asset`).
MAINNET_NATIVE_SAC=CAS3J7GYLGXMF6TDJBBYYSE3HQ6BBSMLNUQ34T6TZMYMW2EVH34XOWMA
CIRCLE_USDC_ASSET=USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN
CIRCLE_USDC_SAC=CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75
CONTRACTS="reputation quest_registry rewards registry gate" # deploy order: reputation first

# Seed data, identical to scripts/redeploy-all.sh so the app's quest ids (1-4) and gates resolve.
QUESTS="1:2:50 2:2:30 3:2:50 4:2:25"                     # id:schema_id:xp
REWARD_TABLE="1:30:5000000 2:60:10000000 3:100:20000000" # reward_id:earned_xp:usdc_stroops

NAME_RE='^[A-Za-z0-9][A-Za-z0-9_-]*$' # a `stellar keys` identity name
STRKEY_RE='^[GSCM][A-Z2-7]{55}'        # anything key-shaped is never taken as a name
G_RE='^G[A-Z2-7]{55}$'
C_RE='^C[A-Z2-7]{55}$'
HEX32_RE='^[0-9a-f]{64}$'
CAP_RE='^[1-9][0-9]{0,17}$' # positive stroops; 0 would mean "no cap" in the contract

if [ -t 1 ]; then
  RED=$'\033[0;31m' GREEN=$'\033[0;32m' YELLOW=$'\033[1;33m' BLUE=$'\033[0;34m' NC=$'\033[0m'
else
  RED='' GREEN='' YELLOW='' BLUE='' NC=''
fi

# --- Helpers ---

info() { printf '%s==> %s%s\n' "$BLUE" "$*" "$NC"; }
ok() { printf '%s  ok %s%s\n' "$GREEN" "$*" "$NC"; }
warn() { printf '%s  warning: %s%s\n' "$YELLOW" "$*" "$NC" >&2; }
die() {
  printf '%sERROR: %s%s\n' "$RED" "$*" "$NC" >&2
  exit 1
}
usage() { awk 'NR > 1 && /^#/ { sub(/^# ?/, ""); print; next } NR > 1 { exit }' "$0"; }

# Print a command the way a real run would execute it (dry run).
show() {
  local out="" a
  for a in "$@"; do
    case $a in '' | *[!A-Za-z0-9_./:=@\<\>-]*) a="'$a'" ;; esac
    out="$out $a"
  done
  printf '    $%s\n' "$out"
}

sha256_of() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1"; else shasum -a 256 "$1"; fi |
    awk '{ print $1 }'
}
usdc_units() { printf '%d.%07d' "$(($1 / 10000000))" "$(($1 % 10000000))"; }
id_of() { local v="ID_$1"; printf '%s' "${!v:-}"; }
hash_of() { local v="HASH_$1"; printf '%s' "${!v:-}"; }
any_deployed() {
  local c
  for c in $CONTRACTS; do [ -z "$(id_of "$c")" ] || return 0; done
  return 1
}

# shellcheck disable=SC2016 # the backticks are Markdown code spans
write_log() { # $1 = status
  local c id
  if [ ! -f "$DEPLOY_LOG" ]; then
    printf '# Deployment log\n\nAppend-only. `scripts/deploy-mainnet.sh` adds an entry for every run that created contracts.\n' >"$DEPLOY_LOG"
  fi
  {
    printf '\n## %s: %s, %s\n\n' "$TIMESTAMP" "$NETWORK" "$1"
    printf -- '- Commit: `%s`\n' "$GIT_SHA"
    printf -- '- Deployer / admin: `%s`\n' "$ADMIN_ADDR"
    printf -- '- Attester: `%s` (ed25519 `%s`)\n' "$ATTESTER_ADDR" "$ATTESTER_KEY"
    printf -- '- USDC SAC: `%s` (%s)\n' "$USDC_SAC" "$CIRCLE_USDC_ASSET"
    printf -- '- Daily cap: %s stroops (%s USDC); proof-of-funding required\n' "$DAILY_CAP" "$(usdc_units "$DAILY_CAP")"
    printf -- '- stellar CLI: %s\n\n' "$CLI_VERSION"
    printf '| Contract | Contract id | WASM hash (sha256) |\n| --- | --- | --- |\n'
    for c in $CONTRACTS; do
      id=$(id_of "$c")
      if [ -n "$id" ]; then id="[\`$id\`](https://stellar.expert/explorer/public/contract/$id)"; else id="not deployed"; fi
      printf '| %s | %s | `%s` |\n' "$c" "$id" "$(hash_of "$c")"
    done
  } >>"$DEPLOY_LOG"
}

# Contract ids, set once each deploy succeeds (placeholders in a dry run).
ID_reputation="" ID_quest_registry="" ID_rewards="" ID_registry="" ID_gate=""
BUILD_DIR=""
STEP=""  # the mainnet step in progress, named in the log entry of a failed run
DONE=0   # set once the COMPLETE entry is written; `$?` is 0 in an EXIT trap after Ctrl-C
on_exit() {
  [ -z "$BUILD_DIR" ] || rm -rf "$BUILD_DIR"
  if [ "$DRY_RUN" = 0 ] && [ "$DONE" = 0 ] && any_deployed; then
    write_log "INCOMPLETE (failed during: $STEP)"
    printf '%sContracts were created on mainnet before the failure and are recorded in %s. Do not wire the app to an incomplete set: fix the cause and rerun.%s\n' \
      "$RED" "$DEPLOY_LOG" "$NC" >&2
  fi
}

# One admin-signed call. In a dry run, print it instead.
invoke() { # $1 = contract id, rest = function + args
  local id=$1
  shift
  if [ "$DRY_RUN" = 1 ]; then
    show stellar contract invoke --id "$id" --source-account "$ADMIN" --network "$NETWORK" --send=yes -- "$@"
    return 0
  fi
  stellar contract invoke --id "$id" --source-account "$ADMIN" --network "$NETWORK" --send=yes -- "$@" >/dev/null
}

# Admin setters that are safe to repeat, retried so a transient RPC or TxBadSeq error does not
# strand a half-wired deploy. `init` is never retried.
invoke_retry() {
  local n=1
  until invoke "$@"; do
    [ "$n" -lt 3 ] || return 1
    warn "attempt $n/3 of '$2' failed, retrying"
    n=$((n + 1))
    sleep 3
  done
}

# Upload the built wasm, deploy an instance, and init it immediately: `init` is open to anyone
# until it has run, so the window between deploy and init stays as short as possible.
deploy_and_init() { # $1 = contract, rest = init args
  local c=$1 wasm="$BUILD_DIR/alvinmunk_$1.wasm" hash onchain id
  shift
  hash=$(hash_of "$c")
  if [ "$DRY_RUN" = 1 ]; then
    show stellar contract upload --wasm "$wasm" --optimize=false --source-account "$ADMIN" --network "$NETWORK"
    show stellar contract deploy --wasm-hash "$hash" --source-account "$ADMIN" --network "$NETWORK"
    printf -v "ID_$c" '<%s-id>' "$c"
    invoke "$(id_of "$c")" init "$@"
    return 0
  fi
  STEP="upload $c"
  onchain=$(stellar contract upload --wasm "$wasm" --optimize=false --source-account "$ADMIN" --network "$NETWORK") ||
    die "upload of $c failed"
  [ "$onchain" = "$hash" ] || die "the uploaded $c wasm hash '$onchain' is not the local build's sha256 $hash"
  STEP="deploy $c"
  id=$(stellar contract deploy --wasm-hash "$hash" --source-account "$ADMIN" --network "$NETWORK") ||
    die "deploy of $c failed"
  [[ $id =~ $C_RE ]] || die "deploy of $c returned '$id', not a contract id"
  printf -v "ID_$c" '%s' "$id"
  STEP="init $c"
  invoke "$id" init "$@" ||
    die "init of $c ($id) failed. If someone else initialized it first, never use this contract; rerun the deploy."
  ok "$c $id"
}

view() { # $1 = contract id, rest = function + args; prints the bare return value
  local id=$1
  shift
  stellar contract invoke --id "$id" --source-account "$ADMIN" --network "$NETWORK" --send=no -- "$@" | tr -d '"[:space:]'
}

# --- Inputs (all validated before any network call) ---

if [ "$#" -gt 0 ]; then
  case "$1" in -h | --help) usage && exit 0 ;; esac
  die "this script takes no arguments; configure it with env vars (--help). A dry run is DRY_RUN=1."
fi

DRY_RUN="${DRY_RUN:-0}"
ADMIN="${ADMIN:-}"
ATTESTER="${ATTESTER:-}"
USDC_SAC="${USDC_SAC:-}"
DAILY_CAP="${DAILY_CAP:-}"

case "$DRY_RUN" in 0 | 1) ;; *) die "DRY_RUN must be 0 or 1" ;; esac
[ -n "$ADMIN" ] || die "ADMIN is required: the stellar identity name of the funded mainnet admin"
if [[ ! $ADMIN =~ $NAME_RE ]] || [[ $ADMIN =~ $STRKEY_RE ]]; then
  die "ADMIN must be a stellar identity name (stellar keys ls), never a secret key, seed phrase or address"
fi
[ -n "$ATTESTER" ] || die "ATTESTER is required: the off-chain attester's identity name or G... public key"
if [[ ! $ATTESTER =~ $G_RE ]] && { [[ ! $ATTESTER =~ $NAME_RE ]] || [[ $ATTESTER =~ $STRKEY_RE ]]; }; then
  die "ATTESTER must be a stellar identity name or a G... public key, never a secret key or seed phrase"
fi
[ -n "$USDC_SAC" ] || die "USDC_SAC is required: Circle's mainnet USDC SAC ($CIRCLE_USDC_SAC)"
[[ $USDC_SAC =~ $C_RE ]] || die "USDC_SAC must be a C... contract id"
[ -n "$DAILY_CAP" ] || die "DAILY_CAP is required: the max USDC (in stroops) the rewards treasury pays per UTC day"
[[ $DAILY_CAP =~ $CAP_RE ]] || die "DAILY_CAP must be a positive whole number of stroops (1 USDC = 10000000)"
# rewards.add_reward refuses a payout above the daily cap, so check it before deploying anything.
for r in $REWARD_TABLE; do
  IFS=: read -r rid _ amount <<<"$r"
  [ "$DAILY_CAP" -ge "$amount" ] || die "DAILY_CAP must be at least $amount stroops: reward $rid pays that much and add_reward rejects a payout above the cap"
done

for tool in stellar jq git awk; do
  command -v "$tool" >/dev/null 2>&1 || die "'$tool' is required but not installed"
done
command -v sha256sum >/dev/null 2>&1 || command -v shasum >/dev/null 2>&1 || die "sha256sum or shasum is required"

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT" # one fixed cwd: the stellar CLI also reads .env files from here and its parents
DEPLOY_LOG="$ROOT/deployment-log.md"
TIMESTAMP=$(date -u +%Y-%m-%dT%H:%M:%SZ)

GIT_SHA=$(git rev-parse --verify HEAD 2>/dev/null) || die "not a git checkout: the deployment log must record the deployed commit"
if [ -n "$(git status --porcelain -- contracts ':(exclude)contracts/*/test_snapshots/*')" ]; then
  [ "$DRY_RUN" = 1 ] || die "contracts/ has uncommitted changes: commit them so the logged SHA is the code that ships"
  warn "contracts/ has uncommitted changes; a real run refuses to deploy them"
fi
if [ "$DRY_RUN" = 0 ] && ! { [ -w "$DEPLOY_LOG" ] || { [ ! -e "$DEPLOY_LOG" ] && [ -w "$ROOT" ]; }; }; then
  die "$DEPLOY_LOG is not writable"
fi

ADMIN_ADDR=$(stellar keys address "$ADMIN" 2>/dev/null) || die "no stellar identity named '$ADMIN' (stellar keys ls)"
[[ $ADMIN_ADDR =~ $G_RE ]] || die "identity '$ADMIN' did not resolve to a G... address"
if [[ $ATTESTER =~ $G_RE ]]; then
  ATTESTER_ADDR=$ATTESTER
else
  ATTESTER_ADDR=$(stellar keys address "$ATTESTER" 2>/dev/null) || die "no stellar identity named '$ATTESTER' (stellar keys ls)"
  [[ $ATTESTER_ADDR =~ $G_RE ]] || die "identity '$ATTESTER' did not resolve to a G... address"
fi
[ "$ATTESTER_ADDR" != "$ADMIN_ADDR" ] || die "ATTESTER must be a different key from ADMIN (the attester secret lives on the web server)"
# quest_registry allowlists the attester by its raw ed25519 public key (what /api/attest signs with).
ATTESTER_KEY=$(stellar strkey decode "$ATTESTER_ADDR" 2>/dev/null | jq -r '.public_key_ed25519 // empty' 2>/dev/null) || true
[[ $ATTESTER_KEY =~ $HEX32_RE ]] || die "cannot derive the attester's ed25519 key from $ATTESTER_ADDR (needs a stellar CLI with 'strkey decode')"
CLI_VERSION=$(stellar --version 2>/dev/null | sed -n 1p) || CLI_VERSION=unknown

# --- Gate 1: the network is mainnet ---

info "Gate 1/3: '$NETWORK' must be the mainnet passphrase"
CONFIGURED_PASSPHRASE=$(stellar network ls --long 2>/dev/null | awk -v n="$NETWORK" '
  /^Name: / { blk = ($2 == n) }
  blk && /^Network passphrase: / { sub(/^Network passphrase: /, ""); print; exit }') || true
if [ "$CONFIGURED_PASSPHRASE" != "$MAINNET_PASSPHRASE" ]; then
  die "network '$NETWORK' is configured with passphrase '${CONFIGURED_PASSPHRASE:-<none>}', not '$MAINNET_PASSPHRASE'. Is it pointing at testnet? Fix it with: stellar network add $NETWORK --rpc-url <mainnet RPC> --network-passphrase \"$MAINNET_PASSPHRASE\""
fi
RESOLVED_NATIVE_SAC=$(stellar contract id asset --asset native --network "$NETWORK" 2>/dev/null) || RESOLVED_NATIVE_SAC=""
if [ "$RESOLVED_NATIVE_SAC" != "$MAINNET_NATIVE_SAC" ]; then
  die "'--network $NETWORK' does not resolve to the mainnet passphrase at run time. STELLAR_RPC_URL / STELLAR_NETWORK_PASSPHRASE in the environment or in a .env file ($ROOT or a parent directory) override --network; remove them."
fi
RPC_PASSPHRASE=$(stellar network info --network "$NETWORK" --output json 2>/dev/null | jq -r '.passphrase // empty' 2>/dev/null) || RPC_PASSPHRASE=""
[ -n "$RPC_PASSPHRASE" ] || die "could not query the '$NETWORK' RPC; check it with: stellar network info --network $NETWORK"
if [ "$RPC_PASSPHRASE" != "$MAINNET_PASSPHRASE" ]; then
  die "the '$NETWORK' RPC server reports passphrase '$RPC_PASSPHRASE': its URL points at another network"
fi
ok "config, CLI resolution and RPC all say: $MAINNET_PASSPHRASE"

# --- Gate 2: USDC is Circle's ---

info "Gate 2/3: USDC_SAC must be Circle's USDC"
DERIVED_USDC_SAC=$(stellar contract id asset --asset "$CIRCLE_USDC_ASSET" --network "$NETWORK" 2>/dev/null) || DERIVED_USDC_SAC=""
if [ "$DERIVED_USDC_SAC" != "$CIRCLE_USDC_SAC" ]; then
  die "stellar contract id asset derived '${DERIVED_USDC_SAC:-<nothing>}' for $CIRCLE_USDC_ASSET, expected $CIRCLE_USDC_SAC"
fi
if [ "$USDC_SAC" != "$DERIVED_USDC_SAC" ]; then
  die "USDC_SAC=$USDC_SAC is not Circle's mainnet USDC SAC. Use USDC_SAC=$DERIVED_USDC_SAC (derived from $CIRCLE_USDC_ASSET), never a self-issued asset."
fi
ok "$USDC_SAC = SAC of $CIRCLE_USDC_ASSET"

# --- Build (local only) ---

trap on_exit EXIT
info "Building contracts (cargo --locked, fresh output directory)"
TMP_ROOT=${TMPDIR:-/tmp}
BUILD_DIR=$(mktemp -d "${TMP_ROOT%/}/alvinmunk-mainnet.XXXXXX")
(cd contracts && stellar contract build --locked --out-dir "$BUILD_DIR") || die "contract build failed"
for c in $CONTRACTS; do
  [ -s "$BUILD_DIR/alvinmunk_$c.wasm" ] || die "the build did not produce alvinmunk_$c.wasm"
  h=$(sha256_of "$BUILD_DIR/alvinmunk_$c.wasm")
  [[ $h =~ $HEX32_RE ]] || die "could not hash alvinmunk_$c.wasm"
  printf -v "HASH_$c" '%s' "$h"
done

# --- Plan + Gate 3 ---

info "Deployment plan"
cat <<EOF
  Network         $NETWORK ($MAINNET_PASSPHRASE)
  Commit          $GIT_SHA
  stellar CLI     $CLI_VERSION
  Admin           $ADMIN ($ADMIN_ADDR): deployer and admin of all five contracts
  Attester        $ATTESTER_ADDR, ed25519 $ATTESTER_KEY
  USDC SAC        $USDC_SAC (Circle)
  Daily cap       $DAILY_CAP stroops = $(usdc_units "$DAILY_CAP") USDC per UTC day
  Funding proof   required (set_require_funding true)
  Quests          $QUESTS (id:schema:xp)
  Reward table    $REWARD_TABLE (id:earned_xp:stroops)
  Gates           1 = Social >= 20 "Inner circle", 2 = Earned >= 30 "Bounty board"
  WASM sha256
EOF
for c in $CONTRACTS; do printf '    %-15s %s\n' "$c" "$(hash_of "$c")"; done

if [ "$DRY_RUN" = 1 ]; then
  info "DRY RUN: the transactions a real run would submit, in order"
else
  info "Gate 3/3: operator confirmation"
  { printf "%sThis deploys to MAINNET and cannot be undone. Type 'mainnet' to continue: %s" "$YELLOW" "$NC" >/dev/tty; } 2>/dev/null ||
    die "the confirmation must be typed in an interactive terminal; it is never read from stdin"
  CONFIRM=""
  IFS= read -r CONFIRM </dev/tty || CONFIRM=""
  [ "$CONFIRM" = mainnet ] || die "not confirmed; nothing was submitted"
  ok "confirmed"
fi

# --- Mainnet writes ---

info "Deploying and initializing (upload, deploy, init per contract)"
deploy_and_init reputation --admin "$ADMIN_ADDR"
deploy_and_init quest_registry --admin "$ADMIN_ADDR" --reputation "$ID_reputation"
deploy_and_init rewards --admin "$ADMIN_ADDR" --usdc "$USDC_SAC" --reputation "$ID_reputation"
deploy_and_init registry --admin "$ADMIN_ADDR"
deploy_and_init gate --admin "$ADMIN_ADDR" --reputation "$ID_reputation"

info "Treasury safety: daily cap + proof-of-funding"
STEP="rewards safety settings"
invoke_retry "$ID_rewards" set_daily_cap --cap "$DAILY_CAP" || die "rewards.set_daily_cap failed"
invoke_retry "$ID_rewards" set_require_funding --on true || die "rewards.set_require_funding failed"

info "Attesters: quest_registry -> reputation, attester key -> quest_registry"
STEP="attesters"
invoke_retry "$ID_reputation" add_attester --attester "$ID_quest_registry" || die "reputation.add_attester failed"
invoke_retry "$ID_quest_registry" add_attester_key --key "$ATTESTER_KEY" || die "quest_registry.add_attester_key failed"

info "Wiring rewards -> quest_registry (streak-gated rewards read get_streak)"
STEP="wiring"
invoke_retry "$ID_rewards" set_quest_registry --quest_registry "$ID_quest_registry" ||
  die "rewards.set_quest_registry failed"

info "Seeding quests, reward table and gates"
STEP="seed data"
for q in $QUESTS; do
  IFS=: read -r qid schema xp <<<"$q"
  invoke_retry "$ID_quest_registry" create_quest --id "$qid" --schema_id "$schema" --xp "$xp" ||
    die "create_quest $qid failed"
done
for r in $REWARD_TABLE; do
  IFS=: read -r rid threshold amount <<<"$r"
  invoke_retry "$ID_rewards" add_reward --reward_id "$rid" --threshold "$threshold" --amount "$amount" ||
    die "add_reward $rid failed"
done
invoke_retry "$ID_gate" create_gate --id 1 --track 0 --min 20 --label '"Inner circle"' || die "create_gate 1 failed"
invoke_retry "$ID_gate" create_gate --id 2 --track 1 --min 30 --label '"Bounty board"' || die "create_gate 2 failed"

if [ "$DRY_RUN" = 1 ]; then
  info "Then it reads back get_require_funding, get_daily_cap, get_quest_registry and reputation.is_attester(quest_registry)"
  ok "DRY RUN complete: nothing was submitted and $DEPLOY_LOG was not touched. Rerun without DRY_RUN=1 to deploy."
  exit 0
fi

info "Verifying the safety settings on chain"
STEP="verify"
[ "$(view "$ID_rewards" get_require_funding)" = true ] || die "rewards.get_require_funding is not true"
[ "$(view "$ID_rewards" get_daily_cap)" = "$DAILY_CAP" ] || die "rewards.get_daily_cap is not $DAILY_CAP"
[ "$(view "$ID_rewards" get_quest_registry)" = "$ID_quest_registry" ] ||
  die "rewards.get_quest_registry is not $ID_quest_registry"
[ "$(view "$ID_reputation" is_attester --who "$ID_quest_registry")" = true ] ||
  die "quest_registry is not an attester of reputation"
ok "proof-of-funding on, daily cap $DAILY_CAP, rewards wired to quest_registry, quest_registry allowlisted"

STEP="write log"
write_log COMPLETE
DONE=1
ok "recorded in $DEPLOY_LOG"

cat <<EOF

Mainnet deployment complete. Web env (Vercel production):

NEXT_PUBLIC_STELLAR_NETWORK=mainnet
NEXT_PUBLIC_NETWORK_PASSPHRASE=$MAINNET_PASSPHRASE
NEXT_PUBLIC_RPC_URL=<your mainnet RPC URL>
NEXT_PUBLIC_HORIZON_URL=https://horizon.stellar.org
NEXT_PUBLIC_REPUTATION_CONTRACT_ID=$ID_reputation
NEXT_PUBLIC_QUEST_REGISTRY_CONTRACT_ID=$ID_quest_registry
NEXT_PUBLIC_REWARDS_CONTRACT_ID=$ID_rewards
NEXT_PUBLIC_REGISTRY_CONTRACT_ID=$ID_registry
NEXT_PUBLIC_GATE_CONTRACT_ID=$ID_gate
NEXT_PUBLIC_USDC_SAC_ID=$USDC_SAC

Next: set ATTESTER_SECRET_KEY to the secret of $ATTESTER_ADDR (server-only), commit
deployment-log.md, run the smoke test, and only then fund the treasury by transferring USDC to
$ID_rewards. Claims revert with NotFunded until the funding verifier calls set_funded.
EOF
