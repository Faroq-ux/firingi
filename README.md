# FIRINGI — Core Module

B2B marketplace + ERP. FIRINGI is the merchant of record in every sale:
**Customer → FIRINGI → Wholesaler** and **Wholesaler → FIRINGI → Distributor**.

**Stack:** Next.js 15 (App Router) · TypeScript · Tailwind CSS 4 · shadcn/ui-style components ·
PostgreSQL 16 · Prisma 6 · better-auth (email + password) · next-intl · Vitest · Playwright.

---

## Quick start

Requirements: Node 22+, pnpm 10+, and PostgreSQL 16 (local, or `docker compose up -d`).

```bash
pnpm install
cp .env.example .env                 # then set BETTER_AUTH_SECRET (openssl rand -base64 32)
pnpm prisma migrate deploy           # create tables + integrity triggers
pnpm db:seed                         # countries, tax, permissions, roles, demo accounts
pnpm dev                             # http://localhost:3000
```

### Demo accounts — password for all: `Firingi!2026`

| E-mail | Company / type | Status | What it shows |
|---|---|---|---|
| `superadmin@firingi.test` | FIRINGI · Super Admin | ✅ | Full back office, all 20 sections |
| `ops@` · `finance@` · `sales@` · `support@firingi.test` | FIRINGI staff | ✅ | Role-filtered sidebar |
| `rm.lisboa@firingi.test` | FIRINGI · Regional Manager | ✅ | Scoped to Lisboa + Setúbal |
| `driver@firingi.test` | FIRINGI driver | ✅ | Driver portal |
| `owner@atlantico.test` | Distributor 🇵🇹 | ✅ | Sell portal |
| `owner@ibericas.test` | Distributor 🇪🇸 | ✅ | Cross-border distributor |
| `owner@lisboacentral.test` | Wholesaler 🇵🇹 | ✅ | **Sell + Buy** portals |
| `warehouse@lisboacentral.test` | Wholesaler employee | ✅ | Limited permissions (blocked pages) |
| `purchasing@lisboacentral.test` | Wholesaler employee | ✅ | Buy-only employee |
| `owner@kebabhouse.test` / `buyer@kebabhouse.test` | Wholesale customer | ✅ | Buy portal, team management |
| `owner@portonorte.test` | Wholesaler | ⏳ Pending | Cannot buy or sell |
| `owner@minimercadosol.test` | Customer | ⏳ Pending | Cannot buy |
| `owner@pizzariabella.test` | Customer | 🔍 Under review | Cannot buy |

### Commands

| Command | What it does |
|---|---|
| `pnpm dev` / `pnpm build` / `pnpm start` | Run / build the app |
| `pnpm typecheck` · `pnpm lint` | Static checks (lint also blocks DB access outside `src/server`) |
| `pnpm test` | Unit + integration tests (rebuilds the **test** DB from `TEST_DATABASE_URL`) |
| `node tests/e2e/smoke.mjs http://localhost:3000 [screenshotDir]` | Browser end-to-end smoke test against a running server* |
| `node tests/e2e/onboarding.mjs http://localhost:3000 [screenshotDir]` | Browser test of registration → documents → admin approval → tobacco access* |
| `node tests/e2e/catalogue.mjs http://localhost:3000 [screenshotDir]` | Browser + API test of catalogue visibility, vendor pricing, product proposal and approval* |
| `node tests/e2e/orders.mjs http://localhost:3000 [screenshotDir]` | Browser test of cart lock, minimums, checkout, vendor confirmation, FIRINGI delivery* |
| `node tests/e2e/finance.mjs http://localhost:3000 [screenshotDir]` | Browser test of promotions, invoices + PDFs, vendor statements and invoices, payments, credit notes* |
| `pnpm db:migrate` · `pnpm db:seed` · `pnpm db:studio` | Database tools |

\* Start the server with `AUTH_SIGNIN_RATE_LIMIT=200` for the e2e run; it logs in many times and the
default brute-force limit is 10 sign-ins per minute per IP. Needs Playwright with Chromium (`pnpm dlx playwright install chromium`).

---

## Project structure

```
prisma/
  schema/            Multi-file schema: geo, identity (tenancy + RBAC + audit), onboarding,
                     catalogue, orders, commercial, invoicing, delivery, system
  migrations/        Incl. raw-SQL integrity rules (triggers + CHECKs) — see below
  seed/              reference.ts (EU countries, tax, categories) · rbac.ts · demo.ts
src/
  app/
    (public)/        login, register (Phase 2), application-status, forbidden, no-access
    admin/           Back office — 20-section sidebar; [...slug] = "Coming soon" placeholders
    vendor/          Sell portal (distributors, wholesalers)
    buy/             Buy portal (customers, wholesalers buying from distributors)
    driver/          Driver portal (Phase 6)
    api/auth/        better-auth handler (public sign-up disabled)
  server/            SERVER-ONLY. The only place the database is used.
    auth/            better-auth config
    context.ts       Ctx = user + active company + effective permissions + region scopes
    rbac/            permissions.ts (catalogue), system-roles.ts, effective.ts, guard.ts
    services/        team.ts (users & roles), audit.ts
    data/            Guarded read functions — each takes Ctx and checks permissions
    actions/         Server actions (Zod-validated, permission-checked)
  config/nav/        Sidebar definitions (admin + portals) with permission & build phase per page
  components/        ui/ (shadcn-style), layout/ (shell, sidebar), team/, audit/
  i18n/ messages/    en + 24 languages of the Schengen countries (built from scripts/i18n/<lang>.txt)
tests/
  unit/              RBAC resolution, sidebar config, NIF validation
  integration/       Real Postgres: DB-enforced rules, approval gating, tenant isolation, RBAC
  e2e/smoke.mjs      Browser test of logins, portals, blocked pages, language, mobile
```

