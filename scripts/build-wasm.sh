#!/usr/bin/env bash
# Build the Stellar contracts this repo deploys on testnet:
#   oft, sac_manager (LayerZero's, from the monorepo), postcard_oapp, faucet, composer_vault (ours).
#
# LayerZero's Stellar crates are not on crates.io; the monorepo wires them with
# npm-style `dependencies/` trees that make cargo see the same crate at two
# paths. We instead vendor ONE canonical copy of each crate into .lz-build/vendor
# and rewrite the path dependencies (the recipe proven for the OApp skeleton).
#
# Requirements: rustup with toolchain 1.90.0 + target wasm32v1-none, git.
# Usage: bash scripts/build-wasm.sh            (clones LayerZero-Labs/monorepo-external at LZ_COMMIT)
#        LZ_MONOREPO_DIR=~/usdt0/lz-mono bash scripts/build-wasm.sh   (use a local clone)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LZ_COMMIT="${LZ_COMMIT:-b013ffef}"          # monorepo-external "Sync packages from monorepo: 1.2.53" (2026-09-10)
LZ_MONOREPO_DIR="${LZ_MONOREPO_DIR:-$ROOT/.lz-monorepo}"
BUILD="$ROOT/.lz-build"
V="$BUILD/vendor"
OUT="$ROOT/contracts/wasm"
TOOLCHAIN="${RUSTUP_TOOLCHAIN:-1.90.0}"

log() { printf '\033[1;34m[build-wasm]\033[0m %s\n' "$*"; }

# 1. Source: sparse clone of the monorepo at the pinned commit.
if [ ! -d "$LZ_MONOREPO_DIR/apps/oft-app/contracts/stellar" ]; then
  log "cloning LayerZero-Labs/monorepo-external (sparse) at $LZ_COMMIT into $LZ_MONOREPO_DIR"
  rm -rf "$LZ_MONOREPO_DIR"
  git clone -q --filter=blob:none --no-checkout https://github.com/LayerZero-Labs/monorepo-external.git "$LZ_MONOREPO_DIR"
  git -C "$LZ_MONOREPO_DIR" sparse-checkout init --cone
  git -C "$LZ_MONOREPO_DIR" sparse-checkout set apps/oft-app/contracts/stellar apps/oapp-app/contracts/stellar contracts/protocol/stellar/contracts contracts/common/utils/stellar
  git -C "$LZ_MONOREPO_DIR" checkout -q "$LZ_COMMIT"
fi
M="$LZ_MONOREPO_DIR"
SRC_COMMIT="$(git -C "$M" rev-parse --short HEAD 2>/dev/null || echo unknown)"
log "monorepo at $SRC_COMMIT"

# 2. Vendor one canonical copy of each crate.
rm -rf "$V"; mkdir -p "$V" "$BUILD/crates" "$OUT"
cp -R "$M/contracts/common/utils/stellar/common-utils-macros" "$V/common-macros"
cp -R "$M/contracts/common/utils/stellar/common-utils"        "$V/utils"
cp -R "$M/apps/oapp-app/contracts/stellar/macros"             "$V/oapp-macros"
cp -R "$M/apps/oapp-app/contracts/stellar/contracts"          "$V/oapp"
cp -R "$M/contracts/protocol/stellar/contracts/endpoint-v2"   "$V/endpoint-v2"
cp -R "$M/apps/oft-app/contracts/stellar/oft-core"            "$V/oft-core"
# The two deployable LayerZero contracts are built as their own crates.
rm -rf "$BUILD/crates/oft" "$BUILD/crates/sac-manager"
cp -R "$M/apps/oft-app/contracts/stellar/oft"                 "$BUILD/crates/oft"
cp -R "$M/apps/oft-app/contracts/stellar/sac-manager"         "$BUILD/crates/sac-manager"

# Remove the npm-style dependency trees, tests, lockfiles and per-crate toolchain pins.
find "$V" "$BUILD/crates" -maxdepth 2 -name dependencies -exec rm -rf {} + 2>/dev/null || true
find "$V" "$BUILD/crates" -type d \( -name tests -o -name integration-tests -o -name integration_tests \) -prune -exec rm -rf {} + 2>/dev/null || true
find "$V" "$BUILD/crates" \( -name package.json -o -name Cargo.lock -o -name rust-toolchain.toml \) -delete 2>/dev/null || true

# 3. Rewrite Cargo.toml path dependencies to the vendored copies, drop dev-deps, isolate workspaces.
python3 "$ROOT/scripts/lib/vendor_rewrite.py" "$V" "$BUILD/crates"
cat > "$BUILD/rust-toolchain.toml" <<TOML
[toolchain]
channel = "$TOOLCHAIN"
targets = ["wasm32v1-none"]
TOML

# 4. Build each contract.
pin_lock() { # pin soroban-spec, soroban-spec-rust and soroban-sdk-macros to 25.1.1 in the current crate's lockfile
  for c in soroban-sdk-macros soroban-spec-rust soroban-spec; do
    local cur
    cur="$(awk -v n="$c" '$0=="name = \""n"\"" {getline; gsub(/version = |"/,""); print; exit}' Cargo.lock)"
    if [ -n "$cur" ] && [ "$cur" != "25.1.1" ]; then
      RUSTUP_TOOLCHAIN="$TOOLCHAIN" cargo update "$c@$cur" --precise 25.1.1 2>&1 | tail -1
    fi
  done
}
build_one() { # $1 = crate dir, $2 = package name, $3 = output wasm name
  local dir="$1" pkg="$2" out="$3"
  log "building $pkg"
  ( cd "$dir" && rm -f Cargo.lock && RUSTUP_TOOLCHAIN="$TOOLCHAIN" cargo generate-lockfile 2>&1 | tail -1
    pin_lock
    RUSTUP_TOOLCHAIN="$TOOLCHAIN" cargo build --target wasm32v1-none --release 2>&1 | tail -3 )
  local wasm="$dir/target/wasm32v1-none/release/${pkg//-/_}.wasm"
  [ -f "$wasm" ] || { log "FAILED: $wasm not produced"; exit 1; }
  cp "$wasm" "$OUT/$out.wasm"
  log "  -> contracts/wasm/$out.wasm ($(wc -c < "$OUT/$out.wasm") bytes)"
}
build_one "$BUILD/crates/oft" oft oft
build_one "$BUILD/crates/sac-manager" sac-manager sac_manager
build_one "$ROOT/contracts/stellar/postcard-oapp" postcard-oapp postcard_oapp
build_one "$ROOT/contracts/stellar/faucet" faucet faucet
build_one "$ROOT/contracts/stellar/composer-vault" composer-vault composer_vault

# 5. Manifest with hashes so deployments are reproducible.
python3 - "$OUT" "$SRC_COMMIT" "$TOOLCHAIN" <<'PY'
import hashlib, json, os, sys, datetime
out, commit, toolchain = sys.argv[1:4]
m = {"builtAt": datetime.datetime.now(datetime.timezone.utc).isoformat(), "monorepoCommit": commit, "rustToolchain": toolchain, "target": "wasm32v1-none", "sorobanSdk": "25.1.1", "files": {}}
for f in sorted(os.listdir(out)):
    if f.endswith('.wasm'):
        b = open(os.path.join(out, f), 'rb').read()
        m["files"][f] = {"sha256": hashlib.sha256(b).hexdigest(), "bytes": len(b)}
json.dump(m, open(os.path.join(out, 'manifest.json'), 'w'), indent=2)
print(json.dumps(m, indent=2))
PY
log "done"
