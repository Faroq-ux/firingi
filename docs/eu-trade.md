# EU trade reporting (Phase 57)

FIRINGI invoices every buyer and buys from every supplier, so FIRINGI's own entity reports the goods and services that cross an EU border. FIRINGI's pages are in English; the supplier pages come in all 25 languages.

## What is reported

| Return | What goes in | Where it comes from |
|---|---|---|
| **EC Sales List** | FIRINGI's exempt intra-EU supplies of goods, and reverse-charge services (e.g. advertising) to businesses in other EU countries. One row per customer VAT number and type (goods, services, triangular). | FIRINGI's invoices and credit notes with VAT treatment *intra-EU supply* or *reverse charge* |
| **Intrastat arrivals** | Goods FIRINGI bought from a supplier in another EU country. | The suppliers' reverse-charge billing statements (and credit statements) |
| **Intrastat dispatches** | Goods FIRINGI sold into another EU country. | FIRINGI's *intra-EU supply* invoices and credit notes |

Each Intrastat line has the CN8 code, net mass (catch-weight goods use the weighed kg), supplementary units, country of origin, partner VAT number, value, nature of transaction, mode of transport and delivery terms (defaults: 11, 3 = road, DAP).

## Returns and filing (*Invoices & Tax › EU Trade Reporting*)

1. **Building the returns.** Every night the current and previous period of each enabled return is rebuilt from the documents. FIRINGI can also click *Rebuild* or open an older period. ECSL is monthly or quarterly per country; Intrastat is monthly.
2. **Checking the lines.** Each line shows its document and any problem:
   - missing or malformed CN8 code;
   - missing net mass or origin;
   - partner without a VAT number, or a number that is not valid at VIES;
   - the category's default code being used (a warning).
   *Mark ready* stays off while blocking problems remain.
3. **Downloading.** Each return can be downloaded as a generic CSV, an Excel file (summary plus lines), or the entity country's national layout:
   - **Portugal:** AT recapitulative statement CSV; INE Intrastat CSV.
   - **Spain:** Modelo 349 fixed-width records. Spanish Intrastat uses the generic CSV.
   - **France:** DEB as INSTAT XML; ECSL / DES CSV.
   - **Germany:** ZM CSV for the BZSt portal; IDEV CSV.
   - **Other countries:** generic layout.
   **Before the first real filing in a country, upload one test file to that authority's portal and compare.** Layouts change.
4. **Filing.** Upload the file at the authority, then *Mark filed* with the submission reference. A filed return is frozen.
   - A credit note or credit statement issued later becomes a **correction line** in the next open return, marked with the period it corrects. This includes one dated inside a period that was already filed.
   - Only tax staff (`admin.tax.manage`) can reopen a filed return, and they must give a reason (audited).
5. **Deadlines.** Each country has a due day of the following month. Finance gets reminders before each deadline (default 7, 3 and 1 days), once per day setting. Intrastat reminders only go out once *Must file* is ticked for that flow.
6. **Thresholds.** For each entity and flow, the overview shows this year's and last year's goods value against the country's threshold. Finance is warned once a year at the chosen percentage (default 80 %) and again when the threshold is passed. Starting values (2026, check them every January):

| Country | Arrivals | Dispatches | ESL due day | Intrastat due day | Layout |
|---|---|---|---|---|---|
| PT | €650,000 | €600,000 | 20 | 15 | AT / INE |
| ES | €400,000 | €400,000 | 20 | 12 | Modelo 349 / generic |
| FR | none (customs decides) | none | 10 | 10 | DEB / DES |
| DE | €3,000,000 | €1,000,000 | 25 | 10 | ZM / IDEV |

## Selling into a country without a FIRINGI entity

When a buyer's country has no FIRINGI entity, the main entity (*marketplace default country*) invoices it. This needs the setting *Sell into countries without a FIRINGI entity* to be on, and the goods must leave from the main entity's country. A buyer in a country with its own FIRINGI entity is invoiced by that entity as before.

1. **Before the invoice is issued,** the buyer's VAT number is checked at **VIES**.
   - A VALID check younger than the set number of days (default 30) is reused.
   - Otherwise VIES is asked now.
   - Every answer is stored as **proof** (consultation reference, date, purpose `INVOICE`) and linked to the invoice. It is also printed in the invoice's recipient details.