## How the hard rules are enforced

| Rule | Where |
|---|---|
| Customers never buy from distributors; wholesalers only from distributors | DB trigger on `CartItem` (`SELLER_NOT_ALLOWED`); visibility layer (Phase 3) |
| One vendor per cart | DB trigger locks `Cart.sellerCompanyId` (`CART_SELLER_MISMATCH`), unlocks when emptied |
| `VendorOffer.sellerType` can't be faked | DB trigger copies it from the vendor company; company type is immutable |
| Not approved → cannot buy/sell | `computeEffectivePermissions`: pending/under review = onboarding only; rejected/suspended = nothing |
| Users only manage their own company | `services/team.ts` scopes every query to `ctx.company.id` |
| No privilege escalation | Non-owners can only grant/remove permissions they hold; roles limited to the company type's audiences |
| Issued invoices immutable | DB trigger on `Invoice` / `InvoiceLine` (`INVOICE_IMMUTABLE`) |
| Commission history never rewritten | DB trigger on `CommissionRule` (only `validTo` may change) |
| Vendor promotions 100 % vendor-funded; admin splits sum to 100 | DB CHECK constraints on `Promotion` |
| Audit log tamper-proof | DB trigger: `AuditLog` (and status histories) append-only |

## Onboarding (Phase 2)

1. **Register** at `/register` as distributor, wholesaler, customer or driver. Each new account starts as **Pending**.
2. On the **application page** (`/application-status`), the applicant completes their profile, adds addresses and uploads documents, then submits the application (**Under review**).
3. **FIRINGI reviews it** at Vendors / Customers › Applications. The company page has a decision panel, document approval, an EU VIES check and the commission setting. Approval is blocked until:
   - all required documents are approved;
   - the required addresses exist;
   - for distributors: the VAT number is confirmed in VIES;
   - for vendors: a commission rate is set.
4. **Tobacco and alcohol:** approved buyers request access with a licence (Buy › Company). Admin approves it with an expiry date at Risk & Compliance › Compliance.
5. **Drivers** upload their ID and driving licence. Admin approves both documents and the driver at Drivers & Fleet › Driver Applications.

Requirements and transitions are defined in one place: `src/server/onboarding/rules.ts`.

| Variable | Default | Purpose |
|---|---|---|
| `STORAGE_DRIVER` / `STORAGE_DIR` | `local` / `./storage` | Uploaded documents. They are never public; downloads go through `/api/files/:id`, which checks permissions. |
| `MAIL_DRIVER` | `log` | `log` writes e-mails to `storage/mail-outbox/`. `smtp` sends through `SMTP_URL`, for example Mailpit from `docker compose`. |
| `VIES_URL` | EU endpoint | VAT validation. When VIES can't be reached, admins can record an audited manual verification. |

## Catalogue (Phase 3)

- **Master catalogue:** FIRINGI owns products, and each product has variants and packaging units (e.g. *Case 24 × 33cl*).
  - Vendors attach **offers** to a packaging unit. Each offer has the vendor's SKU, minimum quantity, order step, lead time, stock per warehouse and prices.
  - Vendors can **propose** new products. A proposal stays invisible until FIRINGI approves it.
- **Categories** go to any depth. Each category inherits its parent's tobacco/alcohol restriction and active flag. A product can add a restriction but never remove one it inherits.
- **Prices** are set by vendors in price lists: base, customer group, or one customer / contract. Lists can have quantity tiers and validity dates. The most specific valid price wins (`src/server/catalogue/pricing.ts`).
- **Visibility** is decided by one rule, `src/server/catalogue/visibility.ts`, which every buyer query, page and API goes through:
  - customers only see approved wholesalers in their own country;
  - wholesalers only see distributors (EU-wide);
  - restricted products need a valid tobacco/alcohol approval;
  - an offer must be active, its product approved, and have a price for that buyer.

  Hidden items return 404 rather than "forbidden", so their existence isn't revealed.
- **JSON API** for buyers: `GET /api/catalogue/offers?q=&category=&vendor=&page=` and `GET /api/catalogue/offers/:id`. The same rules apply.
- **Setting** `catalogue.offerApprovalRequired` (default `false`): when `true`, new offers on existing products also need admin approval.

## Orders (Phase 4)

