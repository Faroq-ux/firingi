# FIRINGI — Operations guide

How to run FIRINGI in production, keep it healthy, and recover when something goes wrong.
Everything here is portable: any Linux server (or VM) with Docker works, and the same images run
on container platforms.

- [1. What runs](#1-what-runs)
- [2. First deployment](#2-first-deployment)
- [3. Updating to a new version](#3-updating-to-a-new-version)
- [4. Settings](#4-settings)
- [5. Monitoring and alerts](#5-monitoring-and-alerts)
- [6. Backups and restore](#6-backups-and-restore)
- [7. When something goes wrong](#7-when-something-goes-wrong)
- [8. Security](#8-security)
- [9. Capacity and load test](#9-capacity-and-load-test)
- [10. Building behind a company proxy](#10-building-behind-a-company-proxy)

---

## 1. What runs

`docker-compose.prod.yml` starts:

| Service | Image | What it does |
|---|---|---|
| `db` | `postgis/postgis:16-3.4` | PostgreSQL 16 + PostGIS. Data in the `pgdata` volume. |
| `migrate` | `firingi-tools` | One-shot: applies database migrations, then exits. The app waits for it. |
| `app` | `firingi` | The web app (Next.js standalone, non-root). Health check on `/api/health`. |
| `scheduler` | `firingi` | Calls the job endpoints on time (`node ops/scheduler.mjs`). |
| `backup` | `firingi-ops` | Nightly encrypted database backup, off-site copy, monthly restore test. |
| `caddy` | `caddy:2.8` | Optional (`--profile https`): automatic HTTPS certificates for `DOMAIN`. |

Scheduled jobs (UTC). Every run is recorded and shown in *Settings › System Health › Scheduled jobs*.

| Job | When | Alert if no successful run for |
|---|---|---|
| Messages & campaigns (`/api/cron/notifications`) | every 2 min | 20 min (critical) |
| Certified invoicing & payout reminders (`/api/cron/invoicing`) | every 5 min | 30 min (critical) |
| Online payments, direct debits & reminders (`/api/cron/payments`) | every 5 min | 30 min (critical) |
| Health checks & alerts (`/api/cron/ops`) | every 5 min | 20 min |
| Supplier allocation (`/api/cron/allocation`) | every 10 min | 45 min (critical) |
| AI suggestions (`/api/cron/ai`) | hourly | 3 h |
| Database backup (backup service) | nightly 02:15 | 26 h (critical) |
| Backup restore test (backup service) | 1st of the month | 35 days |

Using another scheduler (Kubernetes CronJob, a platform's cron, systemd timers) is fine: call
`POST /api/cron/<job>` with `Authorization: Bearer $CRON_SECRET` on the same timetable.

## 2. First deployment

On a server with Docker (2 vCPU / 4 GB RAM is plenty to start; see [§9](#9-capacity-and-load-test)):

```bash
git clone <your FIRINGI repository> firingi
cd firingi
cp production.env.example production.env
```

Fill in `production.env` (see [§4](#4-settings)). Generate secrets with
`openssl rand -base64 48`. **Keep a copy of `BACKUP_ENCRYPTION_KEY` somewhere other than this
server** (a password manager): without it, backups can't be restored.

```bash
export GIT_COMMIT=$(git rev-parse --short HEAD)
docker compose -f docker-compose.prod.yml --env-file production.env build
docker compose -f docker-compose.prod.yml --env-file production.env --profile https up -d
```

(Leave out `--profile https` when a load balancer or platform already terminates HTTPS in front
of port `APP_PORT`; it must send `X-Forwarded-Proto: https`.)

Create FIRINGI's company and the first super admin (once):

```bash
docker compose -f docker-compose.prod.yml --env-file production.env run --rm migrate \
  pnpm tsx prisma/seed/bootstrap.ts
```

It uses `ADMIN_EMAIL`, `ADMIN_NAME`, `ADMIN_PASSWORD`, `COMPANY_LEGAL_NAME`, `COMPANY_TAX_ID`,
`COMPANY_COUNTRY` from `production.env`, and does nothing when a super admin already exists.
Then sign in, **turn on two-factor sign-in**, remove `ADMIN_PASSWORD` from the file, and add the
team under *Users*. Then add FIRINGI's invoicing details under *Settings › Company Settings* (the
bootstrap creates none) and work through *Settings › Launch Readiness* — see `docs/launch.md`.

Check: `https://<DOMAIN>/api/health` answers `{"status":"ok",…}`, `https://<DOMAIN>/status`
shows all systems operational, and *Settings › System Health* lists every job with a recent run
after ~10 minutes.

### Database notes

- PostGIS is installed by the migrations into its own `postgis` schema. The bundled `db` service
  removes the copy the PostGIS image pre-installs (`docker/db-init/20-firingi-postgis.sql`). On a
  managed database (RDS, Cloud SQL, Azure, Supabase, …): make sure the `postgis` extension is
  *available* but **not** already created in `public`, and that the migration user may create it.
- Use your provider's connection string in `DATABASE_URL` and remove the `db` service.

## 3. Updating to a new version

```bash
git pull
export GIT_COMMIT=$(git rev-parse --short HEAD)
docker compose -f docker-compose.prod.yml --env-file production.env build
docker compose -f docker-compose.prod.yml --env-file production.env up -d
```

`migrate` runs first; the app restarts only after migrations succeed. Migrations are additive;
a backup is taken nightly, but take one by hand before a big update:
`docker compose … run --rm backup /opt/firingi/backup.sh`.

Rollback: check out the previous version and run the same commands. A migration is never rolled
back automatically — if a new migration must be undone, restore the backup taken before the
update ([§6](#6-backups-and-restore)).

## 4. Settings

All in `production.env` (template: `production.env.example`). With `FIRINGI_ENV=production`
(set by the compose file) **FIRINGI refuses to start** when something essential is missing or
unsafe and prints what to fix:

- `BETTER_AUTH_SECRET` (32+ random characters), `BETTER_AUTH_URL` / `APP_URL` (https), `CRON_SECRET`
  (24+ characters), `DATABASE_URL`;
- complete settings for the chosen drivers: `STORAGE_DRIVER=s3` needs `S3_BUCKET`, `S3_ACCESS_KEY_ID`,
  `S3_SECRET_ACCESS_KEY`; `MAIL_DRIVER=smtp` needs `SMTP_URL`; Twilio / WhatsApp / web push keys;
- `MOLONI_SIMULATE=1` is refused (simulated invoices aren't fiscal).

Warnings (shown in the log and on System Health, start anyway): files on local disk, e-mail only
logged, no Sentry, unencrypted backups, demo seed password set, raised sign-in limit.

**Customer payments online**: `STRIPE_SECRET_KEY` (sk_live_…) and `STRIPE_WEBHOOK_SECRET`. In the
Stripe dashboard: activate the payment methods card, MB WAY, Multibanco and SEPA Direct Debit; add
the webhook endpoint `https://<DOMAIN>/api/webhooks/payments/stripe` with the events
`checkout.session.completed`, `checkout.session.async_payment_succeeded`,
`checkout.session.async_payment_failed`, `checkout.session.expired`, `payment_intent.succeeded`,
`payment_intent.processing`, `payment_intent.payment_failed`, `mandate.updated`; copy its signing
secret into `STRIPE_WEBHOOK_SECRET`. Then switch the methods on in *Settings › Payment* and check
*Finance › Online Payments › Test connection*. `PAYMENTS_SIMULATE=1` is refused in production.

**File storage**: `STORAGE_DRIVER=s3` with any S3-compatible service (AWS S3, Hetzner, Scaleway,
OVH, Cloudflare R2, MinIO, SeaweedFS…). `S3_ENDPOINT` for non-AWS providers, `S3_FORCE_PATH_STYLE=true`
for most of them, `S3_SSE=AES256` to ask the provider to encrypt at rest (AWS; leave empty if the
provider refuses it). `STORAGE_DRIVER=local` keeps files in the `storage` volume — then back that
volume up too.

## 5. Monitoring and alerts

**Built in (always on)** — every 5 minutes FIRINGI checks itself and turns problems into alerts:

| Check | Warning | Critical |
|---|---|---|
| Database | answers slower than 1 s | unreachable, or a migration didn't finish |
| File storage | — | can't read/write the bucket or directory |
| Disk space | < 10 % free | < 5 % free |
| Database size | > `DB_SIZE_WARN_GB` (20) | — |
| Server errors | ≥ `ALERT_ERRORS_15MIN` (20) in 15 min | ≥ 5 × that |
| Message queue | messages waiting > 30 min, or ≥ 10 failed in an hour | — |
| Certified invoicing queue | a document refused by Moloni | a document pending > 1 h |
| Online payments | provider notifications not applied, direct debits pending > 10 days | provider unreachable / keys wrong |
| Each scheduled job / backup | last run failed | 3 failures in a row, or no success for too long (critical jobs) |
| Settings | (production) a risky choice | (production) an essential setting missing |

An alert goes to every **super admin** (e-mail and push; WhatsApp / SMS too when it's critical),
again every 6 hours while it lasts or when it gets worse, and once more when it's resolved. Open
and recent alerts, the job table, grouped errors (server and browser) and the running version are
on *Settings › System Health*; *Run checks now* re-checks immediately.

**Uptime checks + status page** — point any uptime monitor (UptimeRobot, Better Stack, Pingdom,
Uptime Kuma, your platform's health checks) at:

- `GET https://<DOMAIN>/api/health` → `200 {"status":"ok"}`, `503` when the app or database is down
  (check every 1 minute, alert after 2–3 failures);
- optionally `GET /api/health?full=1` with `Authorization: Bearer $CRON_SECRET` → the full report,
  `503` when something is critical.

`https://<DOMAIN>/status` is the public status page for customers and suppliers (25 languages):
website & apps, ordering, documents & files, notifications, invoicing, and incidents of the last
7 days — no internal details.

**Error tracking (Sentry, optional)** — set `SENTRY_DSN` (and `SENTRY_TRACES_SAMPLE_RATE`, e.g.
`0.1`, for performance traces). Server and browser errors go to Sentry with the release
(`GIT_COMMIT`) and environment; FIRINGI's own error log keeps working either way. Sentry's EU
region (`*.ingest.de.sentry.io`) is allowed by the Content Security Policy.

## 6. Backups and restore

**What** — the `backup` service runs `pg_dump` (custom format, compressed) every night at
`BACKUP_HOUR`:15 UTC, checks the dump can be read back, encrypts it (AES-256, key derived from
`BACKUP_ENCRYPTION_KEY` with PBKDF2, 200 000 rounds), writes a SHA-256 checksum, keeps it in the
`backups` volume for `BACKUP_RETENTION_DAYS` (30), and uploads it to `s3://<BACKUP_S3_BUCKET or
S3_BUCKET>/backups/` (set a lifecycle rule on the bucket for how long off-site copies are kept,
e.g. 90 days). Each run reports to FIRINGI; a failed or missing backup raises a critical alert.

**Files** — with `STORAGE_DRIVER=s3`, uploaded files live in the bucket: turn on versioning (or
the provider's backup) for it. With local storage, back up the `storage` volume.

**Restore test** — on `RESTORE_TEST_DAY` (the 1st) the service restores the newest backup into a
scratch database, compares it with the live one (migrations, companies, orders, invoices), drops
it and reports. A failed restore test raises an alert. Run it any time:

```bash
docker compose -f docker-compose.prod.yml --env-file production.env exec backup /opt/firingi/restore-test.sh
```

**Take a backup now**:

```bash
docker compose -f docker-compose.prod.yml --env-file production.env exec backup /opt/firingi/backup.sh
```

**Restore** (replaces the live data — only after deciding to roll back):

```bash
C="docker compose -f docker-compose.prod.yml --env-file production.env"
$C stop app scheduler                              # nobody writes while restoring
$C exec backup ls -lt /backups | head               # pick a backup
$C exec backup /opt/firingi/restore.sh /backups/firingi-20261111T021500Z.dump.enc
#   or from the off-site copy:  /opt/firingi/restore.sh s3:backups/firingi-20261111T021500Z.dump.enc
$C start app scheduler
```

The restore checks the checksum, decrypts (a wrong key is reported as such), and restores in one
transaction (all or nothing). Restoring into another database to look at old data:
`restore.sh <file> postgresql://user:pass@host:5432/other_db`.

Tested: backup → encryption → S3 upload → restore from S3 into a fresh database (same 371 orders /
129 invoices as live), wrong key refused, tampered file refused by the checksum, restore test OK
in 1.6 s on the demo data.

## 7. When something goes wrong

| Alert / symptom | What to do |
|---|---|
| **App unreachable** (uptime monitor) | `docker compose … ps` and `logs app`. If it exits at start, the log says which setting is missing (`[env] …`). |
| **Database** critical | `logs db`; disk full? (`df -h`). The app recovers by itself when the database is back. |
| **Database migrations** critical | `logs migrate`; fix the cause, re-run `up -d`. Never edit an applied migration. |
| **File storage** critical | bucket name / keys / endpoint, provider status page; for local storage the volume permissions. |
| **Disk space** | old Docker images: `docker image prune`; logs; backups (lower `BACKUP_RETENTION_DAYS`). |
| **Job: … failing / stale** | System Health shows the job's last error. `logs scheduler`; is `CRON_SECRET` the same in app and scheduler? Run one job by hand: `curl -X POST -H "Authorization: Bearer $CRON_SECRET" https://<DOMAIN>/api/cron/<job>`. |
| **Job: Database backup** | `logs backup` shows `BACKUP FAILED: <reason>` (database password, disk, S3 keys). Take one by hand once fixed. |
| **Certified invoicing queue** | *Finance › Certified Invoicing*: refused documents show Moloni's reason; fix it and *Send again*. Pending > 1 h: Moloni down or keys wrong. |
| **Online payments** | *Finance › Online Payments*: provider notifications with errors (fix, then the provider retries), failed payments and why, the connection test. Payments made but not matched become customer credit — use or refund it there. |
| **Message queue** | *Notifications › Message log*: failed sends and why (SMTP / Twilio / WhatsApp keys, provider down). |
| **Server errors** | System Health › Errors (grouped), or Sentry. |
| **Settings** | the message says what to set; restart the app after changing `production.env`. |

## 8. Security

- **HTTPS only** in production (`BETTER_AUTH_URL` must be https). Behind HTTPS FIRINGI sends HSTS
  (2 years, subdomains); session cookies are `__Secure-`, `HttpOnly`, `Secure`, `SameSite=Lax`.
- **Content Security Policy**: only FIRINGI's own scripts, styles, images, fonts and connections
  (plus Sentry's ingest); no framing (`frame-ancestors 'none'`, `X-Frame-Options: DENY`), no
  plugins, forms only to FIRINGI. `Permissions-Policy` allows only camera (barcode scanning, proof of
  delivery) and location (drivers) for FIRINGI itself. API answers are `no-store`.
  Inline scripts are allowed because Next.js needs them for hydration.
- The app container runs as a non-root user; the database isn't exposed outside the Docker network.
- Sign-in is rate limited (`AUTH_SIGNIN_RATE_LIMIT`, 10/min); staff should use two-factor sign-in
  (*Settings › Security* can require it).
- Secrets live only in `production.env` (never in Git; `.gitignore` excludes it). Rotate
  `CRON_SECRET` by changing it and restarting app + scheduler + backup together; rotating
  `BETTER_AUTH_SECRET` signs everybody out.

## 9. Capacity and load test

`scripts/load-test.mjs` signs in as a user and has N simulated users request a mix of pages:

```bash
node scripts/load-test.mjs --url https://staging.example.com --users 25 --seconds 30 \
  --email <test customer> --password '…' --paths /buy/dashboard/overview,/buy/orders/history
```

Results on one app instance (4 vCPU, demo data, database on the same machine; 2026-11-11):

| Mix | Users | Requests/s | p50 | p95 | Errors |
|---|---|---|---|---|---|
| Customer (dashboard, catalogue, orders, invoices, cart, health) | 25 | 34 | 0.68 s | 1.45 s | 0 |
| Supplier (dashboard, incoming orders, stock, statements) | 15 | 21 | 0.52 s | 1.54 s | 0 |
| Staff (dashboard, all orders, system health, sales analytics) | 10 | 28 | 0.31 s | 0.59 s | 0 |
| Public (health, status page, sign-in page) | 50 | 124 | 0.54 s | 0.68 s | 0 |

Each user here clicks continuously (no pause), so 25 such users equal a few hundred real people
working at the same time. One page takes 30–120 ms on its own; the rest is queueing in a single
Node.js process. To serve more, run several `app` instances behind a load balancer (or move to
a bigger server) — sessions are in the database, so any instance can serve any user; run only one
`scheduler`. Measured improvements in this phase: invoice
lists paged (50 per page; customer invoices p50 3.1 s → 1.3 s under load), 37 indexes added for
foreign keys used in lookups.

## 10. Building behind a company proxy

If the build server reaches the internet only through a proxy that inspects HTTPS, put the
proxy's CA certificate (`*.crt`) in `docker/certs/` and pass the proxy to the build:

```bash
docker build --network host --build-arg https_proxy=http://proxy:3128 \
  --build-arg no_proxy=localhost -t firingi .
```

The app image never installs Linux packages (it copies OpenSSL from the build stage), so it
builds wherever Docker Hub and the npm registry are reachable. The `ops` (backup) image installs
`curl` from the Debian mirrors.
