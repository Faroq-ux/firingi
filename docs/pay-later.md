# Pay later (Phase 50)

A buyer pays an order's invoice later — in N days or in monthly instalments — financed by a payment gateway's
"buy now, pay later" partner or by FIRINGI's own credit.

## Rules (src/lib/pay-later.ts — unit-tested)

- `PayLaterSettings` (`Setting` key `paylater.settings`): `enabled`, `buyers{CUSTOMER, WHOLESALER}`, `terms[]`,
  `countries{ISO: {partner, own, first}}` + `defaults`, `ownLimit{CUSTOMER, WHOLESALER}`, `minOrder`, `remindDays`.
- `PayLaterTerm`: `id`, `kind` DAYS (7–365 days) / INSTALMENTS (2–12 monthly), `enabled`, `feePct` (0–20), `feeFixed`,
  `feePayer` BUYER / FIRINGI / SHARED, `buyerSharePct`. Defaults: 14 (off), 30, 45 (off), 60, 90 days; 3 and 6 (off)
  instalments.
- `feeFor(term, gross)` → `{total, buyer, firingi}`; `schedule(term, from, amount)` → payments (instalments on the same
  day each month, month ends kept, cents spread, the last takes the rest); `lastDueDays()`; `modelOrder()`.

## Data (prisma/schema/pay-later.prisma)

`PayLaterPlan` (one per order: model PARTNER / OWN, the term as chosen, partner reference, amount, buyer / FIRINGI fee,
status ACTIVE → INVOICED → PAID, or OVERDUE / CANCELLED, invoice), `PayLaterInstalment` (n, due, amount, paid,
reminded, overdue), `PayLaterAccount` (a business's own-credit limit; the partner's last decision). Per-business
switch: `CompanyFeature` `PAY_LATER`.

## Flow (src/server/pay-later/service.ts)

1. **Checkout** — `checkoutOptions(ctx, gross)` lists the enabled terms with the buyer's fee and schedule (not for
   FIRINGI-routed carts; not when the business is off, overdue, or below the smallest order). `placeOrder({payLater})`
   calls `preparePayLater()` *before* creating anything: per the country's order it asks the partner
   (`authorize`) or checks FIRINGI's own credit (limit − what is still owed); a decline falls to the other model; none
   → a clear error. Inside the order transaction `createPlans()` adds one plan per order (each order has its own
   invoice and fee). Paying later replaces "pay before shipping" for that checkout (own credit is never offered to
   pay-before-shipping buyers).
2. **Invoice** — `invoiceDeliveredOrder` asks `invoicePart()`: the buyer's fee becomes a line at 0 % VAT (financing —
   VAT exempt, art. 135(1)(b) of the VAT Directive) and the invoice is due on the last payment; `afterInvoice()` writes
   the instalments over the invoice's gross.
3. **Job** (`runPayLaterJob`, `/api/cron/paylater`, every 15 min): cancelled orders end their plans (partner told);
   partner plans — the partner pays FIRINGI the open amount (an INBOUND payment `paylater:<partner>` allocated to the
   invoice) → PAID; own-credit plans — payments allocated to the invoice cover the instalments in order (paid dates),
   a reminder `remindDays` before each due date (`paylater.due_soon`), overdue the day after (`paylater.overdue`, plan
   OVERDUE → the business can't pay later again until it pays).

## Partners (src/server/pay-later/partner.ts)

`PayLaterPartner { authorize, capture, cancel }`. `activePartner()`: env `PAYLATER_PARTNER`, else the simulated one
when `PAYLATER_SIMULATE=1` or `PAYMENTS_SIMULATE=1` (approves businesses with a tax number up to
`PAYLATER_SIM_LIMIT`, default 25 000 €). A real gateway's B2B pay-later API is added as another implementation.

## Pages

Buyers: the choice in the cart; *Invoices & Payments › Pay Later* (limit, options, plans and instalments). FIRINGI
(English): *Finance › Pay Later* (outstanding / overdue own credit, partner volume, fees, every plan) and *Settings*
(every switch, terms editor, models per country, limits, each business with its own switch and limit).
