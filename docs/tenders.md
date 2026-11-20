# Open tenders (Phase 50)

A buyer posts what it needs; suppliers send sealed bids per line; the buyer awards each line; each supplier's awarded
lines become one order. FIRINGI invoices the buyer as usual; FIRINGI's commission comes off the supplier's side.

## Rules (src/lib/tenders.ts — unit-tested)

`TenderSettings` (`Setting` key `tenders.settings`): `enabled`, `buyers{CUSTOMER, WHOLESALER}`,
`suppliers{WHOLESALER, DISTRIBUTOR}`, `approval` AUTO / ALWAYS, `invitations`, `targetPrices`, `payLater`, `maxLines`,
`minHours`, `maxDays`, `awardDays`. `SUPPLIER_TYPE` (customers → wholesalers, wholesalers → distributors),
`rankBids()` (cheapest first, ties by arrival, saving against the target), `cheapestAward()`, `groupAward()`.

## Data (prisma/schema/tenders.prisma)

`Tender` (number TD-…, buyer, country, title, note, address, delivery day, closing time, status PENDING / OPEN /
CLOSED / AWARDED / CANCELLED / REJECTED, invited suppliers), `TenderLine` (product or description, qty, unit, target,
the awarded bid line, the order), `TenderBid` (one per supplier: SUBMITTED / WITHDRAWN / WON / LOST),
`TenderBidLine` (the supplier's offer and the selling price per unit). Per-business switch: `CompanyFeature` `TENDERS`.

## Flow (src/server/tenders/service.ts)

- **Post** — `createTender()`: checks (lines, quantities, catalogue products, closing between `minHours` and
  `maxDays`, delivery not before the close, own address, invitations only to eligible suppliers); OPEN (suppliers told,
  `tender.opened`) or PENDING for FIRINGI (`tender.review` → `reviewTender()` → `tender.decided`).
- **Bid** — `supplierTender()` shows the lines (never other bids), the supplier's matching offers (for a product line
  only its offers of that product), its list price and what it receives after its commission; `submitBid()` replaces
  the supplier's bid while bidding is open (`tender.bid` on a new bid); `withdrawBid()`.
- **Award** — `buyerTender()` ranks the bids per line; `award(picks, {payLaterTermId})` places one order per supplier
  with `placeOrder({items, fixedPrices, approved: true, payLater})`, links lines to orders, marks bids WON / LOST
  (`tender.awarded`, `tender.lost`). A supplier whose order can't be placed (e.g. stock) is reported; the others go
  through.
- **Job** (`runTendersJob`, `/api/cron/tenders`): OPEN past its closing time → CLOSED (`tender.closed`); CLOSED and not
  awarded within `awardDays` → CANCELLED.

## Pages

Buyers: *Orders › Tenders* (list, new tender, a tender with ranked bids and the award). Suppliers: *Orders › Tenders*
(open tenders, my bids, the bid form). FIRINGI (English): *Orders › Tenders* (overview, waiting for approval, all),
a tender, *Settings* (every switch + each business).
