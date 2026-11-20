# FIRINGI — Handover guide

This is the starting point for whoever runs, changes or launches FIRINGI after the build. It tells you what the
system is, where everything lives, how to run and test it, and what is still left outside the code.

| Read next | For |
|---|---|
| [README.md](../README.md) | Every feature, phase by phase, with the rules it enforces |
| [docs/operations.md](operations.md) | Servers, Docker, HTTPS, backups, monitoring, updates, incidents |
| [docs/launch.md](launch.md) | Accounts, keys and back-office steps to reach "Ready for a pilot" / "Ready to launch" |
| `docs/<feature>.md` | Deep dives: bank, deals, pay later, tenders, CO₂, staff & time, reviews, POS, e-invoicing, … |

## 1. What FIRINGI is

A B2B food marketplace with an ERP for the Schengen countries. **Customers** (restaurants, shops, kebab and pizza
houses) buy from **wholesalers**; wholesalers buy from **distributors**. **FIRINGI invoices every buyer**; suppliers
invoice FIRINGI (self-billing). FIRINGI's **commission is never shown to buyers**, and its **margin is never shown to
suppliers**. Every option has a **FIRINGI switch** — globally, per buyer / supplier type and per business.

Five portals, one app:

| Portal | Path | Who | Language |
|---|---|---|---|
| Buyer | `/buy` | customers and wholesalers buying | 25 languages |
| Supplier | `/vendor` | wholesalers and distributors selling | 25 languages |
| Driver | `/driver` | delivery drivers (phone, offline) | 25 languages |
| FIRINGI back office | `/admin` | FIRINGI staff | English |
| Public | `/`, `/login`, `/register`, `/pay/…`, `/status` | everyone | 25 languages |

Size at handover: **643 pages** (383 back office, 138 supplier, 99 buyer, 8 driver, the rest public), **55 schema
files / 77 migrations**, **218 notification events**, **32 scheduled job routes**, **25 languages** (6,354 texts each).
Bangla and Hindi are handled by the AI customer-service assistant, not as interface languages.

## 2. Technology

* **Next.js 15** (App Router, server components, server actions), **TypeScript**, Tailwind, next-intl.
* **PostgreSQL 16 + PostGIS** through **Prisma** (multi-file schema in `prisma/schema/*.prisma`).
* PDFs with `@react-pdf/renderer`; charts and motion are in-house components (reduced-motion safe).
* AI: Anthropic Claude through the official SDK (optional — the app runs without a key).
* Providers behind adapters with simulators for tests: Moloni (certified invoicing), Stripe (payments), SMTP,
  SMS / WhatsApp, web push, bank feeds, e-invoicing networks, POS fiscal, pay-later partner.

## 3. Where things are

```
prisma/schema/        data model (one file per area) · prisma/migrations/  SQL migrations
prisma/seed/          demo data (never in production — use the bootstrap command)
src/app/              pages and API routes, by portal: buy/ vendor/ driver/ admin/ (public)/ api/
src/server/           business logic: one folder per area (orders, invoicing, co2, pay-later, …)
src/server/actions/   server actions — every write goes through defineAction({permission, schema, handler})
src/server/rbac/      roles, permissions, page guards · src/server/data/  guarded read layer for pages
src/lib/              pure rules (no database) — unit-tested
src/components/       UI, one folder per area · src/config/nav/  menus of every portal
src/messages/         the 25 languages (JSON) · scripts/i18n/  translation build (source + per-language files)
tests/unit|integration|e2e/   tests (see §5) · docs/  guides
```

Rules that hold everywhere (and are tested): pages call `pagePortal` + `pagePermission`; writes check permissions in
`defineAction`; pages read through `@/server/data` (lint blocks direct database imports in pages); every money change
is audited; buyer-facing data never includes commission or supplier payout.

## 4. Running it

```bash
pnpm install
cp .env.example .env            # DATABASE_URL, AUTH_SECRET, … (see README › Quick start)
pnpm db:deploy && pnpm db:seed  # demo data, password in SEED_PASSWORD
pnpm build && pnpm start        # or pnpm dev
```

Production: `docs/operations.md` (Docker image, compose with Postgres + scheduler + backups + HTTPS). Start production
from an **empty database with the bootstrap command** (`pnpm tsx prisma/seed/bootstrap.ts`), never the demo seed. Scheduled jobs are HTTP routes under
`/api/cron/*` called by the scheduler container with `CRON_SECRET`.

