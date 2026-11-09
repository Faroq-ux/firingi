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
  i18n/ messages/    en, pt-PT, es (other EU languages fall back to English)
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

## Configuration notes

- **Markets:** each `Country` has `customerMarketEnabled` / `wholesalerMarketEnabled` /
  `distributorSourcingEnabled`. Launch: customers and wholesalers 🇵🇹 only; distributors in all 27 EU countries.
- **Language:** each user picks one of their company country's languages or English (saved per user).
- **Tax rates** are seeded for development (PT incl. Madeira/Azores, ES incl. Canary Islands IGIC,
  standard rate for other EU countries). **Have your accountant confirm them before go-live.**
- **Invoicing** (Phase 5) goes through a certified-provider adapter; the provider is still to be chosen.
