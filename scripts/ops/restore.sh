#!/usr/bin/env bash
# Restore a FIRINGI backup.
#   restore.sh <backup file | s3:backups/<name>> [target database URL]
# The target defaults to DATABASE_URL — that REPLACES the live data, so stop the app and the
# scheduler first (docs/operations.md › Restore). Encrypted backups need BACKUP_ENCRYPTION_KEY.
source /opt/firingi/common.sh 2>/dev/null || source "$(dirname "$0")/common.sh"
src="${1:?usage: restore.sh <backup file | s3:backups/name> [target database URL]}"
target="${2:-$(pg_url)}"
work=$(mktemp -d); trap 'rm -rf "$work"' EXIT

if [[ "$src" == s3:* ]]; then
  key="${src#s3:}"; log "downloading $key"; s3_get "$key" "$work/$(basename "$key")"; src="$work/$(basename "$key")"
  s3_get "$key.sha256" "$work/$(basename "$key").sha256" 2>/dev/null || true
fi
[ -f "$src" ] || { echo "no such backup: $src" >&2; exit 2; }
if [ -f "$src.sha256" ]; then (cd "$(dirname "$src")" && sha256sum -c --quiet "$(basename "$src").sha256") || { echo "checksum mismatch: $src" >&2; exit 3; }; fi

dump="$src"
if [[ "$src" == *.enc ]]; then
  : "${BACKUP_ENCRYPTION_KEY:?the backup is encrypted: set BACKUP_ENCRYPTION_KEY}"
  openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass env:BACKUP_ENCRYPTION_KEY -in "$src" -out "$work/db.dump" || { echo "decryption failed (wrong key?)" >&2; exit 4; }
  dump="$work/db.dump"
fi
log "restoring $(basename "$src") → ${target%%@*}@…"
pg_restore --clean --if-exists --no-owner --no-privileges --exit-on-error --single-transaction --dbname="$target" "$dump"
log "restore finished"
