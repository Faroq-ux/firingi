# FIRINGI — Core Module

B2B marketplace + ERP. FIRINGI is the merchant of record in every sale:
**Customer → FIRINGI → Wholesaler** and **Wholesaler → FIRINGI → Distributor**.

**Stack:** Next.js 15 (App Router) · TypeScript · Tailwind CSS 4 · shadcn/ui-style components ·
PostgreSQL 16 · Prisma 6 · better-auth (email + password) · next-intl · Vitest · Playwright.

---

## Quick start

Requirements: Node 22+, pnpm 10+, and PostgreSQL 16 **with PostGIS 3** (local: `apt-get install postgresql-16-postgis-3`, or `docker compose up -d`). The migrations install PostGIS into its own `postgis` schema. For production see [docs/operations.md](docs/operations.md).

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
| `driver@firingi.test` | FIRINGI driver | ✅ | Driver app (deliveries, proof of delivery) |
| `owner@atlantico.test` | Distributor 🇵🇹 | ✅ | Sell portal |
| `owner@ibericas.test` | Distributor 🇪🇸 | ✅ | Cross-border distributor |
| `armazem@firingi.test` | FIRINGI in-house warehouse (wholesaler) | ✅ | FIRINGI's own stock, small orders |
| `owner@ccalmada.test` | Wholesaler 🇵🇹 | ✅ | Second wholesaler (allocation) |
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
| `node tests/e2e/delivery.mjs http://localhost:3000 [screenshotDir]` | Browser test of vendor fleet + service areas, driver app with signature, returns, failed delivery, control tower, multi-order setting* |
| `node tests/e2e/notifications.mjs http://localhost:3000 [screenshotDir]` | Browser test of the bell, notification settings, message log, WhatsApp test send, templates and per-event channels* |
| `node tests/e2e/allocation.mjs http://localhost:3000 [screenshotDir]` | Browser test of supplier allocation: decline → automatic move, buyer / supplier views, Control Tower, open case → manual move* |
| `node tests/e2e/go-live.mjs http://localhost:3000 [screenshotDir]` | Browser test of two-factor login, sessions, SAF-T, data privacy, payments, settings notice and API keys* |
| `node tests/e2e/firingi-ordering.mjs http://localhost:3000 [screenshotDir]` | Browser test of ordering from FIRINGI, Delivery Orders, in-house small orders, the customer's decision* |
| `node tests/e2e/dashboards.mjs http://localhost:3000 [screenshotDir]` | Browser test of the animated dashboards (admin, live operations, supplier, customer), reduced motion and phone width* |
| `node tests/e2e/crm.mjs http://localhost:3000 [screenshotDir]` | Browser test of leads, activities, follow-ups, pipeline, accounts, segments, customer activity and a support request answered by FIRINGI* |
| `node tests/e2e/delivery-fees.mjs http://localhost:3000 [screenshotDir]` | Browser test of FIRINGI free delivery (on / off), a distributor's units minimum and flat rate in the wholesaler's cart* |
| `node tests/e2e/routes.mjs http://localhost:3000 [screenshotDir]` | Browser test of a multi-stop route: planning, driver start, customer ETA window, stops ticking, live board, performance, earnings* |
| `node tests/e2e/analytics.mjs http://localhost:3000 [screenshotDir]` | Browser test of the analytics pages, chart hover / table view, filters, CSV / Excel export, report builder, vendor and buyer reports* |
| `node tests/e2e/ai.mjs http://localhost:3000 [screenshotDir]` | Browser test of the AI Centre: insights, suggestions → CRM task, activity log, customer Buy Again, supplier Demand & Stock (run `pnpm db:demo-history` first)* |
| `node tests/e2e/invoicing.mjs http://localhost:3000 [screenshotDir]` | Browser test of certified invoicing with a simulated Moloni (start the server with `MOLONI_SIMULATE=1`), payouts due* |
| `pnpm db:demo-history` | Adds 16 weeks of demo buying history (dev / demo databases only) |
| `pnpm db:demo-planning` | Demo stock, purchase history, a short-dated lot and a promotion for demand planning at Distribuidora Atlântico (dev / demo only) |
| `node tests/e2e/planning.mjs http://localhost:3000 [screenshotDir]` | Browser test of demand planning: forecast, restock → draft purchase orders, lead times, events, overstock & expiry, FIRINGI's views (run `pnpm db:demo-history` and `pnpm db:demo-planning` first) |
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
3. **FIRINGI reviews it** at Vendors / Customers › Applications. The company page has a decision panel, document approval, an EU VIES check and the commission setting. Approval is blocked until (Phase 28):
   - the VAT number is given and the required addresses exist;
   - for distributors: the VAT number is confirmed in VIES;
   - for vendors: a commission rate is set.

   FIRINGI also asks — but can **approve anyway** with a note — for the **permanent certificate code**
   of suppliers that are companies (not sole traders) and **one recent invoice from the customer's
   POS**. No other document is required.
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
- **Who sells to whom** (catalogue rule + database triggers): customers buy only from
  **wholesalers of their own country**; wholesalers buy only from **distributors**, who sell
  across FIRINGI's European (Schengen) markets in larger volumes. An offer is always sold from
  its vendor's country. Buyers never see FIRINGI's commission, the supplier's payout or FIRINGI's
  margin (pages, API, exports).
- **Who delivers, and the delivery fee** (`src/server/orders/delivery-rule.ts`). Every delivery
  rate is taxable (VAT at the standard rate of the buyer's region, on FIRINGI's invoice):
  - **Customer ← wholesaler:** when the order reaches the **wholesaler's free-delivery minimum**
    (Delivery & Fleet › Delivery minimum; by order value or by number of units), the wholesaler
    delivers free. Below it **FIRINGI** delivers: **free** from FIRINGI's free-delivery amount when
    the admin has switched FIRINGI free delivery on, otherwise at **FIRINGI's flat rate**. Below
    **FIRINGI's minimum order**, checkout is blocked. The admin sets all of this per country under
    Delivery › Minimum Order Rules; a **delivery zone** can have its own rule, which overrides
    the country for addresses inside it.
  - **Wholesaler ← distributor:** the distributor always delivers (its own fleet, or a carrier
    abroad). From its minimum (order value or units — the distributor decides) delivery is
    free; below it the distributor's own **flat rate** applies. FIRINGI puts the fee on its invoice
    to the wholesaler and adds it to the distributor's payout (FIRINGI's revenue counts only its
    own fleet's fees). A distributor without a flat rate refuses orders below its minimum; one
    without any rule delivers every order free.
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

## Delivery & Fleet (Phase 6)

- **Service areas (PostGIS)** — a vendor narrows where it sells: whole country (distributors,
  cross-border EU), region, city, FIRINGI delivery zone, or **km radius** around one of its
  addresses. No areas = whole market. Buyers outside every area don't see the vendor, and
  checkout to an address outside is refused. Wholesalers: own country only.
- **Delivery zones** (FIRINGI) — postal-code patterns (`1100-*`) and/or a GeoJSON polygon,
  validated and stored as PostGIS geography (`Address.geo` is kept by a trigger).
- **Fleet** — vendors add their own drivers and vehicles for their free deliveries; they are
  active at once and the vendor is responsible for them. FIRINGI manages its own fleet and can
  take any driver or vehicle off the road. Independent driver applicants still need review.
- **Multi-order delivery** — off by default (one open delivery per driver). Super Admin sets it
  for FIRINGI's fleet and decides whether vendors may use it (and their maximum); each vendor
  switches it on for its own fleet (*Delivery & Fleet › Drivers*, *Settings › Delivery Settings*).
- **Deliveries** — one per order, created when the vendor confirms; executed by the vendor
  (own fleet / carrier) or FIRINGI. The dispatcher assigns driver + vehicle (or carrier +
  tracking) on the order page. The driver app (phone) moves the order: picked up → dispatched,
  out for delivery, delivered with **proof** (recipient, signature, photos, GPS) → invoice.
  Proof is append-only (DB trigger); a driver/vehicle must belong to the executing company
  (DB trigger).
- **Failed deliveries** — the driver records why (customer absent, closed, refused, …, photo);
  the order goes to *Exception*. The dispatcher retries (assign again) or **returns the goods to
  the supplier**: order cancelled, stock back on hand.
- **Returns** — buyers request within 30 days of delivery (quantities, reason, photos); FIRINGI
  approves/rejects; the supplier (or FIRINGI) confirms receipt → FIRINGI credit note to the
  buyer, credit statement to the vendor, stock back (unless damaged); order *Returned* when
  everything came back.
- **Admin pages** — control tower, live deliveries, failed deliveries, proof of delivery,
  returns, zones, all drivers / vehicles, FIRINGI drivers, vendor drivers, availability,
  assignments.

## Notifications & WhatsApp (Phase 7)

- **One entry point** — `notify(event, targets, vars)` (`src/server/notify/dispatch.ts`). The
  event catalogue (`src/server/notify/events.ts`) lists 35 events with their topic, who in a
  company receives them (by permission; owners always), default channels and placeholders.
- **Channels** — in-app (bell + *My notifications*, always on), e-mail, SMS, WhatsApp and web push.
  Super Admin switches channels on/off platform-wide and per event, and edits texts per event,
  channel and language (*Notifications & Communications › Notification Templates*); default
  texts ship in all 25 languages. Every recipient gets their own language.
- **People decide** — per topic and channel (*bell › Notification settings*); critical account /
  finance messages always arrive by e-mail. SMS and WhatsApp need a mobile number and explicit
  consent (stored with the time); changing the number asks for consent again.
- **Providers** — `log` by default (written to `storage/notify-outbox`, nothing leaves the server),
  SMTP for e-mail, Twilio for SMS / WhatsApp, Meta WhatsApp Cloud API, VAPID web push — see
  `.env.example`. Business-initiated WhatsApp messages must use Meta-approved templates: set
  the template name + language on the WhatsApp text; the event's placeholders are its parameters.
- **Log, retries, receipts** — every message is logged (*Notifications*), with status
  queued / sent / delivered / read / failed / skipped (no number, no consent). Temporary
  failures retry with back-off (`/api/cron/notifications`, or *Retry* in the back office).
  Delivery receipts and incoming messages arrive on `/api/webhooks/twilio` and
  `/api/webhooks/whatsapp` (signatures verified).
- **Inboxes** — *Customer / Vendor / Driver Messages*: SMS / WhatsApp received, matched to the
  account by phone; staff with `admin.messages.manage` (Operations, Support) reply. WhatsApp free
  text only within 24 hours of the person's last message.

## Analytics & Reports (Phase 8)

- **One engine** — `src/server/analytics/engine.ts` turns filters + dimensions + figures into
  whitelisted SQL over the frozen order totals (and order lines for product / category
  breakdowns). Orders are counted by **date placed** (bookings, all but cancelled) or
  **date delivered** (recognised sales: delivered or returned). Breakdowns always add up to
  the total (integration-tested against the order book).
- **Figures** — net / gross / VAT, commission, **goods margin** (goods sold − owed to vendors,
  i.e. commission less FIRINGI-funded discounts), delivery fees, **FIRINGI revenue** (margin +
  fees), payouts, units, buyers, average order; credit notes are shown per month next to
  revenue. *Net Profit* and *Route Profitability* need cost data the platform doesn't record
  yet and stay "later".
- **Back office** (*Analytics & Reports*) — sales, revenue, gross margin, orders (status
  funnel, delivery modes), customers (first-time vs returning), vendors / distributors /
  wholesalers, products & categories, delivery (success, on-time, failure reasons, by company
  and driver), country performance, and a **custom report builder** (two dimensions, any
  figures). Filters: period presets or custom dates, count-by date, country, seller type.
  Regional managers see only their regions' buyers.
- **Vendors** (*Reports › Sales Report*, `vendor.reports.view`: owner, sales, accountant) see
  their own sales, payout and commission, top products, customers, categories and regions.
  **Buyers** (*Reports › Spending Report*, `buyer.reports.view`: owner, purchaser,
  accountant) see their spending by supplier, product, category and delivery mode. Both are
  translated into all 25 languages; FIRINGI's own margin and revenue are never shown to them.
- **Charts** — dependency-free SVG (`src/components/analytics/charts.tsx`): one axis, at most
  three series in a fixed colour-blind-checked order (`--series-1..3`, separate light / dark
  values), hover crosshair + tooltip, legend, and a *Table* view on every chart.
- **Export** — every report downloads as CSV (UTF-8, Excel-friendly) or Excel
  (`/api/analytics/export`); the caller's scope is always applied and other audiences'
  figures are refused.

## Supplier Allocation (Phase 9)

- **Moves** (see Phase 10 for who decides). When the supplier **declines**, **confirms less**
  than ordered, or **doesn't confirm in time** (default 4 h — `/api/cron/allocation`, every
  10–15 minutes with the cron secret), FIRINGI moves the order — or only the missing items — to
  other suppliers as new orders linked to the original (`parentOrderId`). Automatic; the buyer
  is notified (`order.reallocated`) and sees both orders linked. The new supplier only sees
  that FIRINGI passed the order on; the original supplier never sees who took it.
