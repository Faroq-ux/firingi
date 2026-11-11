#!/usr/bin/env bash
# Backup service: a backup every night at BACKUP_HOUR (UTC, default 02:15) and the restore test
# on day RESTORE_TEST_DAY of each month (default 1st) right after it. BACKUP_ON_START=1 also
# takes one when the service starts.
source /opt/firingi/common.sh 2>/dev/null || source "$(dirname "$0")/common.sh"
HOUR="${BACKUP_HOUR:-2}"; DAY="${RESTORE_TEST_DAY:-1}"
here=$(dirname "$0")
log "backup service: nightly at $(printf %02d "$HOUR"):15 UTC, restore test on day $DAY"
[ "${BACKUP_ON_START:-0}" = "1" ] && { "$here/backup.sh" || true; }
while true; do
  sleep $(( 60 - $(date -u +%-S) ))
  if [ "$(date -u +%-H)" = "$HOUR" ] && [ "$(date -u +%-M)" = "15" ]; then
    "$here/backup.sh" || true
    [ "$(date -u +%-d)" = "$DAY" ] && { "$here/restore-test.sh" || true; }
  fi
done