The full build needs about **11 GB of Node heap** on this code size (`NODE_OPTIONS=--max-old-space-size=11264`,
`FIRINGI_LOW_MEMORY_BUILD=1`); give the build machine 16 GB of RAM. The Dockerfile sets both (`BUILD_HEAP_MB`).

## 5. Tests

| Kind | Command | What |
|---|---|---|
| Unit | `pnpm test:unit` | pure rules in `src/lib` (prices, VAT, CO₂, rebates, parsers, …) and the translation parity check |
| Integration | `DATABASE_URL=…/firingi_test pnpm test:int` | services against a real test database |
| Browser (e2e) | `node tests/e2e/<suite>.mjs http://localhost:3000 [shotsDir]` | one suite per area, as real users, phone + dark included |
| Crawl | `node tests/e2e/crawl.mjs` | opens every page in every portal: no errors, fits a phone, dark mode |

Browser suites run against a production build with the demo seed and the simulators on (`PAYMENTS_SIMULATE=1`,
`MOLONI_SIMULATE=1`, … — see `docs/operations.md`); each suite restores what it changes. Don't run vitest at the
same time as a production build on a 16 GB machine.

## 6. Changing things safely

* **Data model:** edit `prisma/schema/*.prisma` → `npx prisma format` → create a migration (`prisma migrate dev`, or
  `migrate diff` as in `docs/operations.md`) → `prisma generate`. Migrations are forward-only in production.
* **Texts:** add English, Portuguese and Spanish in `src/messages/{en,pt-PT,es}.json`; add the namespace to `LATER`
  in `scripts/i18n/build.py`; `python3 scripts/i18n/build.py --source` lists the new lines; translate them into
  `scripts/i18n/<lang>.txt` (append in order) and run `python3 scripts/i18n/build.py <langs>`. The parity unit test
  fails if any language misses a key or a `{placeholder}`.
* **A new option:** put it in the area's settings (a `Setting` JSON key with defaults + a clean/validate function),
  give it a FIRINGI switch on the area's settings page, and — where it applies to businesses — a per-business switch
  (`CompanyFeature` key, DEFAULT / ON / OFF).
* **Permissions:** add to `src/server/rbac` and to the roles that need it; menus read them from `src/config/nav`.

## 7. What is outside the code

The code is complete for launch; what remains needs people, contracts and accounts (details in `docs/launch.md`):

1. Provider accounts and live keys: Moloni, Stripe, e-mail (SMTP), optionally SMS/WhatsApp, Anthropic, web push,
   S3 storage, Sentry, a pay-later partner, bank feed, e-invoicing network.
2. A production server or cloud account, a domain and HTTPS.
3. Legal: terms of service, privacy policy, supplier and buyer agreements, self-billing agreement — checked by a
   lawyer. Country-specific fiscal certification where FIRINGI issues invoices itself (Portugal uses Moloni).
4. Real data: FIRINGI's invoicing entity per country, IBAN, VAT rates check, delivery zones, first suppliers and
   catalogues, CO₂ category values check.
5. People: a second super admin, two-factor sign-in for every staff member, a pilot group of 5–10 customers and 2–3
   suppliers.

*Settings › Launch Readiness* checks all of this live and says what is still missing.

## 8. Final regression at handover (20 November 2026)

| Suite | Result |
|---|---|
| Unit + integration (vitest, 93 files) | **877 pass, 2 skipped, 0 failed** (the first run had 1 failure, a test-data issue — fixed) |
| Browser suites (57, one per area) | all pass — 53 in the full run; catalogue, inventory and loyalty failed there and pass after the fixes below; staff-time added and passing |
| Crawl (every page, laptop light + phone dark, all portals) | **589 pages, no errors, nothing wider than a phone** |

Found and fixed by the regression:

* **Supplier shop** — the CO₂ filter added a second "All products" link next to the shop's own (Phase 51); the shop now shows only the CO₂ chips, and tapping the active one clears it.
* **Loyalty** — turning points into a credit note looked only at a customer's 200 oldest invoices; a customer with more (all paid) got "no unpaid invoice". It now looks through all of them.
* **Pay invoices page** — only the 500 oldest invoices were read, so after 500 a customer stopped seeing new unpaid ones. It now pages through all invoices.
* **Staff & time** — breaks from the phone were refused (the location is only needed to clock in and out).
* **Test robustness** — the POS and order tests no longer depend on data other test files create at the same time; the inventory test waits for the transfer page's button.

How to repeat it: `pnpm test` (with `DATABASE_URL` pointing at the test database), then the browser suites one after
another against a fresh production build with the demo seed (see §5); the crawl last.
