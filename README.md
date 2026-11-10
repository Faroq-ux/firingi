# FIRINGI — Core Module

B2B marketplace + ERP. FIRINGI is the merchant of record in every sale:
**Customer → FIRINGI → Wholesaler** and **Wholesaler → FIRINGI → Distributor**.

**Stack:** Next.js 15 (App Router) · TypeScript · Tailwind CSS 4 · shadcn/ui-style components ·
PostgreSQL 16 · Prisma 6 · better-auth (email + password) · next-intl · Vitest · Playwright.

---

## Quick start

Requirements: Node 22+, pnpm 10+, and PostgreSQL 16 **with PostGIS 3** (local: `apt-get install postgresql-16-postgis-3`, or `docker compose up -d`). The migrations install PostGIS into its own `postgis` schema.

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
- **Invoicing** (Phase 5) goes through a certified-provider adapter; the provider is still to be chosen.
