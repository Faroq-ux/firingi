# Smart product search (Phase 72)

Customers' product search (`/buy/catalogue/search`, also the shop's search, the Assistant's product search, the command
palette and scan-to-reorder) finds products despite typos, missing accents and other languages, understands plain
sentences with AI, and offers filters.

## Matching

- Every search word — or one of its synonyms — must appear in the product's search text (`Product.searchText`: names
  in every language, brand, SKUs, barcodes).
- Accent-insensitive (`água` = `agua`) and, with **typo-tolerant matching** on, small typos are accepted
  (`mozarela` → mozzarella): PostgreSQL `pg_trgm` word similarity on `firingi_unaccent("searchText")`, indexed
  (`Product_searchText_trgm`, GIN). How close a typo must be: loose / normal / strict.
- Ranked: whole-word matches first, then substring, then similarity.
- Nothing has every word → products with most of the words, with a note ("partial").
- A barcode (8–14 digits) still matches exactly; a single letter falls back to plain "contains".

## AI reads the search

- Once per new query (cached 30 days in `SearchUnderstanding`), Claude returns via a forced tool call:
  - the product words, corrected, each with alternatives in many EU languages (tomate → tomato, pomodoro, …);
  - filters the buyer asked for: allergens to avoid, a diet, a maximum price, deals only, sort order;
  - a corrected query ("Did you mean …").
- The answer is validated with zod; a bad answer, a timeout (8 s) or no AI → the search simply runs on the words.
- The filters the AI understood are applied only where the buyer set none, and shown as chips. Removing a chip
  keeps the others as the buyer's own and switches the AI's filters off (`aif=0`); "Search only my words" too.
- The AI's word lists are learnt as synonyms (source AI), so later searches benefit even without AI.
- Stopped by AI Governance's master switch like every Claude call; logged in the AI activity log (kind `SEARCH`).
- Development / browser tests (`ASSISTANT_SIMULATE=1`, no key): a small built-in dictionary and filter phrases
  stand in, marked "simulated".

## Synonyms

- `SearchSynonym`: a word and the words that mean the same; matched both ways.
- FIRINGI's own rows (source ADMIN) are never changed by the AI; any row can be hidden ("Not used") or deleted.

## Filters on the search page

Sort (best match, lowest price, best rated, nearest supplier), category and supplier (from what matched, with counts),
maximum price per item (incl. VAT, the buyer's currency), deals and promotions only, rating, allergens to avoid and
diet (when food information filters are on).

## FIRINGI's switches

*Catalogue › Smart Search* (`/admin/catalogue/search`, English; `admin.catalogue.manage`, view with
`admin.catalogue.view`), Setting `search.settings`:

| Switch | Off means |
|---|---|
| Typo-tolerant matching (+ how close) | the text must appear exactly (still accent-insensitive) |
| AI reads the search | words and synonyms only |
| Synonyms | neither FIRINGI's nor learnt synonyms are used |
| Filters and sorting | no filter panel; the AI's filters are not applied |

## Code

- Rules: `src/lib/search.ts` (normalising, words, URL filters, AI answer schema).
- Server: `src/server/search/service.ts` (settings, synonyms, AI reading, `matchProducts`).
- Catalogue: `productMatch` and `searchAcrossSuppliers` in `src/server/data/catalogue-buyer.ts`.
- Pages: `src/app/buy/catalogue/search/page.tsx`, `src/components/search/views.tsx`;
  admin `src/app/admin/catalogue/search/page.tsx`, `src/components/search/admin.tsx`.
- Actions: `src/server/actions/search.ts`.
- Migration `20270901120000_phase72_search` (extensions, `firingi_unaccent`, index, tables).
- Tests: `tests/unit/search.test.ts`, `tests/integration/search.test.ts`, `tests/e2e/search.mjs`.
