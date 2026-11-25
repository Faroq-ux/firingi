# Add by Barcode with AI

Suppliers (distributors and wholesalers) add products by barcode. FIRINGI is wholesale, so the flow is built around
cases, boxes and minimum quantities.

## Supplier (Products › Catalogue, 25 languages)

1. **Type or scan** the barcode (EAN-8, UPC-A, EAN-13, GTIN-14; camera scan where the browser supports it, or a USB
   scanner typing into the box). The check digit is verified.
2. **Already on FIRINGI** (item or pack barcode, also a case code's item) → "Sell it — add your price".
3. **Found in an open database** — Open Food Facts, Open Beauty Facts, Open Pet Food Facts, Open Products Facts (all
   categories: food, drinks, cosmetics, hygiene, pet, household …). The AI turns the record into FIRINGI's form:
   name EN/PT, brand, the most specific FIRINGI category, VAT category (else the category default), unit, pack,
   description, alcohol/tobacco restriction and, for food, allergens / may contain / diets / ingredients.
   Without AI the record is mapped by simple rules.
4. **Not found** → 1–3 photos of the package (shrunk in the browser to ≤ 1600 px) are read by the AI, or
   **fill in by hand**.
5. **The easy card**: the product as read, then **How do you sell it?** — *Per item* (minimum order in items) or
   *Per case* (items in a case) — the price, **Add product**. "Edit all details" opens the full proposal form, filled in
   (incl. order step).

Everything goes to FIRINGI for approval like any proposed product. A brand not yet on FIRINGI is kept and added by
FIRINGI on approval. Food information is saved as a **draft** (source AI) for the supplier to check.

### Wholesale barcodes

| Scanned | What happens |
|---|---|
| Item barcode (EAN-13) | Per item or per case; the item barcode is the unit barcode. |
| Case code GTIN-14 (first digit 1–8) | The item inside (GTIN-13, check digit recomputed) is looked up; *per case* is chosen; case and item barcodes are both filled in. |
| Own pack EAN-13 (e.g. a 24-can tray) | Looked up as is; multipacks ("6 x 33 cl") preselect *per case* with the count. |

## Customers

A barcode search or scan (search page, Scan to reorder) matches the **item barcode, any pack barcode of the product,
a case code's item and the 13/14-digit forms**, and shows every way suppliers sell that product (single, pack, case,
tray), each with its supplier's minimum and step. Example: the Coca-Cola can and its 24-pack have different barcodes —
either shows all the listings.

## FIRINGI (Catalogue › Add by Barcode (AI), English)

- On / off; which sellers (distributors, wholesalers).
- Parts: database lookup, AI fills in the form, AI reads photos.
- Countries (Schengen) — unticked countries are left out.
- Single suppliers: *Default*, *Always on* (even in a country left out) or *Off*.
- Lookups per supplier per hour (default 60).
- The AI follows the AI Centre's governance switch and model; each AI draft is logged (kind BARCODE).

Setting: `barcodeAi.settings` (GLOBAL). Permissions: view `admin.catalogue.view`, change `admin.catalogue.manage` or
`admin.settings.manage`; suppliers need `vendor.products.manage`.

## Network & development

The open databases are called from the server (`https://world.openfoodfacts.org/api/v2/product/{code}.json` and the
beauty / pet food / products hosts) with a generic User-Agent and no personal data. `ASSISTANT_SIMULATE=1` (no AI key)
or `OFF_SIMULATE=1` simulate the databases and the AI outside production; simulated barcodes: 5609876543212 (olive
oil), 15609876543219 (its case), 5601111222333 (biscuits), 5602222333444 (shower gel), 5603333444555 (sponges).
