# Consignment stock (Phase 65)

A supplier leaves stock at a customer's premises. The customer pays only for what it uses. Regular counts find what was used, FIRINGI invoices it to the customer, and unused goods can go back.

Two channels, same rules both ways:

| Channel | Supplier | Customer |
| --- | --- | --- |
| Distributor → wholesaler | Distributor | Wholesaler (buys from distributors) |
| Wholesaler → shop | Wholesaler | Shop / restaurant |

A wholesaler can be on both sides: it receives stock from a distributor (*Orders › Consignment Stock* in its buying portal) and places stock with its own customers (*Orders › Consignment Stock* in its supplier portal).

## Who does what

| Who | Right | Pages |
| --- | --- | --- |
| Supplier manager | `vendor.consignment.manage` (sales, warehouse, company admin) | *Orders › Consignment Stock* and each site: open, send, pick up, confirm counts, close |
| Rep / van seller | `vendor.consignment.count` | Same pages: count the stock |
| Customer | `buyer.orders.place` (`buyer.orders.view` to look) | *Orders › Consignment Stock*: confirm deliveries, count, confirm or dispute counts, invoices |
| FIRINGI | `admin.vendors.view` / `admin.settings.manage` (approve: `admin.vendors.approve`) | *Vendors › Consignment Stock* (English) |

Supplier and customer pages are in 25 languages. The customer page only shows once the customer has an approved site.

## How it works

1. **Open a site.** The supplier chooses the customer (approved, the right kind for its channel), the delivery address the stock stays at, the warehouse it comes from, how often to count (days) and who counts (customer, supplier, either). One open site per address.
2. **FIRINGI approves.** With approval on (the default) the site waits as *Waiting for FIRINGI*; no stock can be sent until FIRINGI approves. A rejection needs a reason, which the supplier sees. The customer sees the site only once approved.
3. **Send stock.** The goods leave the warehouse at once (first to expire first; never expired or recalled lots) as a transfer out, and stay the supplier's. Each delivery keeps its lots, expiry and cost.
4. **The customer confirms what arrived.** Anything short is the supplier's loss (written off at cost).
5. **Count.** Whoever may count enters what is **left on the shelf** per product. Used = on the shelf before − counted. A count higher than what is placed is refused; a product left empty counts as 0 left. A count with nothing used is settled at once.
6. **The other side confirms** — or disputes with a reason. A disputed count is replaced by a recount (the old one shows as *replaced*). Nobody answering: confirmed automatically after FIRINGI's days.
7. **FIRINGI invoices.** A confirmed count becomes an order in the customer's name at its prices: no delivery fee or minimum, delivered at once, invoiced by FIRINGI to the customer (commission as usual, hidden from the customer). The used goods go out first to expire first as a shipment on that order, so cost of goods, recalls and the customer's expiry alerts follow the lots. If the order can't be placed the count shows *Billing failed* and can be billed again.
8. **Take goods back.** Unused goods go back to the warehouse (latest to expire first), same lots. Not while a count is waiting.
9. **Close** when nothing is left, nothing is on the way and no count is waiting (a pending site can be withdrawn).

The customer never sees the supplier's cost; the supplier sees the value on the shelf at cost.

## FIRINGI's switches

*Vendors › Consignment Stock*:

- consignment on/off; each **channel** on/off;
- **approval** of each new site (on by default);
- whether **customers may count** (off: only the supplier counts);
- days before an unanswered count is **confirmed automatically** (1–30, default 3);
- **expiry alert** days (default 14) and the default count interval (default 7);
- on/off **per supplier**.

Also: sites waiting for approval, disputes and failed billing (bill again), stock at customers by supplier, all sites.

## Background job

`/api/cron/consignment`, hourly: confirms unanswered counts, sends "count due" reminders (once per due date) and "expires soon" alerts to the supplier (once per lot).

## Notifications

`consignment.site_pending` (FIRINGI), `consignment.site_approved` / `site_rejected` (supplier), `consignment.site_opened`, `consignment.shipment` (customer), `consignment.count_to_confirm`, `consignment.count_due`, `consignment.invoiced`, `consignment.disputed` (both; disputes also FIRINGI), `consignment.expiring` (supplier).

## Code

- Rules: `src/lib/consignment.ts` (settings, channels, shelf, lots FEFO / latest first, count lines).
- Service: `src/server/consignment/service.ts`; actions: `src/server/actions/consignment.ts`.
- Schema: `prisma/schema/consignment.prisma` (site, shipment, lot, count).
- Pages: `/vendor/consignment`, `/vendor/consignment/[id]`, `/buy/orders/consignment`, `/admin/vendors/consignment`.
- Tests: `tests/unit/consignment.test.ts`, `tests/integration/consignment.test.ts`, `tests/e2e/consignment.mjs`.
