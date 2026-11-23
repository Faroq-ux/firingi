# Pre-orders & Price Locks (Phase 71)

Distributors and wholesalers offer **pre-orders** (order ahead before the goods are there) and **price locks** (keep
today's price for a quantity taken over coming months). Who may buy follows the usual flow: distributors sell to
wholesalers, wholesalers sell to customers. FIRINGI switches everything on or off and invoices the buyer as always;
commission stays hidden from buyers.

## Pre-order campaigns

1. **The supplier drafts** (`/vendor/orders/preorders/new`, 25 languages): kind (seasonal, new product, short supply),
   title, order window (opens / closes), delivery dates (up to FIRINGI's maximum), how short supply is shared
   (in proportion, first come, regular customers first), an optional deposit (%, up to FIRINGI's maximum) and the
   products: price per pack, up to 3 **tier prices** ("from 200 packs pre-ordered by everyone: €9.00"), minimum and
   maximum per buyer, packs available (empty = no limit).
2. **FIRINGI approves** (`/admin/orders/preorders/<id>`) — or, with approval "AUTO", it opens at once. Buyers who
   bought those products in the last year are told when it opens (`preorder.campaign_open`).
3. **Buyers pre-order** (`/buy/orders/preorders`): today's price per pack (the tier reached so far), how many more packs
   bring the next tier, a delivery date and address; they can change or cancel until it closes. Pre-orders for products
   they bought around this time last year are marked **For you**. A deposit is paid online (the usual pay page); it is
   kept as credit and used on the invoices. Unpaid by the close → the pre-order lapses.
4. **The close** (job, or the supplier's **Close now**): the final tier price is set on what is shared out; if more was
   asked than there is, it is shared by the campaign's rule (pro rata hands the remaining packs to the largest
   remainders, then the earliest). Buyers given everything are confirmed; buyers given less **accept or decline**
   (confirmed automatically after FIRINGI's days); buyers given nothing are told.
5. **Orders** are placed for each delivery date FIRINGI's days before it (or the supplier's **Place orders now**): a
   normal order at the final price, placed for the buyer, delivered and invoiced as usual. The supplier's delivery
   minimum doesn't apply (the supplier agreed the quantities). If an order can't be placed, buyer and supplier are told
   why.
6. The supplier sees the demand per product and the **plan per delivery date**; a supplier or FIRINGI may cancel a
   campaign (buyers told; deposits stay as credit).

## Price locks

- The buyer asks to lock today's price for a quantity over 1–N months (suggestions: products it buys most, with the
  packs it buys a month).
- The supplier accepts (optionally at another price, with a deposit) or declines. Above FIRINGI's value, FIRINGI
  approves too.
- Each **call-off** is a normal order at the locked price (the delivery minimum applies). The buyer sees packs left,
  until when, how many a month to use it all and what it saved; a reminder comes FIRINGI's days before the end; what is
  not called off lapses at the end.
- The supplier sees requests and the packs still committed per product (for planning).

## AI

- Customer Assistant tool `my_preorders`: open pre-orders (suggested first, tier prices), its pre-orders and locks, and
  products worth locking.
- Supplier Assistant tool `preorder_demand`: campaigns with packs per product and delivery date, lock requests, packs
  committed.

## FIRINGI (`/admin/orders/preorders`, English; Orders › Pre-orders & Price Locks)

- **Pre-orders:** everything to review and running, value pre-ordered; detail with approve / reject / cancel.
- **Price locks:** all locks; approve the big ones; cancel.
- **Settings:** on / off; **who may offer them (distributors, wholesalers)**; parts (campaigns, price locks, deposits,
  AI); kinds; approval; longest window, delivery dates, highest deposit, longest lock, lock value FIRINGI approves,
  days before delivery to order, days to accept a smaller quantity, reminder days; countries left out; **single
  companies** switched on or off (sellers or buyers). **Run now** runs the job.

## Job

`preorders` (hourly, `/api/cron/preorders`): announce opened campaigns, close and share out, confirm unanswered
allocations, place orders before delivery, finish campaigns; price-lock reminders and expiry.

## Notifications

`preorder.review`, `preorder.reviewed`, `preorder.campaign_open`, `preorder.allocated`, `preorder.ordered`,
`preorder.failed`, `preorder.cancelled`, `pricelock.requested`, `pricelock.review`, `pricelock.decided`,
`pricelock.ending`, `pricelock.expired` — texts in 25 languages.

## Tests

- `tests/unit/preorders.test.ts` — tiers, next tier, allocation (pro rata / first come / loyal first), deposits, dates,
  lock sums, flow, switches.
- `tests/integration/preorders.test.ts` — approval, three buyers over supply shared at the tier price, accept / decline
  / automatic, orders at the final price, unpaid deposit lapses, cancel, price lock accept / call-off / reminder / end,
  FIRINGI approval of big locks, switches, AI.
- `tests/e2e/preorders.mjs` — the whole flow in the browser (supplier, FIRINGI, customer), switches, phone / dark.
