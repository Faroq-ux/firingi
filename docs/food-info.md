# Food information & allergens (Phase 44)

EU 1169/2011 food information for every food product: the 14 allergens, ingredients, nutrition, diets and
certificates, origin, storage and shelf life — filled in by the supplier, checked by FIRINGI, used by customers to
choose and to inform their own guests and shoppers.

Every part is a FIRINGI switch in *Settings › Food Information* (`Setting food.settings`, defaults in
`src/lib/food.ts`). Code: `src/lib/food.ts` (rules), `src/server/food/service.ts`, `import.ts`, `label-ai.ts`.

## The data

Products are shared in the master catalogue, so food information belongs to the **product**, in versions
(`FoodInfo`): any supplier selling the product can submit one; the approved one is the product's current
information (`Product.foodInfoId`), and its allergen / diet lists are copied onto the product for filtering.

| Part | What | Notes |
|---|---|---|
| Allergens | the 14 of Annex II: gluten, crustaceans, eggs, fish, peanuts, soya, milk, nuts, celery, mustard, sesame, sulphites, lupin, molluscs | each **contains / may contain (traces) / free from**; which cereal / nut / fish as free text |
| Ingredients | per language | allergens between `*asterisks*` are shown in **bold** (as the EU requires) |
| Nutrition | per 100 g or 100 ml: energy kJ + kcal, fat, saturates, carbohydrate, sugars, fibre, protein, salt | checked: saturates ≤ fat, sugars ≤ carbohydrate, kJ ≈ 4.184 × kcal, ≤ 100 g, ≤ 900 kcal |
| Diets & claims | vegan, vegetarian, halal, kosher, gluten-free, lactose-free, organic | contradictions refused (vegan + milk, gluten-free + gluten); halal / kosher / organic want a certificate (number, issuer, expiry, file) |
| Origin, storage, shelf life | country, storage text per language, days, days after opening | |
| Files | label photo, spec sheet | |

**What each category needs** — *Catalogue › Food Data Quality* (bottom): fields per category; a subcategory
inherits its parent unless it has its own rule; a top category without a rule is not food. Defaults: groceries,
beverages, kebab & pizza supplies → allergens, ingredients, nutrition, storage; fresh produce and water → origin;
alcoholic beverages → allergens (EU exemption for ingredients / nutrition above 1.2 % vol); boxes & wrapping → none.

## Supplier

*Products › Food Information* (translated): the food products it sells, how complete, FIRINGI's status, what is
missing. The editor checks as you type (in the supplier's language). Three ways to fill in:

- **By hand** — allergen buttons, ingredients and storage per language, nutrition, diets, certificates.
- **Spreadsheet** (*Import from a spreadsheet*) — the FIRINGI template (one column per allergen: `contains /
  may contain / free` in several languages, `ingredients_pt`, `energy_kj` …) or **GS1 / GDSN-style** headers
  (`allergen:AW` with `CONTAINS / MAY_CONTAIN / FREE_FROM`, `nutrient:ENER-KJO`, `ingredientStatement:pt` …).
  Preview first; rows become drafts, complete ones can go to FIRINGI at once. Max 2 000 rows.
- **AI from the label photo** — the AI assistant's model reads the photo and fills in a **draft** (never published
  directly), noting what it was unsure of; one forced tool call, validated before anything is saved. Without an
  API key it is unavailable (in development / browser tests a clearly marked simulated reading stands in).

*Send to FIRINGI* needs every required field. A rejected version comes back with FIRINGI's note.

## FIRINGI

- *Catalogue › Food Info Review* — waiting versions, oldest first, flagged **new allergen** when a version adds
  one; the review page shows the label photo, files, certificates and the version **side by side** with what
  customers see now (changes highlighted). Approve, or send back with a note. With review switched off, a complete
  version is published at once.
- **Undeclared allergen** — from the review page, start a class I recall of a lot (Phase 25 Recalls: the lot is
  blocked and every buyer down the chain is told).
- *Catalogue › Food Data Quality* — completeness per supplier and category, products missing data, certificates
  expiring within 60 days, recipe changes and how many customers were told, and the category requirements.
- **Required to sell** (off by default) — food products without approved, complete information are hidden from
  customers (`Product.foodBlockedAt`, in the shared catalogue visibility rule). The quality page shows how many
  would be hidden before you switch it on.
- Daily job `food` (`/api/cron/food`): certificate reminders (30 / 14 / 7 days) to the supplier; the gate re-checked.

## Customers

- **Product page** — allergens (contains / may contain / free), ingredients in their language (or the nearest
  one, with a note), nutrition table, diets with certificates, origin, storage, shelf life, "recipe changed on …".
- **Badges** on product cards (contains …, vegan …) and a **filter** — *free from* any allergens (no contains, no
  may-contain) and a diet; only products with approved information are shown when filtering.
- **Recipe-change alerts** — when an approved version changes allergens, ingredients or claims, the customers who
  bought the product within `alertDays` (365) are told (`food.recipe_changed`) and see it under *Catalogue ›
  Allergens & Food Info*.
- **Kitchen allergen profile** (off by default; for restaurants) — the allergens the kitchen must avoid; products
  with them are flagged on the product page and in the cart (a warning, not a block), optionally hidden from the
  catalogue; a recipe change adding one is marked urgent.

### For resellers to inform their own customers

- **Allergen book (PDF)** — everything the customer buys × the 14 allergens, then each product's ingredients, in
  the customer's language (DejaVu Sans, so every letter of the 25 languages prints).
- **Shelf labels with QR (PDF)** — contains / may contain / diets per product and a QR code to the **public product
  page** `/food/{productId}?lang=xx`: no login, no prices, no supplier — only approved information, in the
  shopper's language (`?lang=` or the browser's).
- **Export (CSV)** — the food data of everything it buys, for its webshop or till (`;` separated, UTF-8 BOM).

## Notifications

`food.review` (FIRINGI), `food.decided` (supplier), `food.recipe_changed` (customers), `food.cert_expiring` (supplier).

## Tests

`tests/unit/food.test.ts` (completeness, checks, requirements, settings, recipe diff, import parsing),
`tests/integration/food.test.ts` (supplier → FIRINGI, filters and badges, recipe change and profile, required to
sell, review off, FIRINGI/GS1 import, AI reading validated, reseller outputs, certificates, rights), browser
`tests/e2e/food-info.mjs`. Screenshots `docs/screenshots/fi-*.png`.
