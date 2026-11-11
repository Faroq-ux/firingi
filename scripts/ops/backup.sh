#!/usr/bin/env bash
# One database backup: pg_dump (custom format) → encrypted (AES-256, BACKUP_ENCRYPTION_KEY) →
# BACKUP_DIR (kept BACKUP_RETENTION_DAYS) and, when S3 is configured, an off-site copy under
# backups/ (set a lifecycle rule on the bucket for its retention). Reports to FIRINGI.
source /opt/firingi/common.sh 2>/dev/null || source "$(dirname "$0")/common.sh"
BACKUP_DIR="${BACKUP_DIR:-/backups}"
RETENTION="${BACKUP_RETENTION_DAYS:-30}"
t0=$(now_ms)
stamp=$(date -u +%Y%m%dT%H%M%SZ)
mkdir -p "$BACKUP_DIR"
tmp="$BACKUP_DIR/.firingi-$stamp.dump.partial"
trap 'rm -f "$tmp" "$tmp.enc"' EXIT

fail() { log "BACKUP FAILED: $1"; heartbeat backup false $(( $(now_ms) - t0 )) null "$1"; exit 1; }

log "backup: dumping database"
pg_dump --format=custom --compress=6 --no-owner --no-privileges --dbname="$(pg_url)" --file="$tmp" 2>/tmp/pg_dump.err || fail "pg_dump: $(tail -3 /tmp/pg_dump.err)"
pg_restore --list "$tmp" >/dev/null 2>&1 || fail "the dump can't be read back"

if [ -n "${BACKUP_ENCRYPTION_KEY:-}" ]; then
  openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt -pass env:BACKUP_ENCRYPTION_KEY -in "$tmp" -out "$tmp.enc" || fail "encryption failed"
  final="$BACKUP_DIR/firingi-$stamp.dump.enc"; mv "$tmp.enc" "$final"
else
  log "WARN BACKUP_ENCRYPTION_KEY is not set — the backup is NOT encrypted"
  final="$BACKUP_DIR/firingi-$stamp.dump"; mv "$tmp" "$final"
fi
sha=$(sha256sum "$final" | cut -d' ' -f1); echo "$sha  $(basename "$final")" > "$final.sha256"
bytes=$(stat -c %s "$final")

offsite=false
if s3_enabled; then
  s3_put "$final" "backups/$(basename "$final")" && s3_put "$final.sha256" "backups/$(basename "$final").sha256" && offsite=true || fail "upload to S3 failed (the local copy $final is kept)"
fi

removed=$(find "$BACKUP_DIR" -maxdepth 1 -name 'firingi-*.dump*' -mtime +"$RETENTION" -print -delete | grep -c -v '\.sha256$' || true)
ms=$(( $(now_ms) - t0 ))
log "backup OK: $final ($bytes bytes, sha256 $sha, off-site $offsite, removed $removed old)"
heartbeat backup true "$ms" "{\"file\":\"$(basename "$final")\",\"bytes\":$bytes,\"encrypted\":$([ -n "${BACKUP_ENCRYPTION_KEY:-}" ] && echo true || echo false),\"offsite\":$offsite,\"removed\":$removed}"
