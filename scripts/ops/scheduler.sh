#!/usr/bin/env bash
# FIRINGI scheduler: calls the app's job endpoints on time (UTC). Each call is recorded by the app
# (System Health → Scheduled jobs), and a job that stops running raises an alert.
#   notifications every 2 min · invoicing, ops every 5 min · allocation every 10 min · ai hourly (:07)
source /opt/firingi/common.sh 2>/dev/null || source "$(dirname "$0")/common.sh"
: "${CRON_SECRET:?CRON_SECRET is not set}"

call() {
  local job="$1"
  local out code
  out=$(curl -sS -m 600 -o /dev/stderr -w '%{http_code}' -X POST "$APP_INTERNAL_URL/api/cron/$job" -H "Authorization: Bearer $CRON_SECRET" 2>/tmp/cron-$job.out) || true
  code="$out"
  if [ "$code" = "200" ]; then log "ok   $job $(head -c 300 /tmp/cron-$job.out)"; else log "FAIL $job HTTP $code $(head -c 300 /tmp/cron-$job.out)"; fi
}

log "scheduler started → $APP_INTERNAL_URL"
while true; do
  # sleep to the start of the next minute
  sleep $(( 60 - $(date -u +%-S) ))
  m=$(( 10#$(date -u +%H) * 60 + 10#$(date -u +%M) ))
  (( m % 2 == 0 )) && call notifications &
  (( m % 5 == 0 )) && call invoicing &
  (( m % 5 == 1 )) && call ops &
  (( m % 10 == 3 )) && call allocation &
  (( m % 60 == 7 )) && call ai &
  wait || true
done
