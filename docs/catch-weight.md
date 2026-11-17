# Sold by weight — catch-weight (Phase 41)

Meat, fish, cheese and other products priced per kg, where the real weight is only known once the supplier weighs
the goods.

## How a product is sold

| Way | Example | The customer orders | One unit |
|---|---|---|---|
| **By the piece, priced per kg** (`PIECE`) | a whole salmon, a 2 kg mozzarella block | pieces / packs | ≈ the average weight (e.g. 2 kg), optional lightest–heaviest range |
| **By the kilo** (`KG`) | minced meat, sliced ham | kilos (whole units of e.g. 1 kg) | the unit weight, usually 1 kg |

The supplier sets this per product in *Products › Sold by Weight* (`VendorOffer.cwMode`, `cwNominalKg`, `cwMinKg`,
`cwMaxKg`, `cwMaxOverPct`, `cwPlu`). Prices stay **per unit** (the estimate = price per kg × the unit's weight), so the
catalogue, price lists, promotions, deals, cart and checkout work unchanged. The price per kg shown everywhere is the
unit price ÷ the unit's weight. When the supplier changes the weight of a product that is already sold by weight, all
its prices are scaled so the price per kg stays the same.

## Where it is stored

- `VendorOffer.cw*` — the product's settings.
- `OrderLine.cw*` — copied at checkout: way, unit weight, the over-weight limit that applies (FIRINGI's for the
  customer's country, or the supplier's tighter one), then the weighed kg (`cwActualKg`), the billed kg
  (`cwBilledKg`) and whether the customer accepted weight above the limit (`cwOverAccepted`).
- `CatchWeighing` — every weighing (kg per piece, total, source `PICK` / `SCAN` / `SUPPLIER` / `DRIVER`, scanned code,
  who, when). The newest is the line's weight; the rest is the history.
- `Order.prepayBuffer` — the extra paid up front by pay-before-shipping customers.
- `Setting catchweight.settings` — FIRINGI's rules (below).

## Billing

- **Billed weight** = the weighed weight, but at most *ordered units × unit weight × (1 + limit %)* unless the customer
  accepted more. Lighter than ordered: the customer pays the real weight. Not weighed: the estimate.
- Every weighing re-prices the order (`repriceOrder`): the line counts as *billed kg ÷ unit weight* units, and every
  per-unit amount follows — list price, the supplier's and FIRINGI's discounts, commission, what FIRINGI pays the
  supplier — then the order totals, coupons and loyalty redemptions. Delivery (`DELIVERED`) re-prices once more with the
  delivered units, then invoices.
- **Invoice**: the line keeps its units; the unit price is the billed weight's share and the description reads
  `… · 10,400 kg × 6,7500 €/kg`. The discount column takes the rounding, so *qty × price − discount* is exactly the line
  (as Moloni recomputes it). Credit notes, returns and claims keep working per unit.
- **Supplier statement**: the same line with the weight; the supplier is paid on the billed weight.
- **Pay before shipping**: the customer pays the order total + *buffer %* of the sold-by-weight lines' gross. The
  invoice on delivery is paid from that payment; what isn't used stays as the customer's credit (it pays their next
  invoices, or FIRINGI refunds it from *Customer credit*).

## Weighing

1. **Picking** (Phase 25 pick & pack) — scanning a scale label on a pick line counts the piece *and* records its
   weight; the pick list page also shows the weighing form for each order.
2. **Order page** — the supplier (or FIRINGI staff) types the weight of each piece, or the total for kilos, and can scan
   scale labels there too.
3. **Scale labels** — EAN-13 variable-measure codes (prefix `28`/`29`, then the item code — the product's *scale item
   code*, or the digits of its SKU — then the weight in grams) and GS1-128 / DataMatrix codes with AI `310n` (net weight
   in kg, *n* decimals; with AI `01` the GTIN must be the product's). Prefixes, digits and grams per step are set by
   FIRINGI.
4. **Driver** — on the proof-of-delivery form (online and in the offline app) the driver can type a new total weight per
   line (when FIRINGI allows it) and tick *the customer accepts the weight above the limit*.

## The over-weight limit

FIRINGI sets it per country (*Settings › Sold by Weight*, default 10 %); a supplier can only set a tighter one per
product. When a weighing goes above the limit, the customer is notified (`catchweight.over_limit`) and can **accept the
extra weight** on the order page (the supplier is told, `catchweight.over_accepted`); otherwise they pay the limit.

## FIRINGI settings

Sold by weight on/off · over-weight limit (everywhere + per country) · pay-before-shipping buffer % · drivers may change
weights · **weigh before dispatch** (an order with unweighed lines can't be picked up / dispatched) · scale-label
format.

## Pages

- Supplier (25 languages): *Products › Sold by Weight* (per product: way, weights, own limit, scale item code, price per
  kg), *Orders › Weighing* (to weigh, weights vs ordered per product, last 90 days), weighing on the order page and the
  pick list.
- Customer (25 languages): price per kg and piece weight on the product page, a badge on product cards, "≈ 10 kg · final
  price by weight" in the cart, the order page card (estimate → weighed → billed, accept the extra weight), the
  advance-payment buffer.
- Driver: weights at the stop (online and offline).
- FIRINGI (English): *Orders › Sold by Weight* (per supplier: weighed share, real vs ordered, capped lines; open orders),
  *Settings › Sold by Weight*.

## Tests

`tests/unit/catch-weight.test.ts` (settings, tolerance, billed weight, typed weights, EAN-13 / GS1 labels),
`tests/integration/catch-weight.test.ts` (product setup and price scaling, billing on weight with invoice + statement +
credit note, over the limit: capped / accepted by the customer / accepted at the stop / corrected by the driver,
estimate when not weighed, scale labels incl. the picking path, weigh-before-dispatch, pay-before-shipping buffer,
reports and the driver's stop) and `tests/e2e/catch-weight.mjs` (browser, Portuguese + English, phone and dark mode).

## Limits

- Stock is still counted in units (pieces / kilos as ordered), not in kg.
- The weight on the invoice is the billed weight; for a capped line the real weight is in the weighing history.
- Check with your accountant that per-unit invoice lines with the weight in the text suit each country.
