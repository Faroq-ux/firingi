#!/usr/bin/env bash
# Shared helpers for the FIRINGI ops container (scheduler, backups).
set -euo pipefail
APP_INTERNAL_URL="${APP_INTERNAL_URL:-http://app:3000}"
log() { echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) $*"; }

# libpq connection string from DATABASE_URL (Prisma's ?schema=… etc. are not libpq options).
pg_url() { local u="${DATABASE_URL:?DATABASE_URL is not set}"; echo "${u%%\?*}"; }

# Tell FIRINGI how an external job went: heartbeat <job> <ok:true|false> <durationMs> <summary-json> [error]
heartbeat() {
  local job="$1" ok="$2" ms="$3" summary="${4:-null}" err="${5:-}"
  local body
  body=$(printf '{"job":"%s","ok":%s,"durationMs":%s,"summary":%s,"error":%s}' "$job" "$ok" "$ms" "$summary" "$( [ -n "$err" ] && printf '"%s"' "$(printf '%s' "$err" | tr -d '"\\' | tr '\n' ' ' | cut -c1-900)" || echo null)")
  curl -fsS -m 30 -X POST "$APP_INTERNAL_URL/api/ops/heartbeat" -H "Authorization: Bearer ${CRON_SECRET:?CRON_SECRET is not set}" -H "Content-Type: application/json" -d "$body" >/dev/null \
    || log "WARN could not report $job to $APP_INTERNAL_URL/api/ops/heartbeat"
}

now_ms() { date +%s%3N; }

# S3-compatible upload/download with curl's built-in SigV4 (AWS, MinIO, Hetzner, Scaleway, R2…).
s3_url() {
  local key="$1" bucket="${BACKUP_S3_BUCKET:-${S3_BUCKET:-}}" region="${S3_REGION:-eu-west-1}"
  if [ -n "${S3_ENDPOINT:-}" ]; then echo "${S3_ENDPOINT%/}/$bucket/$key"; else echo "https://$bucket.s3.$region.amazonaws.com/$key"; fi
}
s3_enabled() { [ -n "${BACKUP_S3_BUCKET:-${S3_BUCKET:-}}" ] && [ -n "${S3_ACCESS_KEY_ID:-}" ] && [ "${BACKUP_S3:-on}" != "off" ]; }
# Backups are encrypted before upload; S3_SSE=AES256 also asks the provider to encrypt at rest
# (AWS supports it; several S3-compatible providers refuse the header).
s3_put() {
  local sse=(); [ "${S3_SSE:-}" = "AES256" ] && sse=(-H "x-amz-server-side-encryption: AES256")
  curl -fsS -m 3600 --aws-sigv4 "aws:amz:${S3_REGION:-eu-west-1}:s3" --user "$S3_ACCESS_KEY_ID:$S3_SECRET_ACCESS_KEY" \
    -H "x-amz-content-sha256: UNSIGNED-PAYLOAD" "${sse[@]}" -T "$1" "$(s3_url "$2")" >/dev/null
}
s3_get() {
  curl -fsS -m 3600 --aws-sigv4 "aws:amz:${S3_REGION:-eu-west-1}:s3" --user "$S3_ACCESS_KEY_ID:$S3_SECRET_ACCESS_KEY" \
    -H "x-amz-content-sha256: UNSIGNED-PAYLOAD" -o "$2" "$(s3_url "$1")"
}
