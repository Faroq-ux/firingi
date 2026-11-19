# Multi-currency (Phase 45)

FIRINGI resells: it buys from the supplier and invoices every customer. Its books are kept in **EUR**. Customers
and suppliers in the **non-euro Schengen countries** that FIRINGI switches on deal in their own currency.

| Country | Currency |
|---|---|
| Switzerland, Liechtenstein | CHF |
| Norway | NOK |
| Iceland | ISK (no minor unit) |
| Denmark | DKK |
| Sweden | SEK |
| Poland | PLN |
| Czechia | CZK |
| Hungary | HUF |
| Romania | RON |

## Rates

- `ExchangeRate` rows: units of the currency per €1, one per day. The daily job `fx` (`/api/cron/fx`, after 16:00
  CET) reads the **ECB reference rates** (`eurofxref-daily.xml`). `FX_SIMULATE=1` (and tests) use a simulated file.
- FIRINGI can **set a rate by hand** for a day (*International › Exchange Rates*). It wins over the feed; the feed's
  value is kept in `feedRate`, and *Back to feed* restores it. With *Rates come from: typed in by FIRINGI*, there
  is no feed at all.
- Conversion always uses the **newest rate on or before** the day. A currency with no rate at all is billed in EUR.
- **Alerts** (`FxEvent`, *International › Rate Alerts*, notification `fx.alert`): a rate moved more than X % since
  the previous one, the feed could not be read, the newest rate of a currency in use is older than N days. One per
  kind / currency / day.

## Who sees what

- **Customer rate** = reference × (1 + FX margin %). The margin is set per currency (0–10 %). Customers see only the
  resulting prices; suppliers never see the customer's rate or the margin.
- **Supplier rate** = the reference rate.
- Price lists may be in any currency:
  - in the **customer's own currency** (a *fixed local price list*) → used **exactly**, no margin, and preferred
    over lists in other currencies;
  - in the **supplier's own currency** → converted to EUR at the reference rate;
  - in EUR → shown to the customer at the customer rate.
- Suppliers choose the currency when creating a list and can **convert** a list at today's reference rate.

## Orders and documents

Amounts stay in EUR on every row (`Order.netTotal` …). A document in another currency also keeps:

| Where | Fields |
|---|---|
| Order | `currencyCode`, `eurRate` (customer rate, locked), `midRate`, `fxMarginPct`, `vendorCurrencyCode`, `vendorRate`, `netTotalLocal` / `vatTotalLocal` / `grandTotalLocal` |
| OrderLine | `unitPriceLocal` (a fixed local price exactly), `lineNetLocal`, `lineVatLocal` |
| Invoice / InvoiceLine | the same, from the order's locked rate; credit notes from the invoice they credit |
| VendorBillingStatement | `currencyCode`, `rate`, `expected*Local` |
| VendorInvoice | `currencyCode`, `rate`, `*TotalLocal` (the supplier types the amounts in its currency) |
| PaymentRequest | `currencyCode`, `amountLocal` (what the provider charges) |
| Payment | `currencyCode`, `amountLocal`, `rate` (reference rate on the day) |

`syncOrderLocal` recomputes the local amounts whenever the EUR amounts change (confirmation, weighing, excise …).
Invoices in another currency show the **EUR equivalent of VAT and totals** at the reference rate (PDF) and carry a
`Currency` block in SAF-T (PT).

## Payments and exchange differences

Money in another currency is **allocated in that currency** to the documents; the payment is booked in EUR **at
the documents' own rate**, so balances clear exactly. The difference with the money's value at the day's
reference rate is the **realised exchange gain / loss** (`FxEntry`): receivables gain when the currency
strengthened, payables the other way. The FX margin is earned this way, when the customer pays.

- Online payments, bank reconciliation (a bank line only meets documents and payments **in its currency**),
  FIRINGI's manual receipts (*currency* + *amount received*) and supplier payouts all do this.
- **P&L**: line *Exchange gains / losses (realised)*, plus the FX margin of invoices in other currencies.
- **Accounting export**: receipts / payouts post the bank at the real EUR value and the difference to **7861**
  (gains) / **6863** (losses) — editable in the account mapping; the documents sheet keeps the currency, the
  amount in it and the rate.
- *Finance › Exchange Gains & Losses*: realised by currency and side, invoices in other currencies with their
  margin, and the **unrealised** amount on open invoices at today's rate.

## Reports

FIRINGI's reports (analytics, P&L) are in EUR with a **currency switch** (today's reference rate — the books stay in
EUR). Customers' and suppliers' reports are in their own currency at **each order's locked rate**.

## Switches (International › Currency)

Multi-currency on/off · countries · EUR alongside · suppliers in their own currency · fixed local price lists · FX
margin per currency · ECB or manual rates · daily fetch · move / feed / stale alerts · EUR equivalent on invoices ·
supplier statements and payouts in their currency · book exchange differences · currency switch on reports.

## Not in this phase

- Customs for non-EU countries (Switzerland, Liechtenstein, Norway, Iceland): FIRINGI does not yet clear goods
  through customs, so cross-border sales there stay closed (see `invoiceDeliveredOrder`).
- Each country's FIRINGI entity issues the invoices (an entity per country, numbered in its own series
  `FT FIRPL2026/…`); invoice texts are still Portuguese.
- Service invoices (advertising, plans, early payout fees) stay in EUR.
