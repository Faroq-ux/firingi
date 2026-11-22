# Sales reps (Phase 62)

Wholesalers and distributors often sell through **field sales reps**. FIRINGI gives each rep a phone-first app and gives the supplier's manager the team view. FIRINGI still invoices every order. The commission is between the supplier and its rep; FIRINGI only reports it.

## Who does what

| Who | Right | Pages |
| --- | --- | --- |
| Supplier manager | `vendor.reps.manage` (owner, *Sales* role) | *Sales Reps › Sales Team*, *Rep Customers*, *Visit Plan & Map* |
| Rep | `vendor.reps.field` (*Sales Rep* role) | *Sales Reps › My Day*, *My Customers* (+ customer card), *Orders I Took* |
| Customer | `buyer.orders.place` / `buyer.orders.view` | *Orders › Orders from Sales Reps* |
| FIRINGI | `admin.vendors.view` / `admin.settings.manage` | *Vendors › Sales Reps* (English) |

Supplier and customer pages are in 25 languages. The rep's own pages only show for an active rep; the customer page only shows once a rep serves the customer.

## The team (manager)

- **Add a rep:** choose a user of the company, then set the commission % (0–50) and an optional monthly target (net). If the user can't work as a rep yet, they get the system role **Sales Rep**: support, dashboard, products (view), orders (view), field app.
- **Edit or deactivate** a rep at any time. A deactivated rep keeps their history, but loses the app.
- **Customers per rep:** one rep per customer and supplier. The list holds:
  - every business that ordered from the supplier;
  - every business that joined from its storefront (Phase 61);
  - every business already assigned.

  Searching by name also finds approved businesses of the right type in the same country that haven't ordered yet (prospects).
- **Visit plan & map:** pick a day. Each rep's visits show in order, with their status, outcome, note and photos, on a map with one line per rep. Visited stops are filled. The map uses the place where the rep checked in, or else the customer's delivery address. Managers can plan a visit for any active rep and one of that rep's customers.
- **Results per month:** each rep's customers, visits done / planned, orders taken (and still waiting), orders, delivered net, commission and % of target. The numbers download as CSV (`/api/salesreps/results?month=YYYY-MM`).

### How the numbers are counted

- **Every new order from a rep's customer carries the rep** (`Order.salesRepId`), whatever the channel: shop, app, WhatsApp, recurring order, or an order the rep took. The rep is stamped when the order is placed. Moving a customer to another rep later doesn't change old orders.
- **Delivered net** = the order's net total minus its delivery fee, without VAT, for orders delivered in the month (the date the order reached *Delivered*). Cancelled orders don't count.
- **Commission** = delivered net × the rep's %. **Target reached** = delivered net ÷ monthly target.

## The rep's app

- **My day:** today's planned visits (or any day, with ◀ ▶), each with the address, the days since the last order, open orders, *Call* and *Directions*.
  - **Check in.** The location is saved if the phone allows it.
  - **Take order:** opens the customer card linked to the visit.
  - **Finish visit:** outcome (order taken, no order, follow up, closed / not met) and a note.
  - **Photos:** up to the FIRINGI limit (default 4). Only the rep, the supplier's managers and FIRINGI can see them.
  - **Cancel** the visit.

  The page also shows the month's progress (delivered net against the target, commission, visits, orders taken). Customers not planned today can be checked in at once ("not planned — visit now"), and the rep can plan visits for their own customers. Planned visits from earlier days that nobody closed become **Missed** (hourly job).
- **My customers:** the rep's customers, longest without an order first, with the orders of the last 90 days and the open orders.
- **Customer card:** contact and address, what the customer usually buys (last 180 days), recent orders, visits, orders still waiting for the customer, and **New order**:
  - products are searched among the supplier's active offers and priced **at the customer's own prices** (price list, group prices, deals) — the same pricing the customer sees;
  - choose the delivery address, quantities and a note. The order is linked to the visit when it comes from *My day*.
- **Orders I took:** every order with its status, the order numbers once placed, and the reason when it couldn't be placed. A rep can withdraw an order the customer hasn't decided yet.

## The customer decides

An order a rep takes **waits for the customer**. The customer is notified (in-app, plus email/push per their preferences) and has **48 hours** by default (FIRINGI setting, 1–168) to:

- **Confirm:** the order is placed through the normal checkout as the customer. The usual minimums, credit, budgets, approvals and risk checks apply, prices are those of the moment, and FIRINGI invoices the customer. The supplier is told the order numbers.
- **Reject:** the supplier is told.
- **Do nothing:** the order **expires** (hourly job) and the supplier is told.

**Direct ordering:** a customer can let a supplier's reps place its orders **without confirming each one** (*Orders from Sales Reps › Your suppliers' reps*). The rep's order is then placed at once, as the person who last ordered at the customer (or another user who may order). FIRINGI can switch this off for everyone. If the customer's approval rules would hold the order, or checkout refuses it (minimum, credit, stock), the rep's order is marked **Not placed** with the reason.

## FIRINGI

*Vendors › Sales Reps* shows the month per supplier and per rep: reps, customers, visits, orders taken and waiting, delivered net and commission.

The settings (`salesreps.settings`) are:
- sales reps on/off;
- customers may allow direct ordering;
- hours to confirm;
- photos per visit.

**Switched off:** suppliers can't add reps, plan visits or take orders; customers can't confirm new ones; the pages say so; the nav hides the rep and customer pages.

## Technical

- **Schema:** `prisma/schema/salesreps.prisma`, with the models `SalesRep`, `RepAssignment`, `RepVisit`, `RepOrder` and `RepOrderPreference`, plus `Order.salesRepId`. Migration `20270603120000_phase62_sales_reps`.
- **Code:**
  - rules: `src/lib/sales-reps.ts`;
  - service: `src/server/salesreps/service.ts`;
  - actions: `src/server/actions/salesreps.ts`;
  - components: `src/components/salesreps/*`.
- **Routes:**
  - CSV `/api/salesreps/results`;
  - visit photos `/api/salesreps/visits/<id>/<n>`;
  - job `/api/cron/salesreps` (hourly: expire orders, mark missed visits).
- **Notifications:** `reporder.proposed` (customer), `reporder.placed`, `reporder.rejected` and `reporder.expired` (supplier).
- **Tests:**
  - `tests/unit/sales-reps.test.ts`;
  - `tests/integration/sales-reps.test.ts`;
  - `node tests/e2e/sales-reps.mjs`.
