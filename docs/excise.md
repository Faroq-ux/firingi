# Licensed & excise goods (Phase 43)

Alcohol, tobacco, vaping products and sugary drinks: who may buy them (licences), where and how much (country
restrictions, quantity caps), the excise duty (shown per product, added by FIRINGI or already in the supplier's
price, on the invoice), the driver's licence / ID check, the accompanying documents and the excise reports.

Everything can be switched on or off by FIRINGI in *Settings › Licensed Goods* (`Setting excise.settings`, defaults
in `src/lib/excise.ts`). Code: `src/lib/excise.ts` (rules, duty maths), `src/server/excise/service.ts`.

## Excise categories and rates

FIRINGI manages them in *Catalogue › Licensed Goods* (English):

| Category | Kind | Duty basis |
|---|---|---|
| Beer | alcohol | per hl per % vol (`HL_PER_ABV`) |
| Wine, Intermediate products | alcohol | per hl of product (`HL_PRODUCT`) |
| Spirits | alcohol | per hl of pure alcohol (`HL_PURE_ALCOHOL`) |
| Cigarettes, Cigars | tobacco | per 1 000 units + ad valorem % (`THOUSAND_UNITS`) |
| Rolling tobacco | tobacco | per kg + ad valorem % (`KG`) |
| E-liquid | vaping | per ml (`ML`) |
| Sugar-sweetened drinks | sugar | per hl, by sugar band (`HL_SUGAR_BAND`) |

**Rates** are per category and country, with a start date; adding a new rate ends the previous one the day before,
so old orders keep the rate of their day. The migration ships **example rates for Portugal and Spain — check them
against the current law before going live** (e.g. PT beer 4,50 € per hl per % vol, PT cigarettes 117,27 € per 1 000
+ 14 %, PT sugar bands 25 g / 50 g / 80 g / more per litre). A category can also have a **maximum per order** and
**blocked countries**.

Shop categories carry a default excise category (Beer & cider → Beer, Tobacco → Cigarettes…). The **supplier** sets
the measures per product in *Products › Licensed Goods* (translated): % vol, litres per unit, pieces per unit, kg of
tobacco, sugar g/l — only what the category's basis needs — plus:

- **Duty mode**: `PAID` — already in the supplier's price (shown as "incl. x € excise" when FIRINGI shows duty), or
  `ADDED` — FIRINGI calculates and adds it (only when *FIRINGI calculates duty* is on).
- **Only to these countries** (empty = everywhere).

Duty per unit is worked out to 4 decimals (`dutyPerUnit`); ad valorem applies only to cigarettes / rolling tobacco.

## Licences

Licence types (FIRINGI, *Catalogue › Licensed Goods*): **Alcohol licence** (covers alcohol) and **Tobacco licence**
(tobacco and vaping), each with countries, number required, expiry required.

- The **customer uploads** its licence in *Company › Licences* (PDF or photo, number, issuer, dates). FIRINGI is told
  (`excise.licence_review`).
- **FIRINGI approves, rejects (with a note) or revokes** in *Customers › Licences* — the licence register, with
  filters per status, the file, and a form to **record a licence** seen on paper. A newly approved licence supersedes
  the older one of the same type. The customer is told (`excise.licence_decided`).
- **Expiry**: the daily `excise` job marks expired licences and reminds the customer 30, 14 and 7 days before
  (`excise.licence_expiring`; the days are a setting).
- **Enforcement** (setting, with per-country overrides such as `ES:off FR:warn`):
  - `BLOCK` (default) — without a valid licence the products are **hidden** and cannot be added to the cart or
    ordered (`EXCISE_LICENCE` error);
  - `WARN` — visible and orderable, with a warning on the product and in the cart;
  - off for a country — no licence needed there.
- The Phase 3 "restricted products" approvals are unified with licences: an approved licence opens the same
  products, and an old approval still counts.
- **Supplier licence** (optional switch): the certificate type *Excise authorisation* (tax warehouse / registered
  consignee) becomes required for suppliers of licensed goods, through the Phase 28 compliance checks.

## Country restrictions and quantity caps

At add-to-cart and at checkout (`checkItems` / `assertItems`): a product not sold to the customer's country
(supplier's list or the category's blocked countries) and more than the category's maximum per order are refused
(`EXCISE_COUNTRY`, `EXCISE_QTY_CAP`). Each check can be switched off.

## Orders and invoices

- Every order line keeps its excise category, mode, duty per unit, total and measures (`OrderLine.excise*`), so rate
  changes don't rewrite old orders.
- **ADDED duty** is kept apart from the goods (`Order.exciseAddedNet / exciseAddedVat`), like deposits. The cart and
  order show it (+ VAT). On the invoice it is a **separate line per category** ("Imposto especial de consumo — Beer
  (SKU …)") at the goods' VAT rate, and it is **passed through to the supplier's statement** (FIRINGI takes no
  commission on duty). A partial credit note of goods credits the matching part of the duty automatically.
- **PAID duty** is informational: shown on the invoice line ("incl. excise duty", `InvoiceLine.exciseNet`) and in
  the reports.
- The **pay-before-shipping** amount does not include ADDED duty (same as deposits); it is on the invoice.

## Delivery

- **Accompanying document** — the supplier or FIRINGI records the type (e-AD, e-SAD, SAAD, simplified, other) and
  reference on the order page. It is a record only: FIRINGI does not submit to EMCS / the tax authority.
- **Driver check** (setting, off by default) — for orders with alcohol or tobacco the driver must tick "I checked
  the customer's licence / ID" before confirming the delivery (driver page and offline app); who and when is shown
  on the order.

## Reports

- **Supplier — Orders › Excise Report** (translated): per month (by delivery date), per category, country and mode:
  units, litres, litres of pure alcohol, pieces, kg, duty added and duty in prices, orders. PDF and CSV
  (`/api/excise/report?month=YYYY-MM[&format=csv]`).
- **FIRINGI — Finance › Excise**: the same for all suppliers, tiles, and products missing measures.
- **Accounting export**: the excise is split out of sales into its own account (default `7118`) and has its own
  column in the documents table.

## Tests

`tests/unit/excise.test.ts` (duty maths, bands, licence rules), `tests/integration/excise.test.ts` (checkout
block, ADDED duty on order / invoice / statement, credit notes, driver check, report, accounting split),
browser `tests/e2e/excise.mjs`. Screenshots `docs/screenshots/ex-*.png`.