- **Shopping:** businesses only. Buyers browse by category or by supplier (nearest first), or find goods by barcode: typed, with a USB / Bluetooth scanner, or with a phone camera.
- **One supplier per cart.** The cart locks to the first supplier, and the database refuses a second one too. To buy from another supplier, check out or clear the cart first.
- **Who delivers** (`src/server/orders/delivery-rule.ts`):
  - If the order reaches the **supplier's own delivery minimum** (set by the supplier under Delivery & Fleet › Delivery minimum), the supplier delivers for free.
  - Otherwise **FIRINGI** delivers and charges its fee, provided the order reaches **FIRINGI's minimum**. Admin sets both per country under Delivery › Minimum Order Rules.
  - Below both, checkout is blocked.
  - Cross-border distributors must deliver themselves, so only their own minimum applies.
- **Checkout re-checks everything on the server** in one transaction: visibility, prices, quantity rules, stock (reserved), IVA for the buyer's region, and the minimums.
  - The order freezes every number on each line: list price, discounts (Phase 5), tax rate, commission rule and rate, and the vendor's cost and payout.
  - Order numbers (`FO-YYYY-NNNNNN`) are gap-free.
- **Statuses** (`src/server/orders/state.ts`):
  - **Buyers** can cancel until the vendor confirms.
  - **Vendors** confirm (they can confirm fewer units, which recalculates totals and releases the stock), prepare, and dispatch / deliver their own deliveries.
  - **FIRINGI** dispatches and delivers its own deliveries, and handles exceptions and returns.
  - Stock is reserved at checkout, released on cancellation, and leaves the warehouse at dispatch. Every change goes into the append-only history.

## Commercial & Finance (Phase 5)

- **Commission:** set per vendor (no default) and frozen on every order line. It is always calculated on the price before any discount.
- **Promotions** (`src/server/catalogue/promotions.ts`):
  - **Vendor promotions** are always 100% paid by the vendor.
  - **FIRINGI promotions** are paid by FIRINGI, the vendor, or split (e.g. 50/50). A vendor-paid share only applies once that vendor accepts it.
  - At most one vendor promotion and one FIRINGI promotion per line; the FIRINGI promotion applies to the price after the vendor's.
  - Every discount is stored per order line with the FIRINGI and vendor amounts, which feeds the "Who paid the discounts" report.
- **Invoicing** (`src/server/invoicing/`): when an order is delivered, two documents are created and linked to the order:
  - FIRINGI issues the **sales invoice** to the buyer.
  - A **billing statement** tells the vendor exactly what to invoice FIRINGI: domestic VAT, or 0% reverse charge for a vendor in another EU Schengen country.
  - Vendors upload their own invoice. It is matched automatically (±0.02 €) and approved by finance before it can be paid.
  - Corrections are made only with **credit notes**, full or partial. Each one also creates a vendor credit statement.
  - **Numbering, ATCUD, hash chain and QR data** go through a provider adapter. The internal provider marks documents **"not a fiscal document"** until an AT-certified provider is connected.
  - **PDFs:** `/api/invoices/:id/pdf` and `/api/statements/:id/pdf`.
- **Payments ledger:** money in from buyers and money out to vendors, each allocated to specific invoices. It drives:
  - paid / open / overdue status (from each customer's payment terms);
  - accounts receivable and payable;
  - the finance overview, commissions report and monthly VAT report.

## Configuration notes

- **Area:** FIRINGI operates within the **Schengen area only** (`Country.isSchengen`): the 25 EU
  members in Schengen plus Norway, Switzerland, Iceland and Liechtenstein. Cyprus and Ireland
  (EU, not Schengen) are inactive.
- **Markets:** each `Country` has `customerMarketEnabled` / `wholesalerMarketEnabled` /
  `distributorSourcingEnabled`. Launch: customers and wholesalers 🇵🇹 only; distributors in any EU
  Schengen country. NO / CH / IS / LI are set up (currency, language, VAT) but closed: selling across
  that border needs customs / import handling, which is not built yet (invoicing refuses it).
- **Language:** every company works in its registration country's language by default and can
  always switch to English (Belgium: Dutch, French or German; Switzerland: German, French or
  Italian). A user's own choice is remembered. Before sign-in the browser language is used.
  Translations live in `scripts/i18n/<lang>.txt` (one line per English message) and are built with
  `python3 scripts/i18n/build.py <lang>`, which checks placeholders; `tests/unit/i18n-messages.test.ts`
  fails if a language misses a key. Product and category names show in Portuguese / English /
  Spanish (catalogue data) until translated.
- **Invoice language:** documents follow the issuing country — FIRINGI Portugal invoices and
  credit notes are in Portuguese only. Vendor billing statements are Portuguese + English.
- **Tax rates** are seeded for development (PT incl. Madeira/Azores, ES incl. Canary Islands IGIC,
  standard rate for other EU countries). **Have your accountant confirm them before go-live.**
- **Invoicing** (Phase 5) goes through a certified-provider adapter; the provider is still to be chosen.
