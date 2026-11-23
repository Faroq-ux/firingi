# Van sales (Phase 63)

A supplier loads a van with stock from one of its warehouses. A seller drives a round and sells straight from the van to **registered FIRINGI customers**, at each customer's own prices. Every sale is a normal FIRINGI order, delivered on the spot. **FIRINGI invoices the customer** as always. At the end of the day the van is unloaded: leftovers go back to the warehouse and the cash is counted.

## Who does what

| Who | Right | Pages |
| --- | --- | --- |
| Supplier manager | `vendor.vansales.manage` (owner, *Sales* and *Warehouse* roles) | *Van Sales › Van Loads* (+ each load) |
| Seller | `vendor.vansales.sell` (*Van Seller* role; also *Sales Rep* and *Driver*) | *Van Sales › Sell from Van* (phone-first) |
| Customer | `buyer.orders.view` / `buyer.orders.place` | *Orders › Bought from Vans* |
| FIRINGI | `admin.vendors.view` / `admin.settings.manage` / `admin.finance.*` | *Vendors › Van Sales* (English) |

Supplier and customer pages are in 25 languages. The customer page only appears once the customer has bought from a van.

## A van round

1. **New load.** The manager chooses the warehouse, the seller and (optionally) a vehicle. A seller can have only one van out at a time.
2. **Load goods.** The manager searches the warehouse's products and adds quantities. The goods **leave the warehouse at once**, first to expire first; expired and recalled lots are never loaded. While the goods are on the van, online orders can't sell them. The manager can take a product off again until the round starts.
3. **Start the round.** The seller can now sell. More goods can be added during the round (top-up).
4. **Sell (phone).** The seller:
   - picks the customer (search by name or tax number) and its delivery address;
   - adds products from the van, at the customer's own prices (price lists, promotions and deals as online);
   - chooses the payment: **cash, card, MB WAY or on account**;
   - for cash, enters what was given and sees the change;
   - counts any empties handed back;
   - gets the customer's name and signature.

   The phone shows an estimate (net, VAT, total). After confirming, it shows the **exact amount to collect**: the invoice total, including deposits and excise.
5. **End of the day.** The seller (or the manager) counts what comes back per product, and the cash.
   - Counted units return to the warehouse, into the same lots.
   - Anything not counted is recorded as **missing** (written off at cost).
   - The cash difference is cash counted minus cash sales.
   - A difference above FIRINGI's limit, or any missing units, alerts the supplier's managers and FIRINGI.

## What a sale does

- It places a normal order **as the customer**: the customer's prices, licences for special goods (alcohol, tobacco…) and the excise rules all apply.
- There is **no delivery fee, no minimum and no small-order limit**: the goods are handed over now. FIRINGI's risk hold and pay-before-shipping don't apply.
- **On account** sales go through credit control as usual (credit limit, overdue invoices). Sales paid on the spot don't.
- The order goes straight to **delivered**. FIRINGI issues the invoice (sent to Moloni as usual), the customer earns loyalty points, and the customer is told (receipt notification, "Bought from vans" page).
- The goods leave the van first to expire first. They are logged on the order as a shipment of the warehouse lot, so cost of goods, **recalls** (downstream tracing) and the customer's **expiry alerts** follow the lot. A lot recalled after loading is never sold.
- **Empties** handed back become an empties return with source *Van sale*. The supplier checks it like any other return.
- If anything fails after the order was placed, the order is cancelled (nothing is left half-done) and the sale is recorded as *Failed* with the reason.

## Payment and money

- A payment taken on the spot (cash, card, MB WAY) is recorded as a confirmed payment from the customer, allocated to the invoice, reference `Van sale VS-…`. If the customer already had credit with FIRINGI, that is used first and the seller collects only what is still open.
- The supplier's seller collected that money **for FIRINGI**. It is **netted from what FIRINGI owes the supplier**: an outbound payment to the supplier's open approved invoices, oldest first, reference *Compensação vendas carrinha*. This happens when a van is unloaded and every hour (job `vansales`). Anything that can't be netted yet waits for the next supplier invoice.
- The manager's page shows the amount still to settle with FIRINGI. FIRINGI's page shows it per supplier, with a *Net now* button.
- Commission works as for any order. Buyers never see it.

## Without signal

- Each sale carries the phone's own id, so a sale sent twice (a retry, or the outbox) is carried out only once.
- With no signal, the sale is kept on the phone (the Phase 39 outbox, kind `van.sale`) and sent when the phone is back online.
- Customers' prices are saved on the phone when a customer is opened, or for all recent customers with *Get ready for no signal*.
- While offline the phone shows an estimate. The invoice is exact. Any difference shows up in the cash count.
- FIRINGI can switch offline sales off.

## FIRINGI's switches (*Vendors › Van Sales*)

| Setting | Default |
| --- | --- |
| Van sales on/off (all suppliers) | on |
| Off for a single supplier | — |
| Payment methods: cash / card / MB WAY / on account (each on/off) | all on |
| Cash limit per sale (€, 0 = none) | 1 000 |
| Customer signs for every sale | on |
| Empties at a sale | on |
| Sales without signal | on |
| Cash difference alert (€) | 5 |
| Flag vans out longer than (hours) | 16 |

The page also shows the vans on the road, sales over 30 days, money not yet netted, and cash differences. It lists every load with expected and counted cash.

## Technical notes

- Schema: `prisma/schema/vansales.prisma`.
  - `VanLoad`: the load, its status (`OPEN` → `ON_ROAD` → `CLOSED`, or `CANCELLED`) and the cash.
  - `VanLot`: per offer and warehouse lot — loaded, sold, back, lost.
  - `VanSale`: the sale, its order and invoice, payment, signature, empties, and `clientRef` for idempotency.
  - `EmptiesSource.VAN`.
- Van stock is kept **out of `StockLevel`**, so the catalogue, reservations and other channels never see it:
  - loading = `TRANSFER_OUT` (refType `VAN`);
  - a sale = `TRANSFER_IN` + `SHIPMENT` on the order, at the load's average cost;
  - missing = `TRANSFER_IN` + `WRITE_OFF`;
  - unloading = `TRANSFER_IN` into the same lots via `receive`.

  The movements ledger therefore always adds up to the warehouse's on-hand stock.
- `placeOrder(…, { van: { warehouseId, paidNow } })` places a van sale: no delivery fee or minimum (`priceCheckout(…, { noDelivery: true })`), no stock reservation, no risk hold, and no credit check when paid now.
- Rules: `src/lib/van-sales.ts` covers:
  - first-to-expire allocation;
  - the end-of-day split;
  - cash variance and change;
  - the offline estimate;
  - settings.
- Service: `src/server/vansales/service.ts`. Actions: `src/server/actions/vansales.ts`.
- Signature image: `/api/vansales/sales/[id]/signature` (the selling supplier, the customer and FIRINGI).
- Job: `/api/cron/vansales` (hourly) nets collected money and flags vans still out.
- Notifications:
  - `vansale.receipt` (customer);
  - `vansales.variance` (supplier managers + FIRINGI);
  - `vansales.late` (supplier managers).
- Tests:
  - `tests/unit/van-sales.test.ts`;
  - `tests/integration/van-sales.test.ts`;
  - browser: `node tests/e2e/van-sales.mjs [baseUrl] [screenshotDir]` (it covers an offline sale that is sent once when back online).
