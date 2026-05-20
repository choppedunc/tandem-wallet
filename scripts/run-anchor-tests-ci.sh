#!/usr/bin/env bash
set -euo pipefail

PROGRAM_ID="${PROGRAM_ID:-DLVHJQd8LUbypaoguREZ1sek4E7zeqPHYvw62KceFmQr}"
PROGRAM_SO="${PROGRAM_SO:-target/deploy/tandem_wallet.so}"
RPC_URL="${ANCHOR_PROVIDER_URL:-http://127.0.0.1:8899}"
WALLET="${ANCHOR_WALLET:-$HOME/.config/solana/id.json}"
LEDGER_DIR="${LEDGER_DIR:-.anchor/test-ledger}"
LOG_FILE="${LOG_FILE:-$LEDGER_DIR/validator.log}"
VALIDATOR_PID=""

if [ ! -f "$PROGRAM_SO" ]; then
  echo "Missing SBF program at $PROGRAM_SO"
  exit 1
fi

if [ ! -f "$WALLET" ]; then
  echo "Missing provider wallet at $WALLET"
  exit 1
fi

mkdir -p "$LEDGER_DIR"

cleanup() {
  if [ -n "$VALIDATOR_PID" ] && kill -0 "$VALIDATOR_PID" >/dev/null 2>&1; then
    kill "$VALIDATOR_PID" >/dev/null 2>&1 || true
    wait "$VALIDATOR_PID" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

solana-test-validator \
  --reset \
  --ledger "$LEDGER_DIR" \
  --upgradeable-program "$PROGRAM_ID" "$PROGRAM_SO" "$WALLET" \
  > "$LOG_FILE" 2>&1 &
VALIDATOR_PID=$!

for _ in $(seq 1 60); do
  if solana cluster-version --url "$RPC_URL" >/dev/null 2>&1; then
    break
  fi

  if ! kill -0 "$VALIDATOR_PID" >/dev/null 2>&1; then
    echo "solana-test-validator exited before RPC was ready"
    cat "$LOG_FILE"
    exit 1
  fi

  sleep 1
done

if ! solana cluster-version --url "$RPC_URL"; then
  echo "solana-test-validator did not become ready"
  cat "$LOG_FILE"
  exit 1
fi

if ! ANCHOR_PROVIDER_URL="$RPC_URL" ANCHOR_WALLET="$WALLET" npx ts-mocha -p ./tsconfig.json -t 1000000 "tests/**/*.ts"; then
  cat "$LOG_FILE"
  exit 1
fi
