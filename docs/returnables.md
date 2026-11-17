# Returnables & deposits (Phase 40)

Crates, kegs, pallets, bottles, boxes and gas cylinders that go back to the supplier.

## Kinds

| Kind | Examples | At delivery | When the empty comes back |
|---|---|---|---|
| **Deposit** | crates, pallets, glass bottles, transport boxes | a deposit for every unit delivered | refunded (credit note) after the supplier's check |
| **Refill / swap** | gas cylinders, kegs | the customer hands back an empty for each full one; only units **without** an empty carry the deposit | extra empties (more than the full ones delivered) are refunded like deposits |

Items: FIRINGI's shared list (`ownerCompanyId = null`, seeded by the migration: EUR pallet, beer crate 24, glass bottle,
plastic box, kegs 30/50 L, butane 13 kg, propane 11 kg) and each supplier's own items. A supplier links its offers to
items with a quantity per unit (*Products › Returnables*). The product page, product cards and the cart show it to buyers.

## Where it is stored

- `ReturnableType`, `OfferReturnable` — the items and what comes with each offer.
- `OrderReturnable` — per order × item: units out, empties the buyer planned to swap (cart), what the driver swapped,
  deposit units invoiced, VAT rate.
- `ReturnableMovement` — the ledger: units a customer holds from a supplier (OUT +, SWAP_IN −, RETURN −, KEPT −, ADJUST ±).
- `EmptiesReturn` / `EmptiesReturnLine` — empties brought back: counted → checked (accepted / damaged / missing) →
  credited; disputes and FIRINGI's decision.
- `EmptiesPickup` — collections the customer asks for.
- Settings: `Setting returnables.settings` (VAT per country, overdue rule + per-supplier exceptions, refund damaged,
  pickups on/off and minimum).

## Money

- **Invoice** (order delivered): after the goods and the delivery fee, one line per item `Depósito: <name> [CODE]`,
  quantity = deposit units (deposit kind: units out; refill kind: units out − empties swapped), net = deposit × qty,
  VAT by the country rule. The **supplier's billing statement** gets the same lines (`sku DEPOSIT:CODE`, commission 0):
  the supplier charges FIRINGI the deposit, FIRINGI charges the customer — no margin.
- **Refund**: when the supplier accepts empties, credit notes are issued on the customer's deposit invoices for that
  supplier and item, **newest first**, never more than the deposit units the customer still has paid in
  (invoiced − refunded − kept). Each credit note gets a matching **credit statement** for the supplier.
  Empties with no deposit paid (an opening balance) are taken back without a refund.
- **Kept**: when the admin's rule says *keep the deposit*, empties held longer than N days leave the balance (KEPT);
  their deposit is not refundable any more.
- Payments, statements and the accounting exports pick these documents up like any other invoice / credit note.
  Order totals before delivery do not include deposits (the cart and order page show the estimate apart).

## VAT

Per country (*Settings › Returnables & Deposits*): **no VAT** (0 %, exemption code M99 in Portugal — returned packaging
is not part of the taxable amount), **same as the goods** (the highest rate on the order's lines), or a **fixed rate**.
Defaults: PT no VAT, other countries the goods' rate. Check the rule with your accountant for each country.

## Flows

1. **Cart** — estimated deposit per supplier × item; for refill items the buyer sets how many empties they will hand
   back (default: the empties they hold, at most one per full unit). Saved on the cart and copied to the order.
2. **Delivery** — the driver's proof-of-delivery form (and the offline driver app) lists the items the customer holds
   from this supplier and the order's refills; the driver counts the empties taken back. Refill empties swap the full
   units (no deposit for those), the rest becomes an **empties return** waiting for the supplier's check. If no count
   is sent (e.g. the supplier marks the order delivered), the swap the buyer planned is used.
3. **Pickup** — the customer asks for a collection (items, address, preferred date); the supplier plans a driver and a
   day; the driver collects from *Today's deliveries*; the empties wait for the supplier's check. Open pickups are
   closed automatically when the driver takes empties back at a delivery to the same customer.
4. **Drop-off** — the customer brings empties to the supplier, who records and checks them at once.
5. **Check** — the supplier enters accepted and damaged per item (the rest is missing); good ones are refunded (damaged
   too if the admin says so); the customer is notified and can **contest**; FIRINGI decides: the customer's count
   (the difference is taken back and refunded) or the supplier's.
6. **Overdue** — daily job `/api/cron/returnables`: units held longer than N days (first in, first out) → reminder
   every M days, or the deposit is kept (per-supplier exceptions).
7. **Corrections** — the supplier records opening balances or corrections (no money moves).

## Pages

- Supplier (25 languages): *Products › Returnables* (items, product links), *Orders › Empties & Deposits* (by item, to
  check, pickups, balances, drop-off, corrections, statement CSV), return detail with the check form.
- Customer (25 languages): *Orders › Empties & Deposits* (what you hold, deposits paid, overdue, pickup request, returns,
  statement CSV), return detail with *contest*; product page panel, card badge, cart card, order page deposits.
- Driver: empties counter on the proof-of-delivery form (online and offline), pickups on *Today's deliveries*.
- FIRINGI (English): *Orders › Empties & Deposits* (totals, per supplier, contested counts, balances), return detail with
  the decision, *Catalogue › Returnable Items* (shared list), *Settings › Returnables & Deposits*.

## Tests

`tests/unit/returnables.test.ts` (the pure rules: settings merge, VAT per country, units per order, swap/return
split, charged units, first-in-first-out ageing, overdue units), `tests/integration/returnables.test.ts` (deposits on invoice and statement, swaps, supplier check, refunds capped
by deposits paid, disputes, drop-off, opening balances, pickups, overdue remind/keep, VAT rule, cart swaps, offline
driver) and `tests/e2e/returnables.mjs` (browser, Portuguese + English, phone and dark mode).
