#!/usr/bin/env bash
# Pulls the newest DSR / DHR report attachments from the reports inbox, rebuilds the daily ledger
# and the monthly targets, and loads both into the portal. Runs twice a day at 11:20 AM and 3:20 PM
# Central (ops/com.dogwood.supercuts-portal-sales.plist). Safe to run by hand.
#
# Everything is env-configurable with repo defaults, so the same script runs on the office machine
# today and as a scheduled ECS task after the AWS cut-over (phase 4), with no edits.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
RAW="${SCP_PIPELINE_RAW_DIR:-$ROOT/data/dsr-dhr/raw}"
OUTD="${SCP_PIPELINE_OUT_DIR:-$ROOT/data/dsr-dhr}"
TARGETS="${SCP_TARGETS_FILE:-$ROOT/data/dsr-targets.csv}"
LOG="${SCP_SALES_LOG:-$ROOT/data/logs/supercuts-portal-sales.log}"
PY="${SCP_PYTHON:-python3}"
mkdir -p "$RAW" "$OUTD" "$(dirname "$LOG")"
cd "$ROOT"
{
  echo "=== $(date '+%Y-%m-%d %H:%M:%S') sales refresh"
  export SCP_PIPELINE_RAW_DIR="$RAW" SCP_PIPELINE_OUT_DIR="$OUTD" SCP_TARGETS_FILE="$TARGETS"
  # A failed download is not fatal: the ledger is rebuilt from the report files already on disk.
  $PY pipeline/dsr-dhr-download.py 2>&1 | grep -v cached | tail -5 || echo "  download step failed"
  if ! $PY pipeline/dsr-dhr-parse.py 2>&1 | tail -2; then echo "  ledger rebuild FAILED; portal left unchanged"; exit 1; fi
  $PY scripts/dsr-targets.py 2>&1 | tail -1 || echo "  targets step failed; goals left unchanged"
  node server/import/load-sales.js "$OUTD/daily.csv" "$TARGETS" || { echo "  portal load FAILED"; exit 1; }
  # Freshness: a WARNING line here when the ledger is a day or more behind. Watch the log for it.
  node scripts/sales-freshness.js || true
} >> "$LOG" 2>&1
