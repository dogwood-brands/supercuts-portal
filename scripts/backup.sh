#!/bin/sh
# Backs up the portal: a consistent copy of the database (safe while the server is running)
# plus the uploaded photos. Keeps the newest 30 of each in data/backups.
#   sh scripts/backup.sh
set -eu
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DB="${SCP_DB:-$ROOT/data/portal.db}"
UPLOADS="${SCP_UPLOADS:-$ROOT/data/uploads}"
OUT="$ROOT/data/backups"
KEEP=30
STAMP="$(date +%Y-%m-%d_%H%M%S)"

[ -f "$DB" ] || { echo "No database at $DB" >&2; exit 1; }
mkdir -p "$OUT"
chmod 700 "$OUT"

# better-sqlite3's online backup: page-by-page, consistent, does not block writers.
cd "$ROOT"
node -e '
const Database = require("better-sqlite3");
const db = new Database(process.argv[1], { readonly: true, fileMustExist: true });
db.backup(process.argv[2]).then(() => {
  db.close();
  const copy = new Database(process.argv[2], { readonly: true });
  const ok = copy.pragma("integrity_check", { simple: true });
  copy.close();
  if (ok !== "ok") { console.error("Backup failed its integrity check: " + ok); process.exit(1); }
}).catch((e) => { console.error(e.message); process.exit(1); });
' "$DB" "$OUT/portal_$STAMP.db"
rm -f "$OUT/portal_$STAMP.db-wal" "$OUT/portal_$STAMP.db-shm"
gzip -f "$OUT/portal_$STAMP.db"
chmod 600 "$OUT/portal_$STAMP.db.gz"

if [ -d "$UPLOADS" ] && [ -n "$(ls -A "$UPLOADS" 2>/dev/null)" ]; then
  tar -czf "$OUT/uploads_$STAMP.tar.gz" -C "$(dirname "$UPLOADS")" "$(basename "$UPLOADS")"
  chmod 600 "$OUT/uploads_$STAMP.tar.gz"
fi

# Retention: newest $KEEP of each kind.
for pattern in 'portal_*.db.gz' 'uploads_*.tar.gz'; do
  ls -1t "$OUT"/$pattern 2>/dev/null | tail -n +$((KEEP + 1)) | while read -r old; do rm -f "$old"; done
done

echo "Backup written: $OUT/portal_$STAMP.db.gz"
