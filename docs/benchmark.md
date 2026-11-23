# Price Benchmark (Phase 70)

Customers and wholesalers see how the prices they pay compare with what similar businesses pay for the same products,
what they could save, and cheaper offers on FIRINGI. Suppliers see where their prices sit. Everything is anonymous.

## How it is worked out

- **Purchases:** FIRINGI orders of the last *period* (90 days by default), not cancelled or returned; catch-weight lines
  are left out. Prices are **per base unit** (pack price ÷ units in the pack) so different pack sizes compare.
- **One buyer, one value:** each buyer's quantity-weighted average price per product, so one big buyer can't move the
  market.
- **Groups:** same country, then the most specific group that has enough buyers: same region *and* kind of business →
  same region → same kind of business → the whole country. The region comes from the buyer's first delivery address.
- **Anonymity:** a group is kept only with at least *minimum buyers* different buyers (5 by default, 3–50). Pages show
  percentiles (10, 25, 50, 75, 90) and a count — never another buyer's name or price, never a supplier's price paid.
- **Position:** the share of similar buyers paying less (0–100). **Above / around / below**: more than 3 % from the
  median. **Yearly saving:** (my price − median) × my quantity, scaled to a year.
- **Trend:** the 6 products with most spend, month by month, my price against the market median; a warning when my
  price rose more than *rise warning* points faster than the market's.
- **Rebuild:** the `benchmark` job (hourly, rebuilds when older than *refresh hours*, 24 by default) writes the
  `PriceBenchmark` table in one transaction; FIRINGI can **Rebuild now**.

## Customer page (`/buy/reports/price-benchmark`, 25 languages; Reports › Price Benchmark)

Tiles (yearly saving, products compared, above, below); **Where you can save** — products above the market with the
range bar, position, group level and **cheaper offers** (same product, same country, at least 2 % cheaper, other
suppliers) with a quantity and **Add to cart**; **Basket check** (what the period cost against the market median);
**Price trend**; **All products**. Permissions: `buyer.reports.view`, `buyer.orders.view` or `buyer.orders.place`
(adding to the cart needs `buyer.orders.place`).

## Supplier page (`/vendor/reports/price-position`, 25 languages)

Each of the supplier's products against what buyers in its country pay (median, range, position, number of buyers);
other suppliers are never named.

## AI

- Assistant tool **`price_check`** (customers): "am I paying too much for rice?" — position, median, saving, cheaper
  offers.
- AI Centre suggestion **Customer paying above the market** (Customers area, FIRINGI staff) for buyers who could save
  € 200 a year or more — a chance for account managers to help.
- **Monthly message** `benchmark.monthly_savings` (email + push, on the 1st) to buyers who could save at least
  *notify minimum* (€ 25 by default).

## FIRINGI (`/admin/pricing/intelligence/benchmark`, English; Pricing › Price Benchmark)

- **Overview:** groups, products, buyers, total possible saving, the businesses that could save most.
- **Settings:** on / off; audiences (customers, wholesalers as buyers, suppliers' view); parts (savings, cheaper
  offers, basket, trend, AI, monthly message); minimum buyers, period, refresh, notify minimum, rise warning;
  categories, countries and kinds of business left out; per-business override (on / off) from the business's page.
  Settings need `admin.pricing.manage` or `admin.settings.manage`.

When a customer, country or kind of business is switched off, the page answers 404 and the menu item is hidden.

## Tests

- `tests/unit/benchmark.test.ts` — percentiles, position, band, yearly saving, groups, trend gap, switches.
- `tests/integration/benchmark.test.ts` — minimum buyers, above / below, saving, basket, trend, AI, supplier view,
  overview, AI Centre suggestion, switches.
- `tests/e2e/benchmark.mjs` (helper `tests/e2e/setup/bench-setup.ts`).