- **Same price for the buyer.** Each moved item keeps the original unit price (lower if the new
  supplier is cheaper). FIRINGI pays any difference while its margin on the moved goods stays
  above the **margin floor** (default 0 % = it may give up its commission, never lose money).
  The delivery fee agreed at checkout follows the goods; no new fee is charged.
- **Who can take it** (`src/server/allocation/engine.ts`): same seller type (wholesalers for
  customers, distributors for wholesalers), approved, not excluded, covers the address with its
  service areas, within the distance limit (per country), has free stock and a price for this
  buyer, under its daily capacity, has a commission agreement, and never a supplier that already
  had these items. Ranked by distance, margin, vendor priority, 90-day reliability, already
  delivering nearby and already having an open order for this buyer (weights editable). Items
  may be split over up to N suppliers; the same items move at most M times.
- **Back office** (*Supplier/Vendor Allocation*, `admin.allocation.manage` — Super Admin,
  Operations): Control Tower (open cases, overdue confirmations, recent moves), Auto
  Allocation, Manual Allocation (candidates with score, distance, margin and why-not; move with
  an optional margin override), Distributor vs Wholesaler, Distance Rules, Route Matching,
  Existing Order Matching, Margin Rules, Stock Availability, Delivery Capacity, Vendor Priority,
  Allocation History and Overrides. When nobody can take an order, the case waits in the
  Control Tower and FIRINGI staff are notified (`allocation.needed`).

## Ordering from FIRINGI, in-house warehouses & Delivery Orders (Phase 10)

- **How customers order is set per country** (*International › Countries* or *Allocation ›
  Distributor vs Wholesaler*): **customers choose the wholesaler** (one wholesaler per order,
  as before) or **customers order from FIRINGI**. In FIRINGI mode the shop shows one FIRINGI
  price per product (no supplier list, no supplier names or SKUs); at checkout FIRINGI picks the
  wholesaler — **nearest or cheapest** (*Auto Allocation*) — among those that deliver to the
  address with everything in stock, splitting the cart over at most N suppliers. The customer
  never pays more than the price shown.
- **FIRINGI's own warehouses ("in-house")** are run as an in-house wholesaler
  (`Company.isInHouse`; demo: *FIRINGI Armazém*, `armazem@firingi.test`) — products, stock and
  warehouses are managed in the normal supplier portal; more warehouses = more addresses with
  stock, the nearest counts. Policy: **first for small orders** (below the wholesaler's
  free-delivery minimum; otherwise only when no wholesaler can), **always first**, or **not used**.
- **Delivery**: a wholesaler delivers itself when the goods reach its free-delivery minimum;
  otherwise — and always for in-house stock — FIRINGI's fleet delivers at FIRINGI's flat fee
  (charged once per checkout; free from FIRINGI's free-delivery amount when switched on). The **Control Tower** groups these small orders by pickup point
  (with delivery areas) so one FIRINGI driver can collect them together (*Assign all*; needs
  multi-order delivery for FIRINGI's fleet).
- **Delivery Order**: every supplier order has a printable *Delivery Order from FIRINGI*
  (`/vendor/orders/<id>/delivery-order`): deliver to this customer, invoice FIRINGI at your own
  prices. FIRINGI invoices the customer (it resells); orders FIRINGI picked are badged.
- **When the supplier can't deliver** (declines, confirms less, doesn't answer in time):
  - customer ordered **from FIRINGI** → moved automatically (or the Control Tower decides);
  - customer **chose the wholesaler** → the customer is asked (`order.supplier_unavailable`):
    *let FIRINGI find another wholesaler* (same price or lower) or *cancel*; undecided cases
    close after the decision time (default 48 h);
  - **wholesaler ← distributor** → a distributor's cancellation cancels the order; nothing moves.
  - The customer is only invoiced for what is delivered.

## Go-live essentials (Phase 11)

- **SAF-T (PT)** (*Invoices & Tax › SAF-T / Compliance*): monthly SAF-T PT 1.04_01 XML of
  FIRINGI's invoices and credit notes per legal entity (Header, Customers, Products, Tax table,
  SalesInvoices with ATCUD, hash, references for credit notes). The page checks every series:
  numbering without gaps, unbroken hash chain, ATCUD on every document, series communicated to
  AT. **Before go-live** a certified invoicing provider must replace the internal development
  provider (the page warns until then; set `SAFT_CERTIFICATE_NUMBER`).
- **Security**: two-factor login with an authenticator app (TOTP + 10 backup codes) on everyone's
  *Security* page (click your name); sessions per device with sign-out; *Settings › Security*
  can require two-factor for FIRINGI staff (the admin must use it first) and for company owners,
  set the maximum session length, sign a user out everywhere and reset a lost authenticator.
- **Data privacy (GDPR)**: everyone downloads their personal data (JSON) from *Security › My data*
  and can ask for deletion; *Risk & Compliance › Data Privacy* reviews requests. Deletion
  anonymises the account (name, e-mail, phone, consents, password, two-factor, devices,
  notifications, message texts); orders and invoices are kept (10-year legal retention) and the
  append-only audit log stays. A company's only owner can't be deleted first.
- **Payments & credit control** (*Settings › Payment Settings*): payment methods shown to buyers
  (bank transfer to FIRINGI's IBAN, MB WAY, cash/card on delivery; Multibanco, SEPA debit and
  card need a payment provider), default terms and credit limit for newly approved buyers,
  checkout blocked when an invoice is overdue beyond the grace period (default 15 days) or when
  unpaid invoices + open orders + the new order exceed the credit limit. *Risk › Payment Risk*
  lists every buyer's exposure, overdue amounts and status, with terms/limit editing.
- **Settings**: *Marketplace* (support contacts, a notice shown on every portal, driver
  applications), *Orders* (buyers may cancel until confirmation; furthest requested delivery
  date), *Vendors* (wholesaler / distributor applications, offer approval), *Customers*
  (customer applications).
- **API & Integrations**: FIRINGI issues API keys for a company user with scopes
  (`catalogue.read`, `orders.read`); shown once, stored as a hash, revocable. Use
  `Authorization: Bearer fk_live_…` with `GET /api/catalogue/offers` and `GET /api/v1/orders`.

## Routes & Fleet (Phase 12)

- **Multi-stop routes** (*Delivery & Logistics › Multi-Stop Routes*, vendors: *Delivery & Fleet ›
  Routes*): the small orders FIRINGI's fleet delivers wait for a route. Tick deliveries, pick a
  driver (and vehicle) and a day → one route: pickups at each supplier first, then the customers.
  *Plan the day automatically* splits the waiting deliveries by direction over the free drivers
  (approved, on duty, no route that day), longest-waiting first. The **multi-order limit** from
  Delivery Settings caps orders per driver (off by default for FIRINGI's fleet: one order per
  driver — the Super Admin switches it on); vendors plan their own fleet the same way.
- **Stop order** (*Route Optimization*): nearest stop first, then every stop is tried in every
  position, always keeping a pickup before its delivery. Distance = straight line × road factor
  (no external maps service needed); time = average speed + time per pickup / delivery. A route
  can be re-optimised (stops already done stay), stops moved up / down or taken off; a manual
  reassignment, a cancelled order or a suspended driver takes the delivery off its route.
- **ETAs** (*ETA Management*): every stop has a planned and an expected time. When the driver
  taps *Start route*, each customer is notified ("Delivery FO-… is on its way today", window =
  ETA ± half the configured window, default 60 min) and sees the window on the order. Each
  pickup / delivery the driver records ticks its stop and moves the expected times of the rest;
  the route completes when every stop is done. Drivers see their route on *Today's deliveries*
  with the next stop and a Google Maps link through the remaining stops.
- **Live Operations** (*Dashboard*): routes today with progress, next stop, late stops, finish
  time; tiles for deliveries waiting for a route, failed, open exceptions and driver availability
  (refreshes every 30 s).
- **Performance**: *Delivery Performance* (delivered, failed, on time = by the planned time +
  half the window, first-attempt rate, lead time, failure reasons, per day) and *Driver
  Performance* (routes, deliveries, success, on time, km, hours, deliveries per hour).
- **Driver Earnings**: FIRINGI's own drivers per period — per completed route + per delivered
  order + per planned km (rates on the same page). Vendors pay their own drivers.

## CRM & Sales, customer support (Phase 13)

- **Leads** (*CRM › Leads*): businesses FIRINGI wants on the platform (customer, wholesaler or
  distributor to be), with source, owner and expected monthly orders. The first call / e-mail /
  visit moves a new lead to *contacted*; *lost* needs a reason. A lead **converts by itself** when
  a company registering with the same e-mail is approved, or is linked by hand; its contacts,
  activities, tasks and deals move to the account and its owner becomes the account manager.
- **Business accounts** (*CRM › Business Accounts*): approved companies with account manager,
  tier (A/B/C) and tags, 90-day buying / selling, last order, last contact and open tasks. Each
  account has a 360° page: KPIs, timeline, follow-ups, recent orders, people (CRM contacts +
  platform users), deals and support requests.
- **Pipeline** (*CRM › Sales Pipeline*): deals by stage (prospecting → won / lost) with expected
  monthly value and probability (weighted value per stage). **Communications** and **Notes** are
  the activity history (calls, e-mails, WhatsApp, meetings, visits; notes). **Follow-ups** and
  **Tasks** go to a teammate (who is notified), overdue ones are flagged.
- **Customer Segments**: saved rules (buyer type, country, tier, tags, account manager, activity
  status, 90-day spend) evaluated live. **Customer Activity** (*Customers*) shows who orders as
  usual, who is *at risk* (no order for twice its usual gap, at least 30 days), *dormant* (> 90
  days), *new* or *never ordered*, with spend trend and last sign-in. **Sales Performance** per
  team member: leads, conversions, deals won, contacts made, tasks, accounts' purchases.
- **Help & Support**: customers and suppliers open requests from their portal (about an order,
  delivery, invoice …, in their language); FIRINGI answers in *Customers › Customer Support*
  with internal notes the company never sees, assignment, priority and status. A staff answer
  waits for the company; the company's reply reopens it; the person who asked is notified.
- Roles: *Sales* manages the CRM and answers support; *Support* reads the CRM and answers
  support (`admin.support.manage`); every company role may ask for help (`company.support.use`).

## Profit & finance insight (Phase 14)

