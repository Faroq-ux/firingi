# Sustainability & CO₂ (Phase 51)

FIRINGI estimates the carbon footprint (kg CO₂e) of what is bought and delivered on the marketplace, shows it in the
shop and on orders, and gives buyers, suppliers and FIRINGI green reports with a CSRD-style export.

## What is counted

| Part | How | Switch |
|---|---|---|
| **Products** | kg of product × kg CO₂e per kg. The value per kg is the supplier's **approved** value for that offer, else its category's (FIRINGI's own value, else FIRINGI's starting value for that kind of category, else the parent category's, else the fallback, 2 kg/kg). Kg of product = the pack's net weight, else items × 0.5 kg. | `parts.products` |
| **Packaging** | items in the pack × factor per item for the packaging type (cardboard 0.02, plastic 0.04, glass 0.25, metal 0.1, returnable 0.005, mixed 0.06, none 0). | `parts.packaging` |
| **Delivery** | straight-line km (supplier warehouse → delivery address) × road factor 1.3 × tonnes × factor per tonne-km for the vehicle's fuel (diesel 0.6, petrol 0.65, hybrid 0.45, LPG 0.5, electric 0.12; unknown fuel = FIRINGI's default). | `parts.delivery` |
| **Local** | the supplier's warehouse within 150 km of the delivery address. | `parts.local` |

Every number above is FIRINGI's setting (*Catalogue › Sustainability & CO₂ › Settings*). The starting category values are
cradle-to-gate averages from public tables (Poore & Nemecek 2018 and similar) — FIRINGI edits them in
*Category values*. Results are **estimates**, labelled as such.

## When orders are stamped

* At **checkout** each order gets an estimate (products, packaging, delivery, distance, local) and each line its kg.
* At **delivery** (when FIRINGI invoices the delivered order) the stamp is redone with the delivered quantities and the
  vehicle actually used; `co2At` is set — reports count **delivered** orders by that date.

## Suppliers' own values

Suppliers (wholesalers and distributors, each type switchable) enter, per offer, kg CO₂e per kg, packaging type,
"recyclable" and a **source** (LCA study, EPD, certificate — required). With approval **ALWAYS** (default) FIRINGI checks
each value (*Catalogue › Sustainability & CO₂*, approve / turn down with a reason; the supplier is notified); with
**AUTO** it is used at once. Only approved values count.

## What people see (each switchable)

* **Badges** in the shop — *Low CO₂* (≤ 70 % of the category's value), *Local*, *Eco packaging* (returnable, none, or
  recyclable single material) — and the shop's **eco filter**.
* **Product page** — footprint per pack and per kg, the category average, packaging, source, and **lower-CO₂
  alternatives** in the same category.
* **Cart** — the cart's footprint. **Orders** — the order's footprint by part, distance, estimate / final.
* **Reports** — buyer (*Reports › CO₂ Footprint*): total, per €, local share, delivery share, by month, category,
  supplier and biggest products; supplier (*Reports › CO₂ Footprint*): the same by customer; FIRINGI: the whole
  marketplace. **Export** CSV (GHG Protocol Scope 3 Cat. 1 purchased goods & packaging, Cat. 4 upstream transport,
  monthly rows + TOTAL) and PDF, for CSRD / ESRS E1 reporting.
* **Goals** — a buyer sets a yearly reduction goal (%); the report compares this year so far with the same time last
  year and says on track / above target.
* **Supplier green grade** A–E — 60 % CO₂ against the categories, 25 % eco packaging, 15 % own checked values.

## Switches

Everything is FIRINGI's: the whole feature, each part, each thing shown, buyer types, supplier types, approval mode,
thresholds, factors, the default fuel — and **each business on / off** (per business switch, key `CO2`). A business
switched off loses its badges, report and goal; its orders are still stamped so FIRINGI's totals stay complete.

## Code

* rules — `src/lib/co2.ts` · service — `src/server/co2/service.ts` · actions — `src/server/actions/co2.ts`
* hooks — `placeOrder` (estimate) and `invoiceDeliveredOrder` (final) · export — `src/app/api/co2/export/route.ts`
* pages — `/buy/reports/co2`, `/vendor/products/co2`, `/vendor/reports/co2`, `/admin/catalogue/co2` (+ `/factors`, `/settings`)
* vehicle fuel — on the fleet vehicle lists (supplier and FIRINGI)
* tests — `tests/unit/co2.test.ts`, `tests/integration/co2.test.ts`, `node tests/e2e/co2.mjs`
