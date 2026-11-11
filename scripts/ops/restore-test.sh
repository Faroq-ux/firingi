#!/usr/bin/env bash
# Monthly proof that backups work: restore the newest backup into a scratch database, compare it
# with the live one (migrations, companies, orders, invoices), drop it, report to FIRINGI.
source /opt/firingi/common.sh 2>/dev/null || source "$(dirname "$0")/common.sh"
BACKUP_DIR="${BACKUP_DIR:-/backups}"
t0=$(now_ms)
live="$(pg_url)"
scratch_db="firingi_restore_test"
base="${live%/*}"; scratch="$base/$scratch_db"
fail() { log "RESTORE TEST FAILED: $1"; psql -q "$live" -c "DROP DATABASE IF EXISTS $scratch_db" >/dev/null 2>&1 || true; heartbeat restore-test false $(( $(now_ms) - t0 )) null "$1"; exit 1; }

latest=$(ls -1t "$BACKUP_DIR"/firingi-*.dump.enc "$BACKUP_DIR"/firingi-*.dump 2>/dev/null | head -1 || true)
[ -n "$latest" ] || fail "no backup found in $BACKUP_DIR"
log "restore test with $(basename "$latest")"
psql -q -v ON_ERROR_STOP=1 "$live" -c "DROP DATABASE IF EXISTS $scratch_db" -c "CREATE DATABASE $scratch_db" >/dev/null 2>/tmp/rt.err || fail "can't create the scratch database: $(tail -2 /tmp/rt.err)"
/opt/firingi/restore.sh "$latest" "$scratch" >/tmp/rt.out 2>&1 || bash "$(dirname "$0")/restore.sh" "$latest" "$scratch" >/tmp/rt.out 2>&1 || fail "restore: $(tail -3 /tmp/rt.out)"

q='SELECT (SELECT count(*) FROM "_prisma_migrations")||'"'"','"'"'||(SELECT count(*) FROM "Company")||'"'"','"'"'||(SELECT count(*) FROM "Order")||'"'"','"'"'||(SELECT count(*) FROM "Invoice")'
got=$(psql -tA "$scratch" -c "$q" 2>/tmp/rt.err) || fail "restored database can't be read: $(tail -2 /tmp/rt.err)"
cur=$(psql -tA "$live" -c "$q")
IFS=, read -r m c o i <<<"$got"; IFS=, read -r lm lc lo li <<<"$cur"
psql -q "$live" -c "DROP DATABASE IF EXISTS $scratch_db" >/dev/null
[ "$m" -gt 0 ] && [ "$c" -gt 0 ] || fail "the restored database is empty (migrations $m, companies $c)"
[ "$m" = "$lm" ] || log "note: live has $lm migrations, backup $m (a migration since the backup)"
(( c <= lc && o <= lo && i <= li )) || fail "the backup has more rows than live (companies $c/$lc, orders $o/$lo, invoices $i/$li)"
ms=$(( $(now_ms) - t0 ))
log "restore test OK in ${ms} ms: migrations $m, companies $c/$lc, orders $o/$lo, invoices $i/$li"
heartbeat restore-test true "$ms" "{\"backup\":\"$(basename "$latest")\",\"migrations\":$m,\"companies\":$c,\"orders\":$o,\"invoices\":$i,\"liveOrders\":$lo}"