- **Profit & Loss** (*Finance › Profit & Loss*, by invoice date, per month): revenue (goods sold to
  customers + delivery fees of FIRINGI's fleet), cost of goods (supplier price), credit notes both
  ways → **gross profit**; minus driver pay, price differences FIRINGI absorbed when moving orders
  and **operating costs** → **net profit**. Costs (drivers, fleet, warehouse, staff, marketing, IT,
  payment fees, other) are recorded once or *every month* (until an end date), for the whole
  company or one market. Suppliers' own flat delivery rates are passed on, not FIRINGI revenue.
- **Cash Flow**: money received (confirmed customer payments), paid to suppliers and paid costs per
  month, and an 8-week forecast: customers' open invoices by due date, approved supplier invoices,
  running monthly costs; overdue customer money shown apart.
- **Net Profit** (*Analytics*) per supplier, customer or country, and **Route Profitability**: per
  route, FIRINGI's delivery fees + commission on its stops against driver pay and vehicle cost
  (km × cost per km, *Routing settings*, default € 0.18).
- **Margin Rules** (*Pricing*): minimum and target margin for everything, a country, a category or
  a supplier — the most specific wins (supplier › category › country › everything). Supplier
  allocation never moves an order to a supplier below the minimum; offers below minimum / target
  are listed. **Contract Pricing**: customer- and group-specific prices with their discount
  against the supplier's base price, per wholesaler and distributor.
- **Ratings**: a customer rates a delivered order (order and delivery, 1–5 stars, comment; can be
  changed for 30 days); the supplier sees it on the order and answers; FIRINGI sees all ratings
  (*Vendors › Ratings*) and can hide one that breaks the rules. The supplier dashboard shows its
  score and rating.
- **Supplier Performance** (wholesalers / distributors): scorecard with orders, confirmation
  time, fill rate, on-time delivery, cancellations, returns, rating and an overall score.
- **KPI & Performance** (*Dashboard*): this month's revenue, gross / net profit, margin, orders,
  average order, buying and new customers, supplier fill rate and customer rating, each with a
  monthly target set by finance and progress against it. Commission and supplier payout stay invisible to buyers.

## Marketing & promotions (Phase 15)

- **Offers** (one engine for FIRINGI's and suppliers'): % off, € off per unit, **buy X get Y**,
  **€ off the order** (spread over the matching lines, so VAT stays right per line) and **free
  delivery**. Per line: the best supplier offer, the best FIRINGI offer, then the coupon.
  Commission is always on the normal price. Who pays: suppliers pay their own; FIRINGI chooses
  FIRINGI / supplier / split for its offers (a supplier must accept its share). Free delivery is
  paid entirely by FIRINGI (it waives its fleet fee, or still pays the supplier's flat rate) or
  entirely by the supplier (it delivers free).
- **Coupons**: a code, limits in total / per customer, a budget, first order only, minimum order.
  Customers enter it in the cart or use it from **My offers**; one coupon per order. Limits are
  locked at checkout; cancelled orders give the use back. "Order from FIRINGI" carts take
  FIRINGI-paid coupons only. Error messages in the buyer's language.
- **Customer offers**: automatic offers for one company, a CRM segment, a customer group or
  first orders. Customers see what they can use under *Catalogue › My Offers* (and a banner on
  their dashboard); orders show the coupon and a waived delivery fee.
- **Campaigns** (*Marketing › Campaigns / Email Campaigns / Push Notifications*): to a CRM
  segment, company types and countries, or chosen companies — by e-mail (designed, in each
  person's language, with the code and a button), push, in-app, SMS and WhatsApp (approved
  template). Preview the reach, send now or schedule (cron). Everyone gets *offers & news* unless
  they switch it off (per channel in their notification settings, or the unsubscribe link in
  every e-mail); SMS / WhatsApp also need consent. Results: delivered, skipped with the reason,
  opened, clicked, orders within 7 days of a click or with the campaign's offer, goods sold.
- **Marketing Analytics**: discounts given and who paid, orders and goods sold with an offer,
  coupon orders, discount by kind, top offers, campaign results. Every offer used on an order is
  recorded (`PromotionRedemption`) — limits, budgets and analytics count it.
- Suppliers create coupons, € off the order, free delivery and buy X get Y on their Promotions
  page (translated).

## Risk & control (Phase 16)

- **One cart, several suppliers**: a customer (or a wholesaler buying from distributors) fills
  one cart from several suppliers and checks out once; each supplier's part becomes its own
  order with its own offers, minimum, delivery and fee. FIRINGI-paid coupons count once for
  the whole checkout; credit is checked on the total. The cart shows a group per supplier,
  the order page lists the other orders of the checkout, and *Orders › Order Split* shows split
  checkouts and orders FIRINGI moved to other suppliers. (Who may sell to whom is still enforced
  in the database.)
- **Risk checks at checkout** (*Risk › Fraud Detection*): points for a new account with a big
  order, a big first order, many orders in a short time, an order much bigger than usual, a
  delivery far from the company, a brand-new address or user, a coupon also used by a look-alike
  company (same e-mail domain, phone or address) and frequent cancellations. From the *hold* score
  the orders go **On hold**: stock is reserved, the supplier neither sees nor is told, the customer
  is told it is being checked (and may cancel). From the *review* score they go through and are
  reviewed afterwards. FIRINGI changes thresholds and switches checks on/off.
- **Suspicious Orders**: release a held order to its supplier or cancel it (the customer sees the
  reason); mark flagged ones fine or fraud. Reviewers are alerted.
- **Four-eyes approvals** (*Users › Approval Workflows*): credit notes above an amount, raising a
  credit limit / payment terms, changing an agreed commission, big FIRINGI-paid offers or coupons,
  FIRINGI's IBAN (invoice settings), powerful staff roles and big payments wait for a second
  person — never the requester (also a database rule) and with the same right. Approving runs the
  action exactly as requested; rejecting needs a reason; the requester may withdraw. New staff get
  their ordinary roles at once and powerful ones after approval. Thresholds: settings managers.
- Demo accounts are seeded as long-established (approved a year ago). The test database starts
  with risk checks off; the risk tests switch them on.

## AI Centre (Phase 17)

AI at FIRINGI **only suggests**: nothing it computes or says changes an order, a price, stock
or a setting by itself. A person accepts or dismisses each suggestion.

- **Insights from FIRINGI's own data** (`src/server/ai/insights.ts`, maths in `forecast.ts`):
  demand per product for the next 4 weeks (trend-following smoothing over 12 weeks of orders),
  days of stock left at the current selling rate, each customer's reorder rhythm per supplier
  (median gap, expected date, how late, usual basket), the same product cheaper or more reliable
  elsewhere, offers below the margin rules sized in € a year, and open orders likely to be late
  (not confirmed, requested day close or passed, too little stock, late ETA, supplier history).
  Every insight is scoped to who asks: staff need the AI right **and** the right to that data;
  suppliers see only their own products and customers; buyers only their own orders — never
  commission or payouts (and a buyer ordering from FIRINGI never sees which supplier it picked).
- **Suggestions feed** (*AI Centre › Automated Recommendations*, `src/server/ai/feed.ts`): recomputed
  hourly (`/api/cron/ai` with `Authorization: Bearer $CRON_SECRET`, or when a page finds it stale),
  one suggestion per situation. Accepting a late reorder creates a CRM call task for the account
  owner; accepting a stock warning notifies the supplier (in its language). Suppliers get their own
  stock / demand / late-order suggestions; customers get "time to reorder".
- **AI Business Assistant** — Claude through the Anthropic API (`@anthropic-ai/sdk`, model
  `claude-opus-5-5` by default; Sonnet / Haiku selectable in the AI settings). It answers with
  read-only tools that call FIRINGI's own services **with the asking user's rights** (sales
  summary, breakdowns, forecasts, stock, reorders, scorecards, orders, catalogue, suggestions,
  P&L for finance). Staff use it in the AI Centre. Suppliers and customers see it as **Assistant**
  (its own tool set — only their company's data, never FIRINGI's commission or margins): **on for every
  supplier and customer; FIRINGI can switch it off per company** (Settings › Business Features › Assistant).
  It works as their support & sales agent — see *Assistant: support & sales agent* below. It replies in
  the user's language. Server-side fallback is on (`fallbacks: "default"`): if the model is busy the
  API answers with an eligible fallback model, and the model that answered is logged. Prompt
  caching is on; questions per person per hour are limited (AI settings). Conversations are private
  to the user. **To switch it on, set `ANTHROPIC_API_KEY` on the server and restart**; without it the
  pages explain this and everything else in the AI Centre still works.
- **Pages**: *Dashboard › AI Insights* and the 11 *AI Centre* pages (staff, English); *Orders › Buy
  Again* and the dashboard's "time to reorder" card (customers: one tap puts the usual quantities in
  the cart to check and place); *Reports › Demand & Stock* and the dashboard's stock card
  (suppliers); *Assistant* in both portals unless switched off for the company — all in the 25 languages.
- **AI Activity Log**: every assistant answer (who, which tools, tokens, model), refresh, accept
  and dismiss.
- **Who gets the AI Centre** — FIRINGI staff only, and only the Super Admin by default. Other staff
  get it when a role with *Use the AI Centre* (`admin.ai.view`) is given to them (Users & Permissions ›
  Roles); the Operations, Finance and Sales roles don't include it. Suppliers and customers never see the
  AI Centre; they get the *Assistant* unless FIRINGI switched it off for them, and can always write to
  FIRINGI under *Help & Support*.
- **Demo history**: `pnpm db:demo-history` adds 16 weeks of delivered demo orders (marked
  "Demo history", not invoiced) so forecasts have something to learn from. Never on the test DB.

## Certified invoicing (Moloni) & supplier payouts (Phase 18)

- **Moloni** (AT-certified, certificate n.º 2860) issues FIRINGI Portugal's legal invoices and
  credit notes (`src/server/invoicing/fiscal.ts`, client in `moloni/client.ts`, built from
  moloni.pt/dev). FIRINGI still books every document at once inside the delivery / credit
  transaction (balances, credit, statements never wait); with Moloni on, the document is then
  **pending** and a queue issues it at Moloni (closed = Moloni communicates it to AT), stores
  Moloni's legal number (e.g. `FT 2026/12`), hash and line ids, and serves **Moloni's signed PDF**.
  FIRINGI keeps its own reference in a separate series (`FT-REF FIR2026/…`), so its internal fiscal
  series stays gap-free and hash-chained; Moloni files the SAF-T for what it issued.
- **Robust queue**: sent right after the delivery / credit note and by the cron
  (`/api/cron/invoicing`, every 5 minutes, `Authorization: Bearer $CRON_SECRET`). Moloni down →
  retries with back-off; refused → **Failed**, finance is alerted and can *Send again* after the
  fix. A document is claimed before sending (cron and kick never both send it) and FIRINGI first
  looks for it at Moloni by its reference, so it is **never issued twice** even after a crash.
  Credit notes wait for their invoice and point at its lines. The legal number and a done state
  can't be changed afterwards (database rule).
- **Customers and products** are created at Moloni the first time they are invoiced (customer by
  NIF, product by SKU; delivery fees as a service) and remembered. FIRINGI's VAT rates map to
  Moloni taxes (mainland / Madeira / Azores suggested automatically); 0 % lines carry an exemption
  reason.
- **Settings** (*Finance › Certified Invoicing*): connection status, company, series for invoices
  and credit notes, defaults for new customers / products, VAT mapping, the queue, documents that
  need attention, last issued. Keys only in the server environment: `MOLONI_CLIENT_ID`,
  `MOLONI_CLIENT_SECRET`, `MOLONI_USERNAME`, `MOLONI_PASSWORD` (password grant; tokens kept in
  memory and refreshed), `MOLONI_SANDBOX=true` for Moloni's sandbox. `MOLONI_SIMULATE=1` runs a
  built-in simulated Moloni for development and demos (documents marked `SIM`, not fiscal). Until
  switched on, FIRINGI's internal numbering (marked "not a fiscal document") stays in use.
- **Supplier payouts** stay manual (bank transfer). *Finance › Supplier Payouts Due* lists approved
  supplier invoices still to pay — overdue, due soon, later — by supplier, with a CSV for the bank
  and *Record payout* (four-eyes for big amounts). A supplier invoice without a due date is due
  after the payout days in *Payments* settings (30 by default). Finance gets one reminder a day
  when something is due within 3 days.
- Customer payments online (MB WAY, Multibanco, card, SEPA direct debit): see Phase 20.

## Assistant: support & sales agent

Customers and suppliers chat with FIRINGI's AI in their own language — typed or spoken (🎤) — under
**Assistant** (on for everyone; FIRINGI can switch it off per company in *Settings › Business Features*).
- **Customers — support and sales**: products, prices, stock, offers, their orders and deliveries, unpaid
  invoices, quality claims, the cart. When the customer clearly asks ("add 5 boxes of olive oil"), the
  agent **puts it in the cart** (`add_to_cart`, the same rules as the shop: minimum, multiples, only offers
  the customer can see) and shows a card with *Open cart*. **It never places an order** — the customer
  checks the cart and places it.
- **Suppliers — support only**: their orders, billing statements and charge-backs, quality claims. No cart.
- **Hand-over to a person**: for anything only FIRINGI staff can do (refunds, cancellations, account or
  price changes, complaints) or when someone asks for a person, the agent offers **Send to FIRINGI
  support**. One tap opens a *Help & Support* request in their name with the agent's summary and the chat
  so far; FIRINGI answers there as usual. Once per answer (a second tap opens the same request).
- It only reads the company's own data with the user's own rights, never FIRINGI's commission or margins
  (customers) or FIRINGI's margin (suppliers), and only writes the cart or a support request when asked.
- **Photos and barcodes**: next to the 🎤 there is 🖼️ *Add a photo* (up to 3 per question, camera or
  gallery; the browser shrinks them to 1600 px JPEG first) and 📷 *Scan a barcode* (camera, where the
  browser has a barcode reader — Chrome / Edge on Android and most computers; elsewhere the button
  doesn't show and a photo of the barcode works). The AI reads the photo: a product or its label, a
  **handwritten or printed order list** (it goes line by line, fills the cart with what it matched and
  lists what it couldn't read — it never guesses a quantity), a delivery note or damaged goods. Photos
  are stored with the conversation (owner only — `/api/assistant/photos/…`); when the chat is passed
  to FIRINGI support the photos go with the request and show in Help & Support for the company and
  FIRINGI (`/api/support/<ticket>/photos/…`). Earlier photos aren't sent to the AI again (cost) — the
  answer that followed them carries what they showed. Photos need the real AI; each costs a little more
  than a text question.
- **Switches (FIRINGI admin)**: *AI Centre › Assistant › AI settings* — **Customers** / **Suppliers**
  (the Assistant for all of them at once) and **Photos & barcode scan** (for everyone). *Settings ›
  Business Features* — per company: **Assistant** and **Photos** (both on by default). A company has
  photos only when both the global and its own switch are on; the page warns when a global switch is
  off. Switching photos off keeps the chat (typed and spoken) working.
- **Costs**: the real AI needs `ANTHROPIC_API_KEY` on the server; every question is billed by Anthropic
  (the hourly limit per person in AI settings caps it). Without a key the page says it isn't connected
  and points to Help & Support.
- **Development / tests**: `ASSISTANT_SIMULATE=1` (no API key, never in production — env validation
  refuses it) runs a fixed-rule stand-in for the customer/supplier agent so the chat, cart filling and
  hand-over can be tried and tested. Test: `ASSISTANT_SIMULATE=1 next start …` then
  `node tests/e2e/agent.mjs`; integration: `tests/integration/assistant.test.ts`.

## Voice: speak instead of typing, read aloud

For people who find writing hard: a 🎤 button next to the text box in the **Assistant**, **Help & Support**
(new request and replies) and **quality claims** (description, supplier's answer, messages) — tap, speak in
your own language, tap again; the words land in the box to check and send. A 🔊 **Read aloud** button on
Assistant answers and on Support / claim messages reads them in the user's language. It uses the browser's
own speech features (Chrome, Edge, Safari — phones and computers; nothing to pay, nothing extra on the
server). Chrome and Edge send the audio to their online speech service to turn it into text (said in the
button's hint); the browser asks for the microphone the first time. Where a browser can't (Firefox), the
buttons don't show and typing works as before. 25 languages; FIRINGI's pages in English.
Test: `node tests/e2e/voice.mjs` (a fake speech engine stands in for the microphone).

## Returnables & deposits (Phase 40)

Code: `src/lib/returnables.ts` (rules), `src/server/returnables/service.ts`; details `docs/returnables.md`.
- **Two kinds of returnable**: **deposit** items (crates, pallets, bottles, boxes) — every unit delivered carries a
  deposit, refunded when the empty comes back — and **refill / swap** items (gas cylinders, kegs) — the customer hands
  back an empty for each full one; only units without an empty to swap carry the deposit.
- **Who defines them**: FIRINGI keeps a shared list (EUR pallet, beer crate, glass bottle, kegs, butane/propane
  cylinders…); suppliers add their own items and link their products (*Products › Returnables*, e.g. 1 crate + 24
  bottles per case).
- **Customers see it before ordering**: deposit / refill panel on the product page, a badge on product cards, and in
  the cart the estimated deposit plus the empties they will hand back (defaults to what they hold).
- **Money**: deposits are separate lines on FIRINGI's delivery invoice and on the supplier's billing statement
  (pass-through: no commission, no margin). Returned empties are refunded by credit note — newest deposit invoices
  first, never more than the customer has paid in; the supplier gets the matching credit statement.
- **VAT on deposits — the admin sets it per country** (no VAT / same as the goods / fixed rate); defaults: no VAT in
  Portugal, the goods' rate elsewhere (*Settings › Returnables & Deposits*).
- **Empties come back** at a delivery (the driver counts them on the proof-of-delivery form — online and in the
  offline driver app), on a **pickup** the customer asks for (the supplier plans a driver and day), or brought to the
  supplier (**drop-off**). The supplier **checks** them (accepted / damaged / missing); the customer is told and can
  **contest**; FIRINGI decides (*Orders › Empties & Deposits*).
- **Kept too long — the admin chooses**: after N days remind the customer (open balance), or keep the deposit as the
  price; per-supplier exceptions. Daily job `/api/cron/returnables`.
- **Statements & reports**: balances per customer / supplier / item, deposits paid in, overdue empties, movements CSV
  (`/api/returnables/statement`). Deposit invoice lines and credit notes flow into the accounting exports as usual.
- Tests: `tests/unit/returnables.test.ts`, `tests/integration/returnables.test.ts`, browser `tests/e2e/returnables.mjs`. Screenshots `docs/screenshots/rt-*.png`.

## Installable phone app & offline mode (Phase 39)

Code: `public/sw.js`, `src/server/app/*`, `src/lib/offline/store.ts`, `src/components/app/*`; details `docs/app.md`.
- **Install** FIRINGI on phones and computers like an app — every portal (buyers, suppliers, drivers, FIRINGI staff):
  manifest per portal with icons and **home-screen shortcuts** in the person's language, an install card (iPhone gets the
  Add-to-Home-Screen steps), the unread count on the **app icon**, and a thumb-friendly **bottom bar** on phones.
- **Offline, the supply chain keeps going** — the phone keeps each person's data (buyers: usual products with their own
  prices, orders, invoices + PDFs; drivers: today's route; suppliers: open pick lists). With no signal the saved
  **offline mode** opens: buyers order, drivers deliver (signature / photo) or report a failed delivery, suppliers pick
  with scan checks. An **outbox** sends everything when the signal returns — each action once, by its author, with the
  server's checks.
- **Price or stock changed meanwhile — the admin chooses**: always ask the buyer, or place by itself when prices moved at
  most N %; unavailable products always go back to the buyer.
- **Scan to reorder** — camera or scanner on a shelf barcode → the product goes in the cart with the usual quantity.
- FIRINGI: *Settings › Phone App* (English) — portals, install card, price rule, what phones keep; installs and offline
  actions. Sign-out clears the phone.
- Tests: `tests/integration/app.test.ts`, browser `tests/e2e/app.mjs` (real offline). Screenshots `docs/screenshots/app-*.png`.

## Clearance deals (Phase 38)

Code: `src/lib/deals.ts` (pricing maths), `src/server/deals/service.ts`; details `docs/deals.md`.
- **Five kinds**, each switched on or off by FIRINGI: **flash price**, **multi-buy** (e.g. 3 for the price of 2),
  **volume prices** (tiers), **whole lot** (one price for the lot) and **best offer** (the buyer offers a price; the
  supplier accepts, turns it down or counters; offers at or above the supplier's floor are accepted by themselves).
- **Suppliers** (*Products › Clearance Deals*, 25 languages) — pick a product (and lot), the kind, prices, start/end,
  units on the deal and per buyer; the form shows the list price, the discount and FIRINGI's commission first.
  The supplier funds the discount.
- **Approval — the admin chooses**: every deal waits for FIRINGI, or deals within limits (default ≤ 50 % off,
  ≤ 14 days, optionally only trusted suppliers) start by themselves and the rest wait. FIRINGI approves (optionally
  with its own commission on that deal), turns down with a reason, or stops a deal (*Pricing › Clearance Deals*, English).
- **Lower commission on clearance** — a deal on a lot that expires within 21 days (or overstock: more than 60 days
  of sales) is a clearance deal: FIRINGI's commission is the clearance rate (default 4 %, never above the supplier's
  usual rate) on the deal price. Other deals: the usual rate on the deal price. Commission is never shown to buyers.
- **Buyers** (*Catalogue › Clearance Deals*, 25 languages) — deals page with filters and countdowns, badges on product
  cards, a deal panel on the product page, add to cart at the deal price, offers / counter-offers, “my offers”.
  In the cart the deal price replaces promotions and coupons on that line; the cart says why a deal doesn't apply
  yet (too few for the volume price, more than is left, per-buyer limit…). Order lines keep the deal.
- **Telling buyers** — watchlist (products, suppliers), **smart alerts** to buyers who bought the product before
  (not if they switched “Offers & news” off; at most 3 a day), and an opt-in **daily digest**. Hourly job
  `/api/cron/deals` ends deals, expires offers, sends alerts and the digest.
- Tests: `tests/integration/deals.test.ts`, browser `tests/e2e/deals.mjs`. Screenshots `docs/screenshots/deals-0*.png`.

## Bank reconciliation (Phase 37)

Code: `src/lib/bank/*` (statement parsers), `src/server/bank/*`; details `docs/bank.md`.
- **Getting the lines in** — CAMT.053 (XML), MT940, CSV or Excel (columns guessed, mapping saved per account), or the
  daily **bank feed** (GoCardless Bank Account Data; a simulated bank for tests). Lines already imported are skipped;
  opening + lines ≠ closing balance is flagged.
- **FIRINGI** (*Finance › Bank Reconciliation*, English) — each line is matched to customer payments (invoice
  numbers in the transfer, remembered IBANs, names, amounts; several invoices in one transfer, part payments, the
  rest as customer credit, a few cents short closed as a bank fee within the tolerance), payments already recorded
  (online, direct debit, provider settlements — never recorded twice), supplier payouts and transfers, pay-before-
  shipping orders, rules (“contains X → bank fees”). Each suggestion shows how sure it is and why. **The admin
  chooses**: always confirmed by a person, or sure matches (≥ 95 % by default) booked by themselves. Undo, ignore,
  match by hand.
- **Suppliers and customers** (*Finance › Bank*, 25 languages) — the same for their own books: FIRINGI's payouts,
  their payments to FIRINGI, FIRINGI invoices, their accounting entries, rules; auto-booking if FIRINGI allows it.
- Daily job `/api/cron/bank`: feeds, matching what waits, consents ending, lines to check.
- Tests: `tests/unit/bank-parse.test.ts`, `tests/integration/bank.test.ts`, browser `tests/e2e/bank.mjs`.
  Screenshots `docs/screenshots/bank-0*.png`.

## Supplier plans & early payout (Phase 36)

Code: `src/server/plans/service.ts`, `src/server/plans/early-pay.ts`; details `docs/plans.md`.
- **Plans** (*Vendors › Supplier Plans*, English) — FIRINGI edits plans (starting with Free, Pro 49 €, Business 149 € a month,
  excl. VAT): which **features** they unlock (inventory, planning, warehouse, price insights, advertising, integrations/API,
  routes, AI assistant), **limits** (active products, users, warehouses, drivers), the **commission** on sales (empty = each
  supplier's agreed rate) and **early-payout terms** (off, % per day early or a flat %, minimum fee, free ones a month).
  Changing a plan's commission needs a second person (four-eyes); FIRINGI can still keep a supplier's own commission.
- **Nothing changes until FIRINGI switches plans on.** Then every supplier gets a **free trial** of the trial plan
  (default Business, 60 days — everything it uses today keeps working), with reminders (14/7/1 days, 25 languages);
  at the end the plan it chose starts, otherwise the default plan (Free).
- **Supplier page** *Company › Plan & Billing* (25 languages): current plan, trial days left, plan cards to compare and
  choose (upgrade now — the difference for the rest of the month is invoiced; cheaper plans from the next period),
  usage against limits, plan invoices (PDF). Features outside the plan leave the menu and their pages show an upgrade
  card; limits stop adding more (message in the supplier's language); the supplier API needs Integrations.
- **Billing** — monthly in advance, FIRINGI service invoice; deducted from payouts ("Compensação") or by invoice,
  per supplier. Daily job `/api/cron/plans`.
- **Early payout** (*Finance › Early Payout*, 25 languages) — approved supplier invoices not yet due (at least 3 days)
  can be paid now, whether or not the customer has paid. The page shows the fee and what the supplier receives; the
  supplier asks, FIRINGI's finance team sends the transfer and marks it paid (or turns it down with a reason): a fee
  invoice is issued and settled, the supplier's invoices end up fully paid. Limit per supplier on what is paid early at
  once; switch per supplier; above the four-eyes threshold a second person approves (*Early Payouts* queue).
- Tests: `tests/integration/plans.test.ts`, browser `tests/e2e/plans.mjs`. Screenshots `docs/screenshots/plans-0*.png`.

## Order chat (Phase 35)

Conversations on each order. Code: `src/server/chat/service.ts`, filter `src/lib/chat.ts`; details `docs/chat.md`.
- **Who talks — FIRINGI decides** (*Orders › Order Chat*, English): four conversations per order, each switched on
  or off: **buyer ↔ supplier**, **buyer ↔ FIRINGI**, **supplier ↔ FIRINGI** (never shown to the buyer) and the
  **driver** (the driver, the buyer and whoever runs the delivery — the supplier for its own fleet, otherwise
  FIRINGI; open only while the delivery is on the road and a set number of hours after). FIRINGI staff read and
  can write in every conversation. On orders FIRINGI routed there is no buyer ↔ supplier conversation, and a
  supplier who writes elsewhere shows to the buyer as "FIRINGI" — the supplier stays hidden. No prices in the chat.
- **Contact details hidden** — phone numbers, e-mails (also "name at gmail dot com"), IBANs and links become
  `[•••]`; the sender is warned; the message is **flagged** for FIRINGI (*Order Chat › Flagged messages*: what was
  typed, who, which order; mark reviewed). Order/route/invoice numbers, prices, dates and postcodes are left alone.
  FIRINGI can switch hiding off for one company (*Business Features › Hide contacts*; still flagged) or the chat
  off for a company (*Business Features › Order chat*).
- **Translated with AI** — each reader sees messages in their own language with "show original" (made once per
  language and kept). Uses the AI key (`ANTHROPIC_API_KEY`); model chosen in the settings (default Claude Haiku 5.5:
  fast and cheap per message). Without a key messages show as written.
- **Photos** (up to 3 per message), **unread badges**, **Messages** inbox for customers and suppliers (*Orders ›
  Messages*) and drivers, a notice per burst of messages (in-app, push, e-mail — 25 languages), read-only after the
  order has ended (default 30 days). Pages work on phones, day and night.
- Tests: `tests/integration/chat.test.ts`, browser `tests/e2e/chat.mjs`. Screenshots `docs/screenshots/chat-0*.png`.

## Sponsored products (Phase 34)

Suppliers (wholesalers, distributors) pay FIRINGI to show their products higher up. Code: `src/server/ads/service.ts`.
- **Placements** — search results, category pages, shop home ("Featured"), cart suggestions ("You may also need").
  FIRINGI switches each on or off and sets its slots, minimum price per click and price per day
  (*Marketing › Sponsored Products*). Buyers see the products marked **"Sponsored"** (25 languages); no ads in
  "order from FIRINGI" countries (suppliers aren't shown there) and never to the advertiser itself.
- **Pricing, chosen per campaign** — *per click* (bid ≥ the minimum, daily budget, optional total budget; a buyer
  clicking the same ad again within the repeat window — default 30 min — isn't charged again) or *per day*
  (fixed price per booked day, start and end; a placement can't be booked by more campaigns than it has slots;
  booked days are paid whether or not anyone clicks). Booked ads show first, then per-click ads by bid. Prices
  exclude VAT. Search ads also show for the supplier's extra search words; category ads for a chosen category
  (or the products' own); cart ads for products in the same category as something in the cart.
- **FIRINGI approves** each campaign (can be switched off), can pause or end any; the supplier is notified
  (approved / not approved / stopped / low balance — 25 languages).
- **Billing — agreed per supplier, set by FIRINGI** (*Advertisers & billing*): **deducted from payouts** (a monthly ad
  invoice, settled against FIRINGI's open payable to the supplier: a confirmed inbound payment to the ad invoice and
  an outbound payment of the same amount to the supplier's invoices, reference "Compensação"), **prepaid balance**
  (FIRINGI records each transfer → an invoice-receipt is issued and the net amount added; ads stop when it's used
  up) or **monthly invoice** (normal terms). A remaining prepaid balance is always used first. Ad invoices are FIRINGI
  service invoices (no order): the FIRINGI entity of the supplier's country with its standard VAT rate, or the main
  entity under the EU reverse charge for a supplier in another EU country. Monthly invoices go out on the 1st
  (hourly job `/api/cron/ads`) or with *Invoice ad costs now*.
- **Supplier pages** (*Advertising*, 25 languages): my ads with results (shown, clicks, click rate, spent, orders by
  buyers within 7 days after a click), new ad (cost of a booking shown before sending), ad page (pause / resume /
  end, change price and budgets), ad billing (method, balance, how to top up, FIRINGI's ad invoices with PDF).
- **Switches**: global + per placement (FIRINGI), per supplier (*Business Features › Advertising*).
- Tests: `tests/integration/ads.test.ts`, browser `tests/e2e/ads.mjs`. Screenshots `docs/screenshots/ads-0*.png`.

## Launch readiness & pilot (Phase 33)

Everything needed to go from this code to real customers. The step-by-step guide is **`docs/launch.md`**.
- **Launch Readiness** (*Settings › Launch Readiness*, `src/server/launch/service.ts`): one live checklist —
  server settings (production mode, required secrets, no test shortcuts, storage, Sentry), security (staff
  two-factor sign-in, two super admins, **no demo data**, sign-in limit), FIRINGI's invoicing entities
  (one per country with buyers, real details, valid IBAN by check digits), certified invoicing (Moloni live
  and mapped; internal invoicing fails in Portugal), payments (simulator = fail, Stripe test = warning,
  none = warning: bank transfer is fine for a pilot), messages (SMTP required; SMS/WhatsApp, push, AI
  optional), backups (nightly backup OK, encrypted, restore tested) and scheduled jobs, the marketplace
  (open countries; per country delivery zones, VAT rates, approved suppliers, products on sale) and legal
  links. Each item is OK / Warning / Must fix with a link to the page that fixes it. Any *Must fix* = not
  ready; only warnings = ready for a pilot.
- **FIRINGI's invoicing entities** are now added and edited in *Settings › Company Settings* (a production
  start creates none). Tax number and country lock once an invoice was issued with them; one active entity
  per country; the IBAN still goes through *Payment Settings* (four-eyes). Audited.
- **Pilot mode** (*Settings › Pilot & Invites*): registration by invitation only. An invitation is for one
  business, e-mail, account type and country; valid 1–180 days; used once (inside the registration
  transaction); e-mailed in the country's language, or created as a link to send yourself; can be sent
  again or revoked. Without a valid invitation the registration form isn't shown (told why, in the
  visitor's language, with the support e-mail); with one, the business name and e-mail are filled in and
  the country is fixed. Drivers and existing accounts aren't affected. Customers and suppliers see a
  feedback banner (*Support*) while the pilot runs.
- **Legal links**: the terms of service and privacy policy links (set in Launch settings) appear in the
  "I accept…" line of every registration form (25 languages). FIRINGI links to your texts — they should be
  written or checked by a lawyer.
- **Demo data** is not wiped by a button: deleting across the whole database is riskier than starting
  clean. Production starts from an empty database with `prisma/seed/bootstrap.ts`; the checklist fails
  while any demo account exists.
- Tests: `tests/integration/launch.test.ts`, browser `tests/e2e/launch.mjs`. Screenshots `docs/screenshots/launch-0*.png`.

## Loyalty & rewards (Phase 32)

Customers and wholesalers earn points on delivered goods and spend them as a discount or as credit.
**FIRINGI pays for every reward — supplier payouts and commission don't change.**
- **Earning** (`src/server/loyalty/service.ts`): points per € of delivered goods (net, after discounts,
  excl. VAT and delivery fee — from the invoice) × the level's multiplier × the best running bonus
  campaign for each product line. Credited at delivery (status change or driver proof of delivery) and by
  the hourly job (`/api/cron/loyalty`), once per order. Goods credited later (returns, quality claims,
  FIRINGI credit notes) take their points back; a cancelled order gives spent points back (not when
  FIRINGI moved it to another supplier — the discount went with it).
- **Start date**: points only for orders delivered from the programme's start day (set the first time
  loyalty runs; FIRINGI can change it in the rules) — switching it on doesn't pay out for old orders.
- **Spending** — in the cart: "Use your points" (from the minimum, up to a share of the goods set by
  FIRINGI). The points discount is a FIRINGI-funded "€ off the order" spread over the lines like a coupon
  (system promotion `loyalty-points`, paused so it never applies on its own), shown apart from offers, on
  FIRINGI's invoice; it doesn't push an order under a delivery minimum. Spent inside the order
  transaction (refused if the balance changed). Not available when FIRINGI chooses the supplier
  (routed cart) or on orders that wait for a manager's approval. **Credit note**: points turn into a rebate
  credit note on the oldest unpaid invoice that covers it (split over the invoice's VAT rates, no goods,
  no supplier credit statement).
- **Levels** by the last 12 months' delivered spend: Bronze / Silver / Gold with a points multiplier, free
  delivery (Gold by default, FIRINGI pays) and priority support (support requests open as HIGH).
- **Referral**: every account has a code and link (`/register/customer?ref=CODE`); when the invited
  business's first order is delivered, both get bonus points (once).
- **Expiry**: points expire after N months, oldest first; a reminder goes out before (25 languages).
- **Pages**: customers — *Rewards* (points, value, level and progress, benefits, campaigns, invite link,
  credit note, history) and the cart box, 25 languages. FIRINGI (English) — *Marketing › Loyalty &
  Rewards*: KPIs (members, points and value outstanding, used, earned, expired), rules, levels, referral,
  *Run now*; *Bonus campaigns*; *Members* with each ledger and *Give or take points* (with a reason,
  audited). *Settings › Business Features* — **Loyalty** switch per company (on by default); the global
  switch is in the rules. Distributors only sell, so they aren't part of it.
- **Finance**: points used appear as the "Loyalty points" promotion in Marketing Analytics and lower
  FIRINGI's margin on those orders; credit notes reduce the customer's open invoices (the invoice list now
  subtracts all credit notes — returns and claims too). The ledger can't go below zero (database rule).
- Tests: `tests/integration/loyalty.test.ts`, `node tests/e2e/loyalty.mjs`.

## Quality claims & credits (Phase 31)

Customers › Orders › **Quality Claims** (+ *Report a problem* on a delivered order); suppliers › Orders ›
**Quality Claims** and **Quality Score** (25 languages); FIRINGI › Orders › **Quality Claims**, **Claim
Charge-backs**, **Quality & Alerts**, **Claim Settings** (English). FIRINGI is merchant of record, so FIRINGI
decides every claim; AI only suggests, a person decides.

- **Customer claims** — within the claim window after delivery (48 h by default) the customer reports what
  is wrong — damaged, missing, wrong product, temperature, short-dated / expired, poor quality — per order
  line and quantity (never more than delivered minus earlier claims and returns), the lot when it got
  several, a description and photos (required for the reasons FIRINGI chooses; resized on the phone), and
  whether it prefers a credit note or a replacement. Branch staff see only their shops' orders. Photos are
  served only to the customer, the supplier and FIRINGI.
- **The supplier's side** — the supplier accepts or disputes (with reasons and photos) and can write in the
  claim's conversation; it is reminded once when it hasn't answered in time (24 h). FIRINGI can add notes
  only FIRINGI sees.
- **FIRINGI's decision** within the SLA (48 h; overdue claims are flagged and FIRINGI gets one reminder a
  day): reject (the reason is shown to both sides) or approve quantities per line with whose fault it was —
  **credit note** (certified through the invoicing provider; optionally with the delivery fee) or a
  **replacement** the supplier delivers free and confirms. Credits above the approval threshold
  (Risk › Approvals) need a second person (four-eyes, kind *Quality claim credit*).
- **Who pays** — *supplier's fault* (goods, packing, picking, and the supplier's **own** delivery: its
  drivers are its own staff and get no fee from FIRINGI): the credit goes on a CREDIT billing statement at
  the supplier's cost price; the supplier issues its credit note to FIRINGI and it is netted off its
  payout (the payouts list shows open claim charge-backs per supplier). The supplier can dispute a
  charge-back; FIRINGI upholds or waives it (waived = FIRINGI carries it, the statement is closed).
  *FIRINGI driver's fault*: FIRINGI credits the customer; a charge-back to the driver is only possible when
  the customer paid a delivery fee or flat rate for that delivery, and at most the driver's per-delivery
  pay for it; it is deducted on Driver Earnings. *Goodwill*: FIRINGI carries it.
- **Driver pay** — FIRINGI drivers earn per completed route and per planned km as before, and the
  per-delivery pay **only for deliveries the customer paid a delivery fee or flat rate for** (free
  deliveries earn none). Driver Earnings shows the fee-paid count and claim deductions; P&L and route
  profitability use the same rule.
- **Quality scores & alerts** (daily job `claims`, `/api/cron/claims`, scheduler 07:19) — claim rates per
  supplier (upheld supplier-fault claims per delivered order), product (claimed per delivered unit), lot
  and FIRINGI driver, claims by reason, time to decide and share decided within the SLA. Upheld claims
  lower the supplier scorecard (Performance) and its reliability in supplier allocation. Thresholds
  (Claim Settings) raise one alert per supplier / product / lot / driver, not again within 30 days of
  being acknowledged; a lot alert links to Recalls. Suppliers see their own score, alerts, products, lots
  and charge-backs.
- **Privacy** — the customer sees what it paid and the credit, never the supplier's cost or FIRINGI's
  margin; the supplier sees its own cost and charge-back, never the sale price or the customer's credit.
- Notifications: `claim.opened`, `claim.message`, `claim.supplier_responded`, `claim.answer_needed`,
  `claim.decided`, `claim.replaced`, `claim.chargeback`, `claim.chargeback_disputed`,
  `claim.chargeback_resolved`, `claim.overdue`, `quality.alert`.
- Test: `node tests/e2e/claims.mjs` (order → delivery → claim with photo → supplier disputes → FIRINGI
  credits at the supplier's fault → charge-back disputed and upheld → quality, settings, payouts, driver
  earnings, phone width).

**Responsive cards (also in this release)** — wrapped titles and labels no longer overlap (titles use
normal line height and break long words); KPI numbers shrink with their tile (container queries) instead of
spilling out; tiles, hero stats and dashboard cards pick their columns from the space they actually have;
the sidebar is a slide-in menu below 1024 px, so tablets get the full width; supplier cards, call logs,
import history and warehouse value boxes wrap on phones. Checked page by page in all four portals at 390,
768, 1024 and 1280 px.

## Demand planning & restock (Phase 30)

Suppliers › **Planning** — Planning Overview, Demand Forecast (+ one product's page), Restock,
Overstock & Expiry, Lead Times, Demand Events, Planning Settings (25 languages; FIRINGI's own warehouse
uses the same pages through its in-house wholesaler). FIRINGI › Inventory & Warehouses › **Demand
Planning** — Overview, Stock-out Risk, Forecast Accuracy, Supplier Lead Times, Overstock & Expiry Risk,
Demand Events, Planning Settings (English). The plan only suggests: nothing is ordered, moved or
discounted without a person.

- **Forecast** (nightly job `planning`, `/api/cron/planning`, scheduler 04:37) — weekly units per
  product × warehouse from the orders shipped from that warehouse (up to 78 weeks). Methods compete in
  a rolling one-week-ahead back-test and the lowest mean absolute error wins: the recent average, Holt
  with a damped trend (smoothing weights fitted to the product), Croston/SBA for products that sell in
  some weeks only, and same-weeks-last-year once there is a year of history. The forecast comes with an
  80 % range. **Demand events** (FIRINGI-wide holidays / seasons per country or category, suppliers' own
  promotions per product; −90 % … +300 %) are taken out of the history and put back into the forecast.
- **Accuracy** — each week's forecast is frozen when the week starts and compared with what sold
  (accuracy = 1 − WAPE, bias); a series planned for the first time is back-tested over the previous
  weeks with only the data available then, so accuracy shows from day one.
- **Restock** (periodic review, order-up-to): safety stock = z(service level) × σ × √((lead time +
  review days) / 7); reorder point = demand during the lead time + safety stock (a manual reorder point
  is a floor); order up to the demand of lead time + review period + safety stock, rounded up to the
  pack multiple, at least the minimum order. Free stock, purchase orders on the way **and drafts** and
  transfers in transit count, so nothing is suggested twice. Urgency: out of stock, too late (runs out
  before goods can arrive), order now, soon (with an order-by date). One open suggestion per product ×
  warehouse; ticking suggestions creates **draft** purchase orders, one per source and warehouse (sent
  as usual from Purchase Orders); "not now" hides one for 7–90 days. New urgent suggestions notify the
  supplier (`planning.restock`).
- **Lead times** — measured from purchase order sent to first goods receipt (median, 90 % within, on
  time vs the promised date, filled in full) per outside supplier and per distributor on FIRINGI. With
  3+ receipts planning uses the measured time unless the supplier unticks it; a product can override it.
- **Planning choices** per product × warehouse: where it is bought (outside supplier or a distributor's
  product on FIRINGI), agreed cost, minimum order, pack multiple, lead time, service level, "don't
  restock". Supplier settings: service level, order rhythm, overstock limit (FIRINGI sets the defaults).
- **Overstock & expiry** — first-expiry-first-out projection of each lot against the forecast: what
  won't sell before its best-before is at risk (at cost). Suggested action: move it to another warehouse
  of the supplier that will sell it (creates a draft transfer), a markdown when it is within 30 days of
  the date (one click when FIRINGI allows markdowns for that supplier, otherwise ask FIRINGI), write off
  if expired, otherwise stop buying. Stock beyond the overstock limit is listed the same way.
- **FIRINGI** sees every supplier's out-of-stock / too-late / order-now products, accuracy, lead times
  and stock at risk, and can ask a supplier to restock a product (`planning.flagged`, at most every 3
  days per product), add public demand events, set the defaults and run the plan now.
- Demo: `pnpm db:demo-planning` (dev / demo databases only) gives Distribuidora Atlântico's Armazém
  Maia realistic stock on kebab cones, flour, rice and pizza boxes, three outside suppliers with past
  purchase orders (the cold-chain one promises 5 days and takes ~7), a short-dated mozzarella lot and a
  winter kebab promotion. `node tests/e2e/planning.mjs` needs it.

## Price intelligence (Phase 29)

FIRINGI › Pricing & Commercial › **Price Intelligence** — Overview, Price Comparison, Price History,
Price Alerts, Price Change Approvals, Margin Heat-map, Price Suggestions, Price Rules & Approvals
(English); suppliers › Products › **Price Insights**; customers › Catalogue › **Price Changes**
(25 languages).

- **Every price change is kept** — a database trigger on `PriceListItem` writes `PriceHistory`
  (old / new price, change %, base / group / customer / contract list, quantity tier) whatever
  changed it: the supplier's screens, catalogue imports, the API or the approval job. The history is
  append-only. The prices that existed at the upgrade start it; `pnpm db:demo-prices` adds six months
  of earlier demo prices (dev / demo databases only).
- **Comparison** — per product variant, the base price per unit (a 12-pack counts as 12 units) of
  every active, visible offer, compared within its market: wholesalers per country, distributors
  EU-wide; min / median / max, spread, cheapest and dearest supplier. **History**: a step chart per
  supplier for six months (hover for every supplier's price on a day) plus the table of changes.
- **Big increases wait for FIRINGI** — a supplier increase above the threshold (default 10 %, on any
  price list and tier with a current price) isn't applied: it becomes a request FIRINGI approves
  (with the market median beside it) or rejects with a reason. An approved increase applies at least
  the notice days later (default 7); customers who bought the product in the last 90 days, keep it in
  an order list or recurring order — or the customers of the group / contract list — are told right
  away (`price.increase_notice`) and see it under **Price Changes**; until the date they pay the old
  price. The supplier can withdraw a request until it applies; a newer price for the same item
  replaces it. Decreases, small increases and new prices apply at once.
- **Alerts** (hourly job `pricing`, `/api/cron/pricing`, scheduler :23): a base price up ≥ 15 %
  within 7 days, or ≥ 30 % above / below the median of the same product (markets with 3+ suppliers).
  Alerts close by themselves when the price is back in line; dismissed alerts stay dismissed while
  the price is the same. The same job applies approved increases on their date. FIRINGI can ask a
  supplier to review a price (`price.review_requested`).
- **Margin heat-map** — FIRINGI's margin (what customers paid net − what FIRINGI pays the supplier)
  per top category × supplier / customer type / customer country, 30 days to 12 months; one-hue scale.
- **Suggestions** (FIRINGI decides; nothing is applied automatically) — suppliers whose margin over
  90 days is under the margin rule: suggested commission and what it would have earned (applying it
  uses the normal commission change, incl. four-eyes); offers far above / below the market: ask the
  supplier to review / check for a typo.
- **Supplier price insights** — each product's position (among the cheapest, below / above the
  median, among the most expensive), the market median and % difference, a 6-month sparkline of its
  own price and a suggestion. Markets are only shown with at least 3 suppliers and never name
  competitors or show their exact prices.
- All thresholds are in **Price Rules & Approvals** (`pricing.intel` setting). Notifications:
  `price.change_requested`, `price.alerts` (FIRINGI), `price.change_approved`, `price.change_rejected`,
  `price.review_requested` (suppliers), `price.increase_notice` (customers).

## Supplier compliance (Phase 28)

Suppliers › Company › **Certificates & Compliance** (25 languages); FIRINGI › Vendors › **Supplier
Compliance** — Compliance Dashboard, Certificate Review, Supplier Certificates, Certificate Types &
Badges, Compliance Audit (English); customers see **verified badges** in the shop.

- **Approval rules reworked** — the only hard requirements are the VAT number and addresses (plus VIES
  for distributors and a commission for suppliers). Supplier **companies** give their **permanent
  certificate code** (PT *certidão permanente* access code `0000-0000-0000`, elsewhere the registry
  number) in Profile; **sole traders** don't (legal form is a new profile field; PT individual NIFs were
  set to sole trader by the migration). **Customers** upload **one recent invoice from their POS**
  (dated, at most 90 days old). FIRINGI can **approve anyway** without the code or the invoice: a note
  (≥ 10 characters) is required and kept on the company, in the status history and in the audit log
  (`company.status.approved_anyway`). Business registration / tax / trade-licence documents are optional.
  The applicant's checklist shows these as "also asked for" — they don't block submitting.
- **Certificate types** (FIRINGI) — 9 built-ins (HACCP, food establishment approval, EU organic,
  ISO 22000 / FSSC 22000, IFS / BRCGS, Halal, product liability insurance, tax clearance, social
  security clearance) plus any FIRINGI adds. Per type: distributors and / or wholesalers, supplier
  countries, **categories** (empty = whole supplier), **required** or optional, number needed, has an
  expiry, **grace days** after expiry, FIRINGI **re-check** every N months, **customer badge on / off**,
  customers may download. Built-ins start optional, so nobody was paused by the upgrade. Saving a type
  re-applies the rules to every supplier at once.
- **Certificates** (suppliers) — upload with number, issuer, issue and expiry dates and the file
  (PDF / image, 10 MB, private). FIRINGI reviews it with the file shown, corrects the expiry / number,
  sets the next re-check and approves or rejects (note to the supplier). A renewal replaces the
  approved certificate only once approved (versions kept). FIRINGI can revoke, mark re-checked and
  hide the supplier's badge.
- **Automatic pause** — a supplier missing a required certificate (missing, waiting for review,
  rejected, or expired beyond its grace days) is paused: all its offers (whole-supplier types) or only
  its offers in the type's categories (and sub-categories) disappear from the catalogue, search,
  product pages, checkout pricing and FIRINGI's supplier allocation (`visibleOfferWhere` +
  allocation candidates). New offers in such a category start paused. FIRINGI can give a **grace
  period** (waiver until a date, ≤ 1 year, reason audited). Approval / waiver resumes immediately.
  Suppliers see a banner on the dashboard, "Paused — certificate" in their product list and the reason
  on the compliance page (score: required types count double).
- **Daily job `compliance`** (`/api/cron/compliance`, scheduler 05:47 UTC): expires certificates,
  reminds suppliers 30 / 14 / 7 days before expiry (once each; a late first run sends one), tells
  FIRINGI about due re-checks and re-applies pauses. Notifications: `compliance.expiring`, `expired`,
  `paused`, `resumed`, `approved`, `rejected` (suppliers) and `compliance.review`, `recheck` (FIRINGI).
- **Verified badges** — approved, in-date certificates of types whose badge FIRINGI switched on, not
  hidden for that supplier: chips on supplier and product cards, a "Verified by FIRINGI" panel (with
  the certificate to download when the type allows it) on the supplier store and product page, and a
  **Verified** filter on the shop home and suppliers list (also `?badge=` on `/api/catalogue/offers`).
  In "order from FIRINGI" countries the supplier isn't shown, so no badges are; the filter still works.
- **Dashboard & audits** (FIRINGI) — % of live suppliers fully compliant, average score, waiting for
  review, expiring in 30 days, re-checks due, paused suppliers, coverage per certificate type,
  expiring / re-check tables, per-supplier checklist with grace periods and every upload, and the
  append-only compliance audit trail. Permissions: view = `admin.vendors.view` / `admin.risk.view`;
  decide = `admin.vendors.approve` / `admin.risk.manage`.

## Shops, budgets & optional accounting (Phase 27)

Customers and wholesalers › **My Shops** (Shops, Budgets, Shop Reports) and, when FIRINGI switched it
on, **Accounting** (Dashboard, Daily Sales, Expenses, Profit & Loss) — also in the Sell portal for
suppliers; FIRINGI › Customers › **Customer Shops** and Settings › **Business Features** (English).

- **Shops under one company** — a customer adds its shops / restaurants / sites to its one company
  account (one tax ID, one team, FIRINGI's invoices to the company). Each shop has its own delivery
  address (created with it, more can be added or moved in), a **category** (restaurant, kebab / pizza,
  café / bar, mini-market… — the business types) so FIRINGI can serve each shop better, a short code,
  a **cost centre**, a phone and a manager. A shop that never ordered can be deleted; otherwise it is
  deactivated (its addresses can't be ordered to; its history stays). Suppliers keep using
  Company › Warehouse & Pickup Addresses for their warehouses (Inventory has a shortcut).
- **Staff per shop** — team members assigned to shops only see, order to, approve and get notified
  about their own shops (orders, invoices, approvals, budget alerts, branch reports); members with no
  assignment and people with the new `buyer.branches.manage` see everything. Notifications about an
  order / invoice / approval / budget are routed by the shop of what they are about.
- **Orders carry the shop** — the shop (from the delivery address), its cost centre and the buyer's
  **PO reference** are stamped on every order (also orders FIRINGI routes or moves to another
  supplier), shown on the order to the buyer and FIRINGI, printed on FIRINGI's invoice PDF and sent
  to Moloni in the document notes. The company can make the PO reference **required** (people placing
  in the shop or accepting a quote; approvals and recurring orders carry theirs).
- **Budgets** — weekly (Mon–Sun) or monthly limits incl. VAT per shop or for the whole company,
  optionally only for some categories. Over the budget, the company chooses: **needs a manager's
  approval** (goes into the Phase 26 approvals; people who may approve go through), **refused**, or
  **placed and the managers told**. The cart shows the shop's budgets live for the chosen address.
  Alerts once per period at 80 % and 100 % (`budget.threshold`, to people who manage shops and the
  shop's manager). API orders and purchase orders aren't checked; FIRINGI-routed carts count but
  aren't held.
- **Shop reports** — spend per shop and share, orders, average order, budget use, waiting approvals,
  top products; **the price each shop paid** for the same product (spread %); FIRINGI's invoices and
  credit notes of a month per shop and cost centre, with a CSV of every document (FIRINGI still
  issues one invoice per delivered order — this is the consolidated monthly view).
- **Accounting (optional)** — off until FIRINGI switches it on per company (Business Features; no row
  = off; switching off hides it and keeps the data). For customers, wholesalers and distributors;
  permissions `company.accounting.view` / `.manage` (company administrators and the accountant roles).
  - **Daily close**: cash, card, delivery apps and other sales of a day per shop (saving the day again
    replaces it).
  - **Expenses**: rent, electricity, water, gas, phone, salaries, social security, insurance, other
    suppliers, maintenance, marketing, bank fees, taxes, accountant, transport, other — with an
    optional receipt photo / PDF (private download). **Fixed monthly expenses** are added on their day
    by the `buying` job (and straight away when saved); a deleted one isn't added again.
  - **Profit & loss** for a day, a week or a month (and a 6-month trend): sales (+ for suppliers
    *sales through FIRINGI* from FIRINGI's billing statements) − purchases (**purchases on FIRINGI**
    from FIRINGI's invoices less credit notes, + other suppliers) = gross profit − expenses = net
    profit and margin; per shop or company level; **with or without VAT** (entries with a VAT rate are
    split, FIRINGI's documents exactly) and a VAT estimate (on sales − on purchases).
  - It is the company's own bookkeeping: FIRINGI staff never see the figures (only whether it is on).
- Permissions: `buyer.branches.manage`, `company.accounting.view`, `company.accounting.manage`.
  Tests: `tests/integration/multisite.test.ts`, `tests/e2e/shops.mjs`.

## Quotes, recurring orders, buyer approvals & order lists (Phase 26)

Customers and wholesalers › Orders › **Quotes**, **Recurring Orders**, **Order Lists**, **Approvals**;
suppliers › Orders › **Quote Requests** (25 languages); FIRINGI › Orders › **Quotes** and **Recurring
Orders** (English, read-only overview).

- **Quotes / RFQ** — from the cart, "Ask for a quote" sends one request per supplier (number `QR-…`)
  with a note and an optional "needed by" date; nothing is ordered. The supplier answers with a unit
  price per line (what the buyer pays, excl. VAT) and a date it is valid until (today up to 90 days
  ahead) — or declines with a reason. The supplier sees its own list price, the buyer's target, and
  **what it receives after FIRINGI's commission**; the buyer sees only the quoted prices and what it
  saves — FIRINGI's commission is never shown to buyers. The buyer accepts (address, date, notes) and
  the order goes through the normal checkout at **exactly the quoted prices** (no promotions or
  coupons on top; stock, minimums, credit and risk checks still apply) — or rejects / withdraws it.
  Quotes past their date expire (daily job). Events: `quote.requested`, `quote.answered`,
  `quote.declined`.
- **Buyer approvals** — the buyer's company sets its own rules (Approvals page, people with the new
  `buyer.orders.approve`, company administrators by default): an order total incl. VAT from an
  amount, and/or products from some categories. Orders from team members **without** that right that
  match an active rule don't go to FIRINGI: the cart moves into an approval request and a manager is
  told (`buyer_approval.pending`). Approve → the order is placed for the person who asked, at that
  moment's prices (or the accepted quote's prices); reject (a note is required) → the requester is
  told why; the requester can withdraw it and get the products back in the cart. Managers' own
  orders go straight through. Accepted quotes and recurring orders follow the same rules (a
  recurring order is approved once, when it is set up).
- **Recurring orders** — a standing order from the cart or from a list: every week / every two weeks
  on a weekday, or every month on a day (1–28). Placed automatically (06:00 UTC on the day, job
  `buying` every 15 minutes) for the person who set it up, at that day's prices, through the normal
  checkout. A reminder goes out 0–3 days before with a stock check (`recurring.reminder`); the buyer
  can skip the next one, pause, resume, order now, change products, quantities, schedule or address,
  or end it. A run that fails (out of stock, below minimum, credit …) tells the buyer the reason
  (`recurring.failed`) and the next date stays; if the person who set it up has lost access, it is
  paused. Each run is claimed once, so two schedulers can never place it twice.
- **Order lists** — saved shopping lists, shared with the team or private: from the cart, from any
  past order ("Save as list") or empty and filled by changing quantities. One click puts the whole
  list in the cart (products no longer available are skipped and counted) or makes it a recurring
  order. A shared list can be changed by anyone who orders; only its creator decides who sees it.
- Limits: orders to FIRINGI itself (routed carts), API orders and purchase orders are not held by the
  buyer's approval rules; a quote is asked from the cart (not from the product page).
- Tests: `tests/integration/buying.test.ts`, `tests/e2e/buying.mjs`.

## Warehouse operations & traceability (Phase 25)

Supplier portal › **Armazém / Warehouse** (25 languages, phone-first); customers › Orders ›
**Product Recalls**; FIRINGI › Inventory & Warehouses › **Recalls** and **Lot Traceability** (English).

- **Shelves (bins)** per warehouse: a whole range at once (aisle-rack-level → `A-01-1` … in walking
  order) or one shelf with its own code; shelf labels as PDF (QR code `FIR:L:<id>`). New lots wait in
  **Put away** until placed on a shelf; a whole lot moves with its reservations, part of a lot (free
  units only) becomes a lot of its own on the new shelf — `StockBatch.splitFromId` keeps the family
  together for traceability and for the expiry alerts of goods bought on FIRINGI.
- **Scanning** — phone camera (the browser's BarcodeDetector, or ZXing on iPhone / Firefox) and USB /
  Bluetooth scanners (they type + Enter). Reads FIRINGI labels (`FIR:B:` lot, `FIR:L:` shelf,
  `FIR:O:` order / box), product barcodes (EAN / GTIN of the packaging or variant), shelf codes, lot
  numbers and order numbers. The **Scanner** page shows what it is (lot: product, best-before, shelf,
  free units, move it, print its label; shelf: what is on it; order) and warns loudly on a recalled lot.
- **Pick & pack** — a pick list is built from the reservations the accepted orders already hold in
  one warehouse (so it follows FEFO exactly) and sorted in shelf walking order. Each line is confirmed
  by scanning the lot label or lot number (the product barcode only when the lot has no number); a
  wrong lot, wrong product, shelf label or recalled lot is refused. "Confirm by hand" is allowed and
  recorded as such. **Short pick**: the picker says how many were on the shelf; the rest of that lot
  there is counted out of stock (COUNT movement), the order is covered from other lots when there are
  any (new lines appear on the list) and otherwise FIRINGI gets a `STOCK_SHORT` exception on the
  order. **Packing** records the boxes and marks the order ready for pickup; packing slip (no prices,
  lots and best-before per line, QR) and one label per box (A6, QR `FIR:O:<number>:<box>`) as PDF.
- **Lot traceability** — where a lot came from (purchase order and outside supplier, or the order on
  FIRINGI and the seller's lot) and where it went: every order it was shipped on, and — through goods
  bought on FIRINGI put into a wholesaler's stock — on to that wholesaler's customers, level by level.
  A supplier sees its own stock and its direct buyers; buyers further down are shown to FIRINGI only
  (the supplier sees how many).
- **Recalls** (by the supplier for its own lot, `vendor.recalls.manage`, or by FIRINGI for any lot,
  `admin.recalls.manage`; class I/II/III, reason, instructions): in one transaction every batch of
  the lot at every level is **blocked** (its units leave stock with a RECALL movement; never reserved,
  picked, merged into or restocked again — recalled goods sent back are booked in and straight out),
  open orders holding it get **other lots** (what can't be covered becomes a `STOCK_SHORT` exception),
  open pick lists are corrected (picked recalled units are flagged "put aside" and never packed), and
  **every company that received it is told** (`recall.notice`, critical: e-mail, SMS, WhatsApp, push).
  Buyers acknowledge and report what they returned / destroyed (or that none is left); the recall
  page shows who was told, who acknowledged and what came back. The supplier is told when FIRINGI
  starts one, FIRINGI when a supplier does (`recall.started`). Recalled goods bought on FIRINGI get no
  more best-before alerts. Taking recalled goods back for a credit uses the normal returns flow.
- **Switched on or off by FIRINGI per supplier** (Inventory & Warehouses › **Warehouse Features**):
  pick & pack + scanning, shelves, lot traceability and the supplier's own recalls — everything is
  on until FIRINGI switches it off for that supplier (`WarehouseFeatures`, no row = all on). Switched
  off: the menu item disappears, pages show "switched off for your company" and the actions are
  refused (`FEATURE_OFF`); recorded data is kept. Inside the supplier, who may use what is its own
  team roles & permissions. Never switched off: customers' recall notices, recalls started by
  FIRINGI and blocking of recalled stock; the scanner stays while pick & pack or shelves is on.
- Permissions: `vendor.warehouse.pick` (new, in the Warehouse role), `vendor.recalls.manage` (company
  administrators), `admin.recalls.manage` (Operations). Tests: `tests/integration/warehouse.test.ts`,
  `tests/e2e/warehouse.mjs`.

## Inventory & warehouses (Phase 24)

For every supplier (wholesalers, distributors and FIRINGI's own in-house warehouse) — supplier portal
› **Inventário** (25 languages); FIRINGI › **Inventory & Warehouses** (English).

- **Batches with best-before dates** (`StockBatch`): every stock level is split into lots (lot code,
  best-before, cost, where it came from). One ledger (`src/server/inventory/ledger.ts`) is the only
  place stock changes — orders reserve / ship / restock through it — and it keeps
  Σ batches = stock level at all times (database checks + a self-repair for old direct writes).
  Expired or written-off stock is never reserved for an order.
- **FEFO** — orders take the batch that expires first (FIFO by receipt when FEFO is off).
- **Weighted average cost** per product × warehouse: each receipt moves the average; shipments
  record the cost of goods sold at that average; returns come back at the cost they left with.
  **Valuation** page: stock value per warehouse, cost of goods sold, received and written off for a
  period. Opening cost can be entered once for stock that has none.
- **Purchase orders** to the supplier's own outside suppliers (PDF in Portuguese + English, e-mailed)
  or — wholesalers — **on FIRINGI** to a distributor: sending places a normal FIRINGI order (same
  prices, risk checks and invoices; the buying price shown is the buyer's price, never the
  distributor's payout); goods can be received once it is delivered. Receipts (partial or full)
  create batches with lot, best-before and cost.
- **Reorder points** per product × warehouse → **Reorder** suggestions (usable + incoming ≤ point),
  with the last supplier and cost, turned into draft purchase orders in one click.
- **Stock counts** — full or cycle, blind by default; submitted → approved; only the difference
  counted − expected is posted (orders shipped meanwhile don't distort it); a difference over
  250 € needs a second person (or the owner).
- **Transfers** between the supplier's warehouses — the lots and dates travel with the goods; what
  doesn't arrive is recorded as lost in transit; cancelling in transit puts everything back.
- **Expiry features, switched per supplier by FIRINGI** (Inventory › Expiry Features; defaults for
  everyone else): FEFO, AI markdown
  suggestions (short-dated batches that won't sell at the usual pace → a suggested discount; the
  supplier decides and one click creates a normal promotion ending on the best-before), best-before
  shown to customers on the product page. A supplier can **ask** for a change; FIRINGI approves or
  rejects it (with a reason).
- **Movements** ledger (who, when, lot, value) and FIRINGI's **overview** (stock value per supplier,
  in-house warehouse, low, expiring and expired) and **expiring stock** across suppliers.
- **Expiry alerts for goods bought on FIRINGI** — for wholesalers (buying from distributors) and
  customers (buying from wholesalers to resell), and only for goods bought on FIRINGI: every
  delivered order records the lots it was shipped from with their best-before (`PurchasedLot`).
  Unsold = what is still in the wholesaler's own stock from it (goods bought on FIRINGI are put into
  stock with the distributor's lot and date — by the purchase order, or "Put into my stock" on a
  delivered shop order — and are never mixed with other goods), otherwise delivered − returned −
  marked sold / used by the buyer (buyer portal › Orders › **Expiring Purchases**). FIRINGI ›
  Inventory › **Expiry Alerts**: on / off for everyone and per company, the two alert days (each
  1–30 days before the best-before; a lot arriving inside the second window gets only the second),
  and the message (Notification templates › `inventory.expiring`, per language; placeholders
  `{count}`, `{days}`, `{products}`).
- Daily job `inventory` (`/api/cron/inventory`, scheduler 06:13 UTC). Permissions:
  `vendor.inventory.view|manage`, `vendor.purchasing.manage`, `admin.inventory.view|manage`.
- Tests: `tests/integration/inventory.test.ts`, `tests/e2e/inventory.mjs`.

## The redesign everywhere (Phase 23)

- **Every table is smart**: the shared `Table` now sits in a `TableShell` — as soon as a table has
  6+ rows it gets a toolbar: quick filter, show / hide columns (remembered per person, per page and
  table, on their account), compact rows, CSV of what is shown, row count. It works on the rendered
  table (rows / columns are hidden, never moved), so every page keeps its forms and buttons; small
  detail tables stay clean. Opt out with `<Table smart={false}>`.
- **Full smart tables** (sort, saved views, bulk actions) also on invoices (FIRINGI and customers)
  and CRM leads / accounts — in addition to orders, companies and products (Phase 22). Cells can
  carry links, badges and buttons (`{ t, node }`) while still sorting / filtering on their text.
- **Every page header** shows its menu section's icon and name automatically (from the
  permission-filtered menu), with the gradient title.
- **"Everywhere" check** — `tests/e2e/crawl.mjs`: signs in as FIRINGI, a wholesaler, a customer, a
  distributor and a driver, opens **every menu page** (329) on a laptop in light mode and on a phone
  in dark mode: no page errors, a title on each page, no sideways scrolling on phones.

## Futuristic redesign: glass & aurora, command palette, smart tables, live dashboards (Phase 22)

- **Design system v2** (`src/app/globals.css`, `src/components/ui/*`): an ambient aurora behind
  every page; frosted-glass cards, tables, inputs and top bar (`.glass-panel`, `--glass*` tokens
  for light and dark); a deep-night sidebar with an aurora glow, gradient active item and section
  icon chips that **folds into an icon rail** (remembered on the device); a glowing gradient page
  header (`PageHeader` with optional icon / eyebrow); a crisp sign-in page on a moving night-sky
  aurora. Every existing page picks this up; motion respects *reduce motion*.
- **Command palette** — `Ctrl K` / `⌘K`, the sidebar search or the top-bar search: jump to any page
  of the portal, find orders, companies, products and invoices (`/api/search`, only what the person
  may open in that portal), recent pages, switch light / dark. Keyboard: ↑ ↓ Enter Esc.
- **Smart tables** (`DataTable`): quick filter, filters per column (lists for status-like columns),
  sort, show / hide / reorder columns, compact rows, CSV export of what is shown, sticky header,
  phone cards, **saved views** per person (synced across devices, one opens by default) and **bulk
  actions** (suppliers: *Confirm selected*; FIRINGI: *Approve selected* products). Used by every
  order list (admin, supplier, customer — 36 screens), the supplier / customer company lists and the
  product catalogue.
- **Customisable dashboards** (admin, supplier, customer): *Customise* → drag cards (or arrows),
  change width (1–3 columns), hide / show, reset; saved to the person's account (`UserPreference`).
- **Live activity feed**: a card on each dashboard, refreshed every 8 s while the page is visible
  (`/api/live?format=json`; a Server-Sent Events stream is also available): order status changes, payments in, payouts out, invoices issued —
  with the same visibility rules as everywhere (a supplier never sees FIRINGI's holds; a customer of
  a FIRINGI-routed order sees FIRINGI).
- **CRM pipeline board**: colour-coded stage columns with totals, drag a deal to another stage
  (lost deals ask why), probability bar, owner avatar; the stage picker stays for keyboard users.
- **Shopping**: an aurora shop landing with the barcode / name search, gradient category tiles,
  glass product and supplier cards; an **order progress tracker** (placed → confirmed → shipped →
  out for delivery → delivered) on every order.
- New in 25 languages (palette, tables, dashboards, live feed). Data: `SavedView`, `UserPreference`.

## Integrations: import & sync, API v2, webhooks, accounting exports (Phase 21)

Developer guide: **[docs/integrations.md](docs/integrations.md)** (API v2 quick start, webhook
signatures, file columns, accounting layouts).

- **Import & Sync** (*Sell › Products › Import & Sync*): a supplier drops an **Excel or CSV** file
  (`;` `,` tab or `|`, decimal comma or dot, ≤ 10 MB, ≤ 5000 rows). Columns are **guessed** from
  Portuguese / English / Spanish headers (Referência, EAN, Preço, Stock, Armazém, Mínimo, Prazo…)
  and can be changed; a **preview** shows every row as new offer / update / unchanged / not in
  catalogue / error, with what changes. Rows match by the supplier's own code, or by barcode — a
  code used on several pack sizes needs the barcode. **Prices moving more than 50 %** need an
  explicit tick. Applying uses the normal services (offers, base price list, stock, pause/resume)
  and is audited; a preview applies once. *Download my template* gives the current offers ready to
  edit.
- **Scheduled feeds**: saved column mappings can point at a URL (https in production; private /
  internal addresses refused, redirects re-checked, 30 s, 10 MB). FIRINGI fetches it every 1–168 h
  and applies it — unless prices jump > 50 % or > 20 % of rows are wrong: then the run is **held**
  and the supplier is told (*integration.feed_held*). A file that can't be read is recorded and
  told once (*integration.feed_failed*).
- **API v2** (`/api/v2`, OpenAPI at `/api/v2/openapi.json`, reference in the portal): `GET /me`;
  suppliers `GET /offers`, `POST /offers/sync` (same engine as the file import, `dryRun`,
  `confirmBigChanges`), `POST /orders/{id}/confirm`, `POST /orders/{id}/status`; buyers
  `GET /catalogue`, `GET /addresses`, `POST /orders` (lines → same checks as the portal; refused
  while the key's user has a portal cart); everyone `GET /orders`, `GET /orders/{id}`,
  `GET /invoices`, `GET /invoices/{id}/pdf`. Answers list fields **per side**: buyers never see
  commission or payouts, suppliers never FIRINGI's margin. Errors `{ error: { code, message } }`;
  **120 calls/min per key** (`API_RATE_LIMIT_PER_MIN`), every call logged (90 days). The old
  `/api/v1/orders` keeps working (deprecated header) and no longer sends FIRINGI's margin to
  suppliers.
- **Self-service keys** (*Company › Integrations*, permission `company.integrations.manage`):
  scopes `catalogue.read`, `orders.read`, `orders.write`, `offers.write`, `invoices.read` (only those
  that fit the company type); a key acts as its creator and never exceeds that person's current
  permissions; shown once, stored as a hash; revoke any time; usage and latest calls shown.
- **Webhooks**: `order.created` (supplier, once it may see the order), `order.placed`,
  `order.status_changed`, `invoice.issued`, `payment.received`, `payout.sent`. Written in the same
  database transaction as the change (outbox — never sent for a change that rolled back), signed
  `X-Firingi-Signature: t=…,v1=HMAC-SHA256(secret, t.body)`, retried after 1 min → 24 h, switched
  off after 20 failures in a row (company told). Test button; delivery log.
- **Accounting export** (*Finance › Accounting Export*): sales invoices, credit notes, receipts,
  supplier invoices, payouts for a date range — as **documents** (one row each, easiest to check) or
  **balanced journal entries** (SNC defaults 211 / 221 / 711 / 312 / 2433x / 2432x / 12 / 11 / 278,
  editable, optional per-partner sub-accounts), also in **PHC, Primavera and Sage** column layouts;
  Excel or CSV (`;`, decimal comma). Preview shows totals and whether debits = credits. Import
  templates differ by version — the accountant confirms the layout before the first import; the
  legal tax file stays the SAF-T. Companies download their own documents in *Exports*.
- **Back office** (*Settings › Integrations*): keys in use, API traffic and errors, busiest keys,
  webhooks failing or off, feeds and their last result. Job `/api/cron/integrations` every 5
  minutes (feeds due, webhook deliveries, log clean-up).

## Customer payments online (Phase 20)

- **How customers pay**: MB WAY, Multibanco reference, card and SEPA direct debit — from the
  portal (*Invoices › Pay online*: tick invoices, pay together) or from a **payment link** that
  needs no sign-in (sent by FIRINGI finance, and inside every payment reminder). Bank transfer
  stays available. Pages in the customer's language (25), on phones too.
- **Provider-neutral** (`src/server/payments/`): one interface, today the **Stripe** adapter
  (Checkout for card / MB WAY / Multibanco, SEPA mandates + off-session debits, refunds, signed
  webhooks at `/api/webhooks/payments/stripe`) and a **simulated provider** (`PAYMENTS_SIMULATE=1`,
  development and demos: hosted card page, MB WAY approval, Multibanco references, mandates — no
  money). A Portuguese provider (ifthenpay, Easypay, SIBS) can be added behind the same interface.
  Keys only in the server environment: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`.
- **Automatic matching**: a confirmed payment becomes a `Payment` allocated to the invoices it was
  for (never more than what is still open). Every provider notification is stored once
  (`PaymentEvent`), so a repeated webhook can't record money twice, and a paid request can't change
  afterwards (database rule). Money left over (overpaid, invoices paid meanwhile) is **customer
  credit**, used automatically on the next invoices; finance can refund it (four-eyes above the
  threshold).
- **SEPA direct debit**: the customer signs a mandate with the provider (FIRINGI keeps only the
  last 4 digits); invoices are collected on their due date after a notice N days before
  (pre-notification); a bounced debit (e.g. AM04 insufficient funds) is reported to the customer
  and finance.
- **Reminders**: before the due date, on it and when overdue (default 3 days before, on the day, 7
  / 14 / 30 days late) — each once per invoice, daytime only, with a pay link; customers on direct
  debit aren't reminded (they're collected).
- **Pay before shipping**: per business (*Customers › Credit & Limits*, or by default for new
  customers): orders wait — unseen by the supplier — until paid, then go to the supplier; the
  prepayment pays the invoice on delivery; cancelled → refunded automatically; unpaid after N days
  → cancelled and the stock released.
- **Back office** (*Finance › Online Payments / Direct Debit*): provider status and connection
  test, payment requests (filter, copy link, cancel), new payment links, customer credit + refunds,
  the provider's notifications (applied / errors), mandates and collections. *Settings › Payment*:
  methods, reminders, link validity, direct debit notice, unpaid-order cancellation. Job
  `/api/cron/payments` every 5 minutes; System Health checks the provider and webhooks.

## Production readiness (Phase 19)

Full guide: **[docs/operations.md](docs/operations.md)** (deploy, update, settings, monitoring,
backups & restore, incidents, security, capacity).

- **Portable deploy**: `Dockerfile` (app on the slim Node image, non-root, health check; `tools`
  for migrations / first admin; `ops` for backups) and `docker-compose.prod.yml` — PostgreSQL 16 +
  PostGIS, one-shot migrations, app, scheduler, backups, optional Caddy for automatic HTTPS.
  Runs on any Docker host; nothing is tied to a cloud. Tested here: fresh database → migrations →
  first super admin (`prisma/seed/bootstrap.ts`) → sign-in → jobs running.
- **Files** on local disk or any S3-compatible storage (`STORAGE_DRIVER=s3`; AWS, Hetzner, Scaleway,
  R2, MinIO, SeaweedFS…).
- **Settings check**: with `FIRINGI_ENV=production` the app refuses to start (exit 1, says what to
  fix) when a secret is missing or weak, the address isn't https, or a chosen driver lacks its keys.
- **Scheduled jobs** (`scripts/ops/scheduler.mjs`): messages, certified invoicing, allocation, AI,
  health checks — every run recorded (`JobRun`).
- **Backups**: nightly `pg_dump`, encrypted (AES-256), checksum, kept 30 days, off-site copy to S3,
  **monthly automatic restore test**; `restore.sh` from a file or from S3 (`scripts/ops/`).
- **Monitoring**: `/api/health` for uptime monitors; *Settings › System Health* (checks, jobs,
  alerts, grouped server + browser errors, version, *Run checks now*); public **`/status`** page
  (25 languages). **Built-in alerts** to super admins for failing / late jobs and backups, queues,
  error spikes, disk, database size, settings — re-sent every 6 h, and a "resolved" message.
  **Sentry** optional (`SENTRY_DSN`).
- **Security**: Content Security Policy, HSTS behind HTTPS, `Permissions-Policy`, no framing,
  `__Secure-` HttpOnly cookies, `no-store` API answers, non-root container.
- **Performance**: 37 indexes for unindexed foreign keys; paged order and invoice lists; load test
  script (`scripts/load-test.mjs`) and results in the guide (one instance: ~34 customer page
  views/s, p95 1.5 s, 0 errors).
- **Phones**: every page fits a phone screen (all pages checked), tables turn into stacked cards,
  the top bar folds language / theme / sign-out into a menu; light and dark mode follow the device.

## Look & feel: colour and motion

- **Vivid, glossy design**: a decorative palette (`--vivid-*` in `globals.css`: blue, violet, pink,
  orange, teal, lime) for gradient page titles, coloured section titles and table headers, glossy
  KPI tiles with gradient icon chips, frosted-glass panels on a coloured hero band and glossy
  primary buttons — in light and dark mode. Charts keep the validated colour-blind-safe series
  colours; body text stays dark on light for readability.
- **Motion graphics** (`src/components/motion`): numbers count up (and flash when they change),
  cards rise in one after the other, charts draw themselves and bars grow, the hero colours drift,
  the latest orders scroll by on a ribbon (pauses on hover), progress rings fill, and the live map
  shows each route with travelled / still-to-go lines flowing and a vehicle moving along it.
- **Dashboards**: FIRINGI's executive overview (orders today, month sales, awaiting confirmation,
  exceptions, 14-day sales trend, latest orders, deliveries today, live route map, network), Live
  Operations (map), the supplier dashboard (orders to confirm, payout vs previous 30 days,
  deliveries, top products, routes) and the customer dashboard (orders in progress, on the way
  with expected time, spending, open / overdue invoices, most bought); the driver's route card
  gets a progress ring and a mini map. Dashboards refresh every minute.
- Everything respects the device's **reduce motion** setting (values shown at once, no ribbon or
  moving vehicles) and fits a phone screen.

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
- **Invoicing** goes through Moloni (Phase 18) once connected; until then FIRINGI's internal numbering is used.
