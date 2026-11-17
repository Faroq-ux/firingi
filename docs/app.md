# Installable phone app & offline mode (Phase 39)

FIRINGI installs on phones and computers like an app (a Progressive Web App — no app store), for every portal:
buyers, suppliers, drivers and FIRINGI staff. When the signal goes, the supply chain keeps moving: buyers order,
drivers deliver and suppliers pick on the phone; everything is sent — once — when the signal returns.

Code: `src/lib/app.ts` (settings, the pure offline-order check), `src/server/app/{service,scan,metadata}.ts`,
`src/app/api/app/{snapshot,sync,event}`, `src/app/manifest/[portal]`, `public/sw.js`, `src/lib/offline/store.ts`
(the phone's storage + outbox), `src/components/app/*` (runtime, bottom bar, offline app, scan to reorder, admin),
pages `/offline`, `/buy/orders/scan`, `/admin/settings/app`. Schema `prisma/schema/app.prisma`.

## Installing

- **Manifest per portal** — `/manifest/<buy|vendor|driver|admin>?l=<language>`: name, icons (any + maskable, drawn by
  `scripts/app-icons.mjs`), colours, start page, and **long-press shortcuts** in the person's language (buyer: Scan to
  reorder, Cart, Buy again, My orders; supplier: Incoming orders, Pick & pack, Scanner, Stock; driver: Today's deliveries,
  History, Offline mode; FIRINGI: Dashboard, Orders, Exceptions). Each portal layout links its manifest; iPhone gets the
  Apple web-app tags and icon.
- **Install card** — Android / desktop Chrome: the browser's install prompt behind an “Install FIRINGI” card; iPhone
  Safari: the Share → Add to Home Screen steps. “Not now” is remembered for 30 days. FIRINGI can switch the card off.
- **App badge** — the unread notifications number on the app icon (set by the open app, and by push messages, which
  now carry the unread count).
- **Bottom bar** — on phones and tablets: 3–5 main pages of each role (from the person's menu, so permissions and
  translations follow) + “Menu” for the full drawer; the cart shows its count.
- FIRINGI sees installs per portal and how many were opened from the home screen this week.

## Offline

**What the phone keeps** (`GET /api/app/snapshot?portal=…`, refreshed on opening and every 15 minutes while online):

| Portal | Kept |
| --- | --- |
| Buyers | the products they usually buy (last 180 days, then order lists; a new buyer gets popular products they can buy) with **their own prices**, minimum / step, stock and barcodes; delivery addresses; last orders with status; last invoices and a few invoice **PDFs** |
| Drivers | today's open deliveries in route order: customer, address, phone, items, notes; failure reasons |
| Suppliers | open pick lists with shelf, lot, best-before, barcode, quantities; last incoming orders |

Nothing secret is kept: no commission, margin or supplier payouts. Saved data is removed on sign-out and when someone
else signs in on the phone.

**Offline mode** (`/offline`): the service worker keeps this page (and the files it needs) and opens it whenever a
page can't load. Other pages are never kept on the phone. The saved page carries the person's language.
- *Buyers*: search or **scan** the saved products, set quantities (minimum and steps respected), choose the address,
  place the order — it waits in the outbox. Orders and invoices (saved PDFs open offline) can be read.
- *Drivers*: picked up → on the way → **delivered** (name + signature on the screen and/or a photo, location if
  allowed) or **not delivered** (reason, note, photo).
- *Suppliers*: pick with the scanner (camera, USB/Bluetooth scanner or typed): the phone checks the scan against the
  line (barcode, lot number, FIRINGI lot label) and refuses a wrong one; “All picked”, or “Fewer on the shelf”.
- *Everyone*: the **outbox** — waiting, sent, to check, not done; “Send now”, “Try again”, “Remove”.

**Sending** (`POST /api/app/sync`): actions are sent in the order they were done, each with an id made on the phone;
the server keeps one result per id (`OfflineOp`), so an action sent twice is carried out once. The real checks run
again on the server (delivery steps, proof of delivery, scan-verified picking, ordering rules, approvals, budgets).
Actions are sent by the person who did them only — another person signing in on the phone never sends them.

**Prices and stock changed meanwhile — the admin chooses** (`/admin/settings/app`):
- *Always ask the buyer* (default): any price change sends the order back to the buyer, who sees “was → now (%)” and
  orders with the changes or removes it.
- *Place it by itself within a limit*: price moves up to N % (up or down) are accepted; more is asked.
- Products no longer sold to the buyer, without a price, out of stock or with a changed minimum always come back to the
  buyer; ordering “with these changes” orders the rest.

## Scan to reorder

`/buy/orders/scan` (menu, bottom bar, shortcut): the camera or a scanner reads a product's barcode on the shelf; the
offer this buyer bought before is added to the cart with the usual quantity (the last ordered, at least the minimum).
If several suppliers sell it and the buyer never bought it, the buyer chooses. Offline, scanning finds the saved product.

## FIRINGI (English)

*Settings › Phone App*: portals that can install / work offline, the install card, the price-change rule, how much each
phone keeps, refresh time; installs per portal; offline actions of the last 30 days (done / to confirm / failed) and the
ones that needed attention.

## Notes

- Background Sync (Chrome / Android) wakes an open FIRINGI page to send the outbox; otherwise the outbox is sent the next
  time FIRINGI is opened with signal (iPhone has no background sync).
- The camera needs HTTPS (or localhost) and the person's permission.
- Tests: `tests/integration/app.test.ts`, browser `tests/e2e/app.mjs` (real offline in Chromium; setup via
  `tests/e2e/setup/app-setup.ts`).
- The offline data follows the same reach as the normal pages: branch staff get only their branches' orders, and
  invoices only with the invoice permission. Invoice PDFs are saved to the phone by the page (not routed through the
  service worker) and opened from that copy when there is no signal.
- Shared e2e database: run `tests/e2e/setup/restock.ts` before a browser suite. It tops up stock that test orders
  hold or have shipped (seed stock is left alone) and frees a delivery the app test left open if it stopped half-way.