2. **Valid:** the invoice is an exempt **intra-EU supply**.
   - All lines have 0 % VAT, with exemption M16 (art. 14.º RITI) in Portugal.
   - The PDF and the e-invoice (category K, VATEX-EU-IC) say so.
   - The line goes into the EC Sales List and Intrastat dispatches.
3. **Not valid, or VIES not answering** (unless the setting says to use the last valid check): the main entity's **own VAT** applies.
   - Goods are charged at their tax category's rate.
   - The delivery fee is charged at its own category's rate.
   - Other lines (deposits, duty) use the order's highest goods rate.
4. **At checkout,** such a buyer whose last VIES check was valid already sees 0 % VAT.

The supplier's own side keeps its original treatment: a Portuguese supplier selling to FIRINGI Portugal stays domestic. Credit statements now follow the original statement's treatment.

## Customs codes (*Invoices & Tax › Customs Codes*)

- **Category default:** a CN8 code and a supplementary unit (e.g. `l`) per category. Sub-categories inherit it. A product without its own code uses it, flagged on the line.
- **Product:** FIRINGI sets the CN8 code, country of origin and supplementary unit, plus net mass and supplementary units per pack. Saving marks the data as checked.
- **Supplier:** *Products › Customs Codes* in the supplier portal.
  - The supplier sends the values per pack; a newer proposal replaces a pending one.
  - FIRINGI accepts (values copied to the product, optionally corrected) or rejects with a reason.
  - The supplier is notified either way.

## VIES checks (*Invoices & Tax › VAT Number Checks*)

- Lists every partner in another EU country with their latest answer and proof.
- *Check at VIES* runs a new check (purpose `RECHECK`). The history shows each check, its purpose and the invoice it proves.
- `VIES_SIMULATE=1` (tests, development) answers without the network: numbers ending in `000` are not valid.

## Suppliers' own report (*Reports › EU Trade Report*)

What FIRINGI bought from the supplier across a border in a period:
- **EC Sales List rows:** FIRINGI's entity VAT number and the amount.
- **Intrastat dispatch rows:** CN8 code, net mass, origin, value.

Both download as CSV or Excel. Amounts are what the supplier invoices FIRINGI, without VAT (reverse charge).

## Settings (*Settings › EU Trade Reporting*)

FIRINGI can switch each of these on or off, or change it:
- reporting as a whole, and each return;
- suppliers' reports;
- selling into countries without an entity;
- the VIES re-check, the age of a reusable check, and what happens when VIES doesn't answer;
- supplier customs proposals, and the category default code;
- corrections;
- the threshold watch (warn %) and reminders (days);
- the default nature, transport and delivery terms;
- per country: the ESL period, due days, thresholds, *Must file* arrivals and dispatches, and the file layout.

## Code

- **Rules and layouts:** `src/lib/trade.ts`.
- **Service:** `src/server/trade/service.ts`.
  - Returns, VIES before invoicing, customs data, supplier report, job.
- **Invoicing hook:** `saleFor` and `crossBorderRates` in `src/server/invoicing/service.ts`.
- **Checkout 0 %:** `zeroRatedBuyer` in `src/server/orders/pricing.ts`.
- **Pages:**
  - FIRINGI: `src/app/admin/invoices/eu-trade/*` and `src/app/admin/settings/eu-trade`.
  - Supplier: `src/app/vendor/products/customs` and `src/app/vendor/reports/eu-trade`.
  - Components: `src/components/trade/*`.
- **Downloads:** `/api/trade/returns/[id]?format=csv|xlsx|national` and `/api/trade/supplier?period=&kind=&format=`.
- **Daily job:** `/api/cron/trade`.
- **Schema:** `prisma/schema/trade.prisma`.
  - New fields: `Category.cnCode` / `suppUnit`, `Product.suppUnit` / `cnCheckedAt`, `PackagingUnit.suppUnits`, `VatValidation.purpose` / `invoiceId`.
  - New tax treatment: `TaxRegime.INTRA_EU_SUPPLY`.
- **Tests:**
  - `tests/unit/trade.test.ts`;
  - `tests/integration/trade.test.ts`;
  - `tests/e2e/eu-trade.mjs` (with `tests/e2e/setup/trade-order.ts`).
