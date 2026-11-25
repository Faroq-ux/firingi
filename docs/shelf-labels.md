# Shelf Price Labels

Shops (customers) and wholesale counters print price labels for their shelves. Shop page: *Catalogue › Shelf Price Labels* (`/buy/catalogue/shelf-labels`, 25 languages). FIRINGI page: *Catalogue › Shelf Labels* (`/admin/catalogue/shelf-labels`, English).

## Adding products

- **Bought on FIRINGI** (last 12 months): the shop ticks products and enters a margin %. Price on the shelf = today's cost per item × (1 + margin) × (1 + VAT). A case price is split per item (case of 24 cans at €13.30 → €0.55 per can → +40% +23% VAT → €0.99). Rounding: ends in 9 (x.x9, rounded up) or the exact cent.
- **From the till** (shops with the FIRINGI till): the till item's price and barcode.
- The **barcode is the product's own item barcode** (the variant's GTIN, not the case barcode), so the shop's till scans the label and customers see the same code as on the pack.
- Brand and origin come from the product on FIRINGI; the net content (for the price per kg / litre) is read from the name ("33cl" → 0.33 L, "1,5L", "2kg", "500 g") and can be changed.

## Editing

Name, price incl. VAT, margin % (re-prices from today's cost; a price typed by hand ends margin pricing), promo price and end date, content (kg / litre), barcode (8–14 digits), brand, origin. "Also change the price in my till" saves the price into the FIRINGI till item (the item it came from, or the one with the same barcode, or a new one).

## To print / new prices

- **To print**: labels never printed, or whose price or promo changed since they were printed (a promo that ended counts too). Printing marks them printed at their current price.
- **New prices**: for labels priced by margin, when the supplier's price changes the page shows "Cost changed: new price …"; "Use new prices" takes them (and they go to "to print").

## Printing (PDF)

Sizes: A4 sheets of 21 (70 × 42 mm), 12 (105 × 49 mm) and 4 big labels (105 × 148 mm); A4 sheet of 27 shelf-edge strips (70 × 33 mm); label-printer rolls 58 × 40, 62 × 29 and 40 × 30 mm. Copies of each: 1–50.

**My size** (if FIRINGI allows): the shop enters width × height in mm and chooses *A4 sheets* (as many as fit; top / left margin and gaps across / down for sticker sheets — margins 0 centre the labels) or a *label-printer roll* (one label per page of exactly that size). The page shows how many fit (e.g. "21 per sheet (3 × 7)") and a drawing of the sheet. The size is saved per shop (setting `shelfLabels.customSize`, scope COMPANY) and chosen by default next time. **Test print**: one sheet filled with the selected labels and solid outlines, to print on plain paper and hold against the sticker sheet; it does not mark labels as printed. Limits: 25–200 × 15–287 mm. Type scales down on very low labels; barcode bars never get thinner — labels under 32 mm wide show the barcode number only. Own sizes print without cut lines.

Each label: name, brand · origin (if allowed and ticked), the price incl. VAT as large as fits, promo (red bar "PROMO · until …", old price struck through, price in red), price per kg / litre, the code, shop name and date (ticked).

Code: the product **barcode** drawn as EAN-13 / EAN-8 / UPC-A bars with quiet zones (bars at least 0.26 mm wide), or a **QR code** that opens the product's food information (allergens, ingredients), or none. No barcode that can be drawn → QR (if FIRINGI allows QR); QR chosen but no FIRINGI product (a till item) → barcode. DejaVu Sans: every letter of the 25 languages.

## FIRINGI switches

On/off; who (customers, wholesalers); what a label may show (brand, origin — off by default, QR); saving prices into the till; shops setting their own label size (on by default); countries; single businesses always on / always off (wins over the country). Setting `shelfLabels.settings`.

Rights: viewing needs catalogue / ordering or till rights; adding, editing and removing need ordering or till-manage rights.

Code: `src/lib/shelf-labels.ts` (rules: formats, margin price, unit price, content from name, reprint, switches), `src/server/labels/service.ts`, `src/server/pdf/shelf-labels.tsx`, `src/app/api/buy/shelf-labels/pdf/route.ts`.
Tests: `tests/unit/shelf-labels.test.ts`, `tests/integration/shelf-labels.test.ts`, `node tests/e2e/shelf-labels.mjs`.
