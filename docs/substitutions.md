# Substitutions (Phase 60)

When a supplier can't deliver a product it accepted, found short at confirmation or while picking, it can offer one of its **own** other products instead. The customer decides, either each time or through rules set in advance. FIRINGI invoices the replacement to the customer at delivery like any other line.

## Who does what

| Who | Where | What |
|---|---|---|
| Customer | **Orders › Replacements** (`/buy/orders/substitutions`) | Sets the general rule: *Ask me each time*, *Accept automatically within my limits* (price limit in %, optional "same brand only") or *No replacements*. Chooses whether an unanswered proposal is accepted or rejected, and can add rules for single products (for example, never replace Coca-Cola). Also lists recent replacements. |
| Customer | Order page, **Replacements** card | Sees what is missing and what is offered (units, price per unit and in total, price difference, brand), then accepts or rejects. |
| Supplier | **Orders › Replacements** (`/vendor/orders/substitutions`) | Chooses, per product, which of its other products replace it, in order of preference. Also lists recent replacements. |
| Supplier | Order page, **Replacements** card | When the order is accepted and before it is packed, picks the short line, the number of missing units and the replacement. Linked replacements come first, then products in the same category. Shows the customer's rule and a price preview. Option: **Same price — I pay the difference**. The supplier can withdraw a proposal that is still waiting. |
| FIRINGI | **Orders › Substitutions** (`/admin/orders/substitutions`, English) | Overview: counts, acceptance rate and every proposal. **Settings** (all can be switched): substitutions on/off, customers may use automatic acceptance, suppliers may offer "same price", the customer's time to answer, and the defaults (rule, price limit, time-out choice) for customers who haven't chosen. |

## Rules

* **Never**: the supplier can't offer a replacement for that customer/product.
* **Ask**: the proposal waits for the customer, up to the response time (120 minutes by default). If it isn't answered in time, it is accepted only if the customer chose that; otherwise it expires.
* **Automatic**: accepted at once when the replacement costs at most the customer's limit more than the missing units. The comparison is *qty × price* of the replacement against *missing units × their price*. If the customer asked for the same brand, the replacement must be the same brand. Otherwise the proposal is asked. If FIRINGI switches automatic acceptance off, *Automatic* behaves like *Ask*.
* A product rule overrides the general rule.

## What happens to the order

1. **Proposal.** The missing units leave the original line at once: the confirmed quantity goes down, line discounts are scaled, the reservation is released and the totals are recalculated. While the proposal waits, FIRINGI's shortfall handling (Phase 9) does not move those units to another supplier.
2. **Accepted.**
   * A new order line for the replacement is created, linked to the line it replaces (`substituteForLineId`), and the original line's `substitutedQty` increases.
   * The customer's normal price is used: contract or list price and automatic promotions. It is never above the price shown in the proposal; if prices rose meanwhile, or the supplier chose "same price", the supplier pays the difference as a supplier-funded discount.
   * FIRINGI's commission stays on the list price, as for every line.
   * Stock is reserved. If the order is on an open pick list, the replacement is added to it.
   * Excise, cold chain, sold-by-weight, returnables (deposits), currency (local amounts) and CO₂ follow.
   * Open shortfall cases for the order close.
3. **Rejected, expired or withdrawn.** The units stay out of the order, and FIRINGI's shortfall handling may look for another supplier for them.
4. **Delivery.** The invoice is made from the order lines as always. The replacement appears as its own line, and the shortened original shows only what was delivered.

## Notifications

`substitution.proposed` (customer: email, WhatsApp, push), `substitution.accepted` (supplier), `substitution.auto_accepted` (customer and supplier), `substitution.rejected` (supplier), `substitution.expired` (both). Texts are in all 25 languages.

## Job

`/api/cron/substitutions` runs every 5 minutes and handles proposals that weren't answered in time. It is listed in System Health.

## Tests

* `tests/unit/substitutions.test.ts`: the rules (settings, product rule over the general rule, price difference, same price, verdicts, short units).
* `tests/integration/substitutions.test.ts` covers:
  * ask → accept → new line, stock, totals and the invoice at delivery;
  * a never-rule;
  * automatic within the limit, asked above it, and automatic switched off by FIRINGI;
  * same price;
  * rejected, expired and accepted on time-out;
  * who may propose, decide and withdraw; linked replacements first; FIRINGI overview.
* `tests/e2e/substitutions.mjs`: the browser flow in Portuguese (customer and supplier) and English (FIRINGI), including phone width and dark mode.
