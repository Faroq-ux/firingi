# Menu costing & food waste (Phase 54)

For restaurants and shops (customers; wholesalers with their own kitchen when FIRINGI allows it), in the buyer portal
under **Kitchen**: what each dish costs from what the business actually paid on FIRINGI, food cost % and margin
against a target, the price that hits it, menu engineering, and a phone-first waste log with reports, suggestions and
donations.

## Pages (buyer portal › Kitchen)

| Page | Who | What |
|---|---|---|
| **Kitchen Overview** (`/buy/kitchen`) | managers; staff see a link to the waste log | ingredients, dishes, average food cost (green / red against the target), waste in 30 days and as % of purchases, use-first count; dishes over target with the suggested price; the business's own targets |
| **Ingredients** (`/buy/kitchen/ingredients`) | managers | cost per kg / litre / piece; **bought on FIRINGI** — one click from the list of products bought in the last year (what one pack holds is read from the pack name, e.g. "6 × 2kg" = 12 kg, and can be corrected), cost from the **last price paid** or the **average** (90 days); **by hand** for other suppliers; **yield %** (prep loss); allergens (from the product's approved food information, or set by hand); CO₂e per unit (from the product's footprint) |
| **Recipes & Costing** (`/buy/kitchen/recipes`, `/recipes/[id]`) | managers | dishes and **sub-recipes** (sauces, doughs, stocks — costed per kg / l / piece they make, used inside dishes); lines in g, kg, ml, l or pieces; cost per portion, **food cost %** (of the price without VAT), margin, own target; **suggested price** rounded to the house style — use it on the recipe or **on the till item**; allergens per dish (contains / may contain) — **copy to the till item**; CO₂e per portion; **import dishes from the till** (Phase 47 recipes become costed dishes) |
| **Menu Engineering** (`/buy/kitchen/engineering`) | managers | Kasavana–Smith matrix over 7 / 30 / 90 days from **till sales** (or a weekly estimate): **stars**, **plough-horses**, **puzzles**, **dogs**; **what if an ingredient gets X % dearer** — the dishes it pushes over target and the price that keeps each on target |
| **Waste Log** (`/buy/kitchen/waste`) | managers and staff (`buyer.kitchen.waste`: Purchaser, Cashier, Shop Manager, Kitchen Manager) | big buttons for the phone: **from a delivery** (a purchased lot — packs, its used quantity goes up), an ingredient, a dish (portions) or a sub-recipe, or anything typed; reason (expired, spoiled, over-production, plate waste, damaged, prep loss, other); cost, kg and CO₂e worked out; the last 14 days; the logger can take back their own entry the same day (a lot gets its packs back), managers any time |
| **Waste Reports** (`/buy/kitchen/waste/reports`) | managers | 7 / 30 / 90 days: cost, kg, CO₂e, **% of purchases against the target**, by reason, week by week, most wasted, donated kg |
| **Use First** (`/buy/kitchen/use-first`) | managers | purchased lots at or near their date (within *N* days) with the packs left, their value and the dishes that use them; **order less** — ingredients often thrown away because they expired, spoiled or were over-produced, with how much less to order |
| **Donations** (`/buy/kitchen/donations`) | managers and staff | food given to food banks, charities or staff, with the recipient and receipt number — kept apart from waste |

FIRINGI (English): **Analytics › Menu Costing & Waste** (`/admin/kitchen`) — businesses using it, recipes, waste and
donations in 30 days, by reason, the businesses wasting most; **Settings › Menu Costing & Waste**.

## Rules

* **Cost per unit** of a FIRINGI ingredient = price paid per pack (net, what the buyer paid — never the supplier's
  payout or FIRINGI's commission) ÷ what the pack holds. Any supplier's offer of the same product counts. Not bought
  yet: the catalogue price the buyer sees.
* **Line cost** = quantity in the ingredient's unit ÷ yield × cost (500 g at 80 % yield = 625 g bought). 1 kg = 1 l
  when units are mixed (marked ≈); pieces never convert.
* **Sub-recipe** cost per unit = batch cost ÷ what it makes; loops (A uses B uses A) are refused.
* **Food cost %** = cost per portion ÷ price without VAT. **Suggested price** = cost ÷ target, plus VAT, rounded up
  (none / 0.05 / 0.10 / 0.50 / ending .90).
* **Menu engineering:** popular = at least 70 % of an equal share of portions sold; profitable = margin at least the
  sales-weighted average margin.
* **Waste % of purchases** = waste cost ÷ net purchases on FIRINGI in the period.
* **Order less** after *N* waste entries in 30 days for expired / spoiled / over-production; cut = wasted share of
  what was bought, 5–50 %.

## Daily job

`kitchen` (`/api/cron/kitchen`, 05:23 UTC): recomputes every FIRINGI ingredient's cost; when one rises by at least the
alert % the business is told (`kitchen.cost_rise`); waste over the target this month — once a month
(`kitchen.waste_over`); lots at or near their date — once a day (`kitchen.use_first`).

## FIRINGI's switches

On / off; who uses it (customers, wholesalers); parts (menu costing, price suggestions, menu engineering, allergens,
waste log, waste reports, suggestions, donations, alerts); defaults each business can override (target food cost %,
waste target %, cost basis and averaging days, price rounding); alerts (cost rise %, use-first window, menu
engineering period, entries before "order less"). **Per business:** Default / Always on / Off.

## Tests

`tests/unit/kitchen.test.ts` (pack content, units, purchase cost, recipe costing with yield / sub-recipes / allergens /
CO₂, loops, rounding, what-if, menu engineering, waste summaries, order less, settings),
`tests/integration/kitchen.test.ts` (switches, cost from a real purchase, dishes and targets, loops refused, what-if,
engineering, waste from ingredient / dish / lot / text, donations, reports, suggestions, the job, import from the till),
`node tests/e2e/kitchen.mjs` (owner, staff on the phone in dark mode, FIRINGI).
