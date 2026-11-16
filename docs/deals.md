# Clearance deals (Phase 38)

Suppliers put short-dated or surplus stock on time-limited deals; FIRINGI decides which kinds exist and which deals
need its approval; buyers see the deals, buy at the deal price and hear about new ones.
Code: `src/lib/deals.ts` (kinds, default settings, pricing maths — pure), `src/server/deals/service.ts`,
`src/server/actions/deals.ts`, pages `src/app/vendor/products/deals`, `src/app/buy/catalogue/clearance`,
`src/app/admin/pricing/deals` (+ `/settings`), components `src/components/deals/*`. Schema `prisma/schema/deals.prisma`.

## Kinds

| Kind | Terms | Unit price in the cart |
| --- | --- | --- |
| `FLASH` | deal price | the deal price, any quantity |
| `BUNDLE` (multi-buy) | units per pack + pack price | full packs at the pack price, the rest at the list price, averaged over the line |
| `VOLUME` | 1–6 tiers (from qty → unit price; each tier larger and cheaper) | the tier the quantity reaches; below the first tier the list price |
| `LOT` (whole lot) | units + lot price | only when exactly the whole lot is bought |
| `BEST_OFFER` | optional floor price, optional minimum quantity | the price agreed on the buyer's accepted offer (or the counter-offer the buyer took), for exactly that quantity |

FIRINGI switches each kind on or off (*Pricing › Clearance Deals › Settings*). A deal must be at least
`minDiscountPct` (default 5 %) below the list price (the product's BASE price list) — best offers excepted — and
last at most `maxDurationDays` (30). One live or waiting deal per product at a time. `maxQty` caps the units on the
deal, `perBuyerMax` the units per buyer (orders that weren't cancelled or returned count).

## Approval — the admin chooses

`approval.mode`:
- `ALWAYS` — every deal waits (`PENDING`) for FIRINGI.
- `AUTO` (default) — a deal starts by itself (`APPROVED`, `autoApproved`) when its discount ≤ `maxDiscountPct` (50 %)
  and it lasts ≤ `maxDays` (14) — best offers regardless of discount — and, if `trustedOnly`, the supplier is marked
  trusted (company feature `DEALS_TRUSTED`, a switch on the admin list). Everything else waits.

FIRINGI is told about waiting deals (`deal.review`); it approves (optionally setting this deal's commission %) or
turns it down with a reason the supplier sees (`deal.approved` / `deal.rejected`). Approved deals go live at their
start time. FIRINGI or the supplier can end a deal early: a live deal becomes `ENDED` from that moment (its sales
stay counted), one that hasn't started becomes `CANCELLED`. `SOLD_OUT` when the units are gone; `ENDED` by the hourly job.

## Commission — lower on clearance

A deal is a **clearance** deal when the chosen lot (or the product's soonest lot with stock) expires within
`clearance.expiryDays` (21) — `EXPIRY` — or, if `clearance.overstock`, when available stock is more than 60 days of
the last 90 days' sales (or nothing sold) — `OVERSTOCK`. Then FIRINGI's commission on that deal is
`min(supplier's usual rate, clearance.commissionPct)` (default 4 %). On other deals the usual rate applies. Either way
the commission is taken **on the deal price** (`commissionUnitBase` in `orders/calc.ts`), and FIRINGI can override it
per deal when approving. The supplier funds the discount (`vendorFundedDiscount` = list − deal price). Buyers never see
commission; suppliers see the rate on the form and on their deal list.

## Cart, checkout and orders

`priceCheckout` (`orders/pricing.ts`) asks `dealPricing` for each line. A hit replaces the unit price (net and gross),
drops promotions on that line and keeps the line out of order-level promotions and coupons. A miss gives a reason the
cart shows (`LEFT`, `PER_BUYER`, `BID_QTY`, `QTY_TIER`, `LOT_QTY`, `BUNDLE_QTY`, `BID`) and the line keeps its usual
price. `placeOrder` stores `dealId`, `dealBidId` and the deal's commission rate on the order line; `afterDealOrder`
marks the offer `ORDERED` and the deal `SOLD_OUT` when nothing is left.

Not covered: lines re-priced later by the allocation engine (Phase 9) are moved at their normal price, not the deal
price; multi-buy is per product (no mixed-product bundles).

## Best offer

`placeBid`: quantity ≥ the minimum, ≤ units left, price below the buyer's current price; one open offer per buyer and
deal. At or above the floor → `ACCEPTED` at once; otherwise `PENDING` and the supplier is told (`deal.bid`). The
supplier accepts, turns down or counters within `bestOffer.answerHours` (24) — unanswered offers expire. An accepted
price (or a counter-offer the buyer takes) holds for `bestOffer.holdHours` (48). The buyer is told each time
(`deal.bid_accepted` / `_rejected` / `_countered`).

## Telling buyers

- **Deals page + badges** — `/buy/catalogue/clearance` (filters by kind, search, countdown, units left, best-before),
  a badge on product cards (shop, search, categories, supplier store) and a panel on the product page.
- **Watchlist** — watch a product or a supplier.
- **Smart alerts** — buyers who ordered the product in the last `alerts.lookbackDays` (180).
  People who switched “Offers & news” (marketing) off get no smart alerts; watchlists are their own choice.
  At most `alerts.maxPerDay` (3) deal alerts per person per day; never the same deal twice (`ClearanceAlert`).
- **Daily digest** — opt-in per person, one message with the day's new deals.

Hourly job `/api/cron/deals` (`runDealsJob`, `Authorization: Bearer $CRON_SECRET`): ends finished deals, expires
offers, sends alerts for deals that started, sends the digest once a day.

## Tests

`tests/integration/deals.test.ts` (kinds on/off, limits, auto-approval, clearance commission, cart pricing for every
kind, per-buyer and quantity caps, no stacking with promotions, sold out, best offer + counter, watchlist and smart
alerts, the job) and the browser test `tests/e2e/deals.mjs` (settings, supplier creates deals in Portuguese, FIRINGI
approves one, buyer page + badges + cart + offer/counter + order, watchlist, digest, phone + dark).
