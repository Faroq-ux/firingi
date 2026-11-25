# Suppliers & Minimums

For countries where customers choose their own wholesalers (not FIRINGI ordering mode). FIRINGI page: *Catalogue › Suppliers & Minimums* (English).

## Supplier minimums (customer pages, 25 languages)

- **Suppliers in the cart first** — search results and scan-to-order put suppliers already in the cart first, then the customer's usual suppliers (last 180 days), so the customer fills one supplier's minimum instead of splitting the cart. Only for "relevance" order; a chosen sort (price, rating, distance) is kept.
- **Badges** under each offer:
  - in the cart: "In your cart · €12 more to reach the €50 minimum", "… more for free delivery (€150)", "minimum reached";
  - not in the cart: "Minimum order €50", "Free delivery from €150" (or units).
- **Cart suggestions** — for a supplier below its minimum: "Lisboa Central: €46 more to reach the minimum order of €50", with what the customer usually buys from it (most ordered first, not already in the cart, still sold), each one tap to add at the quantity last ordered (respecting minimum and step).

Which minimum: for a customer, FIRINGI's minimum order (blocks checkout) and then the wholesaler's free-delivery minimum; for a wholesaler buying from a distributor, the distributor's minimum (amount or units; with a flat fee it is a free-delivery goal). Amounts excl. VAT.

Switches: on/off, each part (cart first, badges, suggestions), countries. Setting `cartHelp.settings`.

## Supplier names

FIRINGI decides whether buyers see the wholesaler's name or **"FIRINGI + area"** (e.g. *FIRINGI Almada*):
- customers by default, per customer country, wholesalers buying from distributors, and per supplier (always its name / always FIRINGI + area — wins).
- The area is the city of the supplier's warehouse (else pickup point, else head office); suppliers in the same city are numbered by joining order ("FIRINGI Lisboa", "FIRINGI Lisboa 2").
- Applied to: search and browse results, product pages, filters, supplier list and store, scan to order, cart, checkout groups, orders (list and detail), dashboard, buy-again, phone app and buyer notifications. Invoices are always issued by FIRINGI. Suppliers, FIRINGI staff and the supplier's own storefront page (/s/…) always show the real name.
- Not yet covered: some specialised pages that list deliveries by supplier (claims, food-safety receiving, cold chain, returnables, recalls, rebates, quotes/tenders) still show the supplier's name.

Setting `supplierNames.settings` (default: names shown everywhere — nothing changes until FIRINGI switches it).

Code: `src/lib/cart-help.ts` (rules), `src/server/catalogue/cart-help.ts` (settings, names, standings, suggestions).
Tests: `tests/unit/cart-help.test.ts`, `tests/integration/cart-help.test.ts`, `node tests/e2e/cart-help.mjs`.
