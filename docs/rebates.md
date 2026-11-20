# Rebates & bonuses (Phase 48)

Supplier trade deals that reward customers for what they buy over a period, paid by FIRINGI credit note.

## Kinds (src/lib/rebates.ts — pure, unit-tested)

| Kind | Rules | Earned |
|---|---|---|
| `VOLUME` | `basis` AMOUNT / UNITS, `tiers[{from, pct}]`, `retro` | retro: reached % × amount of the period; otherwise each % on the part between its target and the next |
| `FREE_GOODS` | `buyUnits`, `freeUnits`, `maxFreePerPeriod` | ⌊units ÷ buyUnits⌋ × freeUnits (capped) units of `rewardOfferId` |
| `GROWTH` | `tiers[{growthPct, pct}]`, `base` INCREASE / TOTAL, `minPrevious` | % on the increase (or the total) when the period beats the same period a year before |
| `MIX` | `minDistinct`, `minUnitsEach`, `rewardFixed`, `rewardPct` | fixed amount + % of the amount once enough different products were bought |

`evaluate()` also returns the progress (0–100) and what is missing for the next step (customer progress bars,
"you're close" reminders, the supplier's live table). `cleanRules()` validates; `limitProblem()` applies FIRINGI's
highest % / fixed bonus.

## Periods

Calendar periods in UTC (`2026-M11`, `2026-Q4`, `2026-H2`, `2026`). A deal may start at the beginning of the running
period at the earliest. A deal starting or ending inside a period only counts its own days. Ending a running deal
sets its end to the end of the current period, so customers keep what they are building.

## Purchases

`purchaseRows()` — FIRINGI's invoices to the customer for the supplier's goods (joined order line → order seller),
minus credit notes, issued in the period, excluding excise lines and money-only credit notes (loyalty, bonuses), by
customer, shop (order branch) and product. Scope: offers OR categories (with sub-categories) OR brands; none = all.

## Who

Audience ALL / SEGMENT (CRM segment) / GROUP (the supplier's or FIRINGI's customer group) / COMPANIES, optionally
limited to buyer countries; buyer types allowed by FIRINGI (customers, wholesalers). `perShop` counts each shop alone.

## Approval

Supplier: draft → send → PENDING → FIRINGI approves / turns down (reason required) → APPROVED. With approval AUTO
deals within the limits start at once. FIRINGI-funded deals (FIRINGI › *New FIRINGI-funded deal*) start at once.
Per supplier: `CompanyFeature` key `REBATES` (absent = by type; enabled true = always on; false = off).

## Settlement (daily job `rebates`)

For every approved deal and every period that ended `settleDelayDays` ago:
* one `TradeBonusSettlement` per customer (/ shop) and period — unique key, so it is idempotent; FAILED rows are retried;
* money: spread over the period's invoices in proportion to their still-creditable goods; for each invoice
  `rebateCreditNote(..., lineIds)` issues a credit note with lines `Rappel / bónus comercial` split by the VAT
  rates of those goods; never more than can still be credited (the cap is noted on the row);
* supplier-funded: a credit `VendorBillingStatement` per credit note (net, VAT as on the original statement regime)
  + self-billing where agreed → it comes off the supplier's next payout;
* free goods: a `TradeBonusFreeGoods` allowance (expires after `freeGoodsDays`);
* a marker row (companyId "") closes the period; deals past their end with every period closed become ENDED.

Settings changes never take earned money away: switching the feature off stops new deals and hides running ones,
but periods already running are still settled.

## Free goods at checkout

`priceCheckout` looks up the buyer's open allowances for the cart's products (oldest expiry first) and gives those
units 100 % off through the system promotion `trade-bonus-goods` (supplier- or FIRINGI-funded, per deal). Supplier
paid: no commission on those units. They don't count toward the delivery minimum. `placeOrder` uses them up
(refused if they changed meanwhile); a cancelled order gives them back (7 more days if they had expired).

## Notifications

`rebate.review` (FIRINGI), `rebate.approved` / `rebate.rejected` / `rebate.settled` (supplier), `rebate.available`,
`rebate.close`, `rebate.earned`, `rebate.free_goods` (customer) — 25 languages.

## Pages

* Supplier: *Products › Rebates & Bonuses* (list, new, deal page with this period per customer and settled periods).
* Customer: *Rewards › My Bonuses* (progress, free goods to take, what was earned with the credit notes); the cart
  marks free units.
* FIRINGI (English): *Pricing › Rebates & Bonuses* (overview, approvals, all deals, retry), *Settings* (every switch
  and each supplier), deal page.
