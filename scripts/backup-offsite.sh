#!/bin/sh
# Copies the newest local backup (database and uploads) off this machine, so losing the machine does not
# lose the data. Run after scripts/backup.sh; backup.sh calls it automatically when SCP_BACKUP_OFFSITE is set.
#
#   SCP_BACKUP_OFFSITE        where to copy to. Either a folder that lives somewhere else (a Google Drive for
#                             desktop folder, a mounted NAS share, an external disk) or an S3 URL (s3://bucket/prefix).
#   SCP_BACKUP_OFFSITE_KEEP   folder destinations only: how many of each kind to keep there (default 30).
#                             For S3, set a lifecycle rule on the bucket instead.
#   SCP_BACKUPS               the local backups folder (default data/backups).
#
#   sh scripts/backup-offsite.sh
#
# Exits non-zero when the destination is missing or a copy does not match the original, so the failure shows
# in the backup log instead of passing silently.
set -eu
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="${SCP_BACKUPS:-$ROOT/data/backups}"
DEST="${SCP_BACKUP_OFFSITE:-}"
KEEP="${SCP_BACKUP_OFFSITE_KEEP:-30}"

if [ -z "$DEST" ]; then
  echo "Off-site copy skipped: SCP_BACKUP_OFFSITE is not set. Backups exist on this machine only." >&2
  exit 0
fi

newest() { ls -1t "$SRC"/$1 2>/dev/null | head -n 1; }
DB_FILE="$(newest 'portal_*.db.gz')"
UP_FILE="$(newest 'uploads_*.tar.gz')"
[ -n "$DB_FILE" ] || { echo "Off-site copy failed: no database backup in $SRC" >&2; exit 1; }

sha() { shasum -a 256 "$1" | cut -d ' ' -f 1; }
set -- "$DB_FILE"
[ -z "$UP_FILE" ] || set -- "$@" "$UP_FILE"

case "$DEST" in
  s3://*)
    command -v aws >/dev/null 2>&1 || { echo "Off-site copy failed: the aws command is not installed" >&2; exit 1; }
    for f in "$@"; do
      aws s3 cp "$f" "${DEST%/}/$(basename "$f")" --sse AES256 --only-show-errors \
        --metadata "sha256=$(sha "$f")"
      echo "Copied off site: ${DEST%/}/$(basename "$f")"
    done
    ;;
  *)
    # A folder destination must already exist: a missing folder usually means Drive or the NAS is not mounted,
    # and creating it here would quietly put the "off-site" copy back on this machine.
    [ -d "$DEST" ] || { echo "Off-site copy failed: $DEST does not exist (is the drive or share mounted?)" >&2; exit 1; }
    for f in "$@"; do
      name="$(basename "$f")"
      cp "$f" "$DEST/$name.partial"
      if [ "$(sha "$f")" != "$(sha "$DEST/$name.partial")" ]; then
        rm -f "$DEST/$name.partial"
        echo "Off-site copy failed: $name did not match after copying" >&2
        exit 1
      fi
      mv "$DEST/$name.partial" "$DEST/$name"
      chmod 600 "$DEST/$name" 2>/dev/null || true
      echo "Copied off site: $DEST/$name"
    done
    for pattern in 'portal_*.db.gz' 'uploads_*.tar.gz'; do
      ls -1t "$DEST"/$pattern 2>/dev/null | tail -n +$((KEEP + 1)) | while read -r old; do rm -f "$old"; done
    done
    ;;
esac
