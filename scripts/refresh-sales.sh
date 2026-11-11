#!/usr/bin/env bash
# Pulls the newest DSR / DHR reports, rebuilds the daily ledger and loads it into the portal.
# Runs at 11:20 AM and 3:20 PM Central (ops/com.dogwood.supercuts-portal-sales.plist). Safe to run by hand.
set -uo pipefail
ROOT=/Users/dogwoodbrandscompany/dogwood-agents
LOG="$ROOT/logs/supercuts-portal-sales.log"
PY=/opt/homebrew/bin/python3
cd "$ROOT"
{
  echo "=== $(date '+%Y-%m-%d %H:%M:%S') sales refresh"
  # A failed download is not fatal: the ledger is rebuilt from the report files already on disk.
  $PY scripts/dsr-dhr-download.py 2>&1 | grep -v cached | tail -5 || echo "  download step failed"
  if ! $PY scripts/dsr-dhr-parse.py 2>&1 | tail -2; then echo "  ledger rebuild FAILED; portal left unchanged"; exit 1; fi
  $PY supercuts-portal/scripts/dsr-targets.py 2>&1 | tail -1 || echo "  targets step failed; goals left unchanged"
  /opt/homebrew/bin/node supercuts-portal/server/import/load-sales.js || { echo "  portal load FAILED"; exit 1; }
} >> "$LOG" 2>&1
