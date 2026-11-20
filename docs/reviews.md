# Product reviews & questions (Phase 53)

Businesses that **received** a product review it; others decide with that. Suppliers reply once, in public, and see
what buyers praise and complain about. Questions are answered by the supplier and FIRINGI (marked **official**) and by
businesses that bought the product. Everything publishes at once; an automatic filter and reports send posts to
FIRINGI, who publishes them or hides them with a reason.

## Who does what

| Who | Where | What |
|---|---|---|
| Buyer (customers, wholesalers buying from distributors) | product page (*Reviews*, *Questions & answers*) | stars (1–5), detail scores (quality, value for money, packaging, freshness & shelf life), text, up to 3 photos, "show our business name" (else *Verified buyer · type*); edit or delete; "Helpful"; report; ask; answer as a verified buyer |
| Buyer | **My Reviews** (`/buy/reviews`, *Orders*) | products delivered and not yet reviewed, our reviews (status, FIRINGI's reason when hidden, the supplier's reply), our questions and their answers |
| Supplier | **Reviews** (`/vendor/reviews`) | all reviews of its products (filters: not replied, 1–2★, waiting for FIRINGI); **one public reply** per review (can be corrected) |
| Supplier | **Product Questions** (`/vendor/reviews/questions`) | questions asked on its offers; answers show as **official** |
| Supplier | **Review Insights** (`/vendor/reviews/insights`) | average, count, last 90 days, reply rate, open questions; 12-month trend; star distribution; detail averages; **common complaints** (3★ and below: damaged, short date, taste, size / weight, packaging, price, temperature, missing — 8 EU languages + low detail scores); per product with the change against before |
| FIRINGI | **Review Moderation** (`/admin/reviews`) | *Waiting* (held by the filter or reports), *Reported*, *Hidden*, *All*; reviews, replies, questions, answers; publish, or hide with the reason the author is told |
| FIRINGI | **Reviews Overview** (`/admin/reviews/overview`) | totals, average, last 30 days, unanswered questions, lowest / highest rated (with the supplier — FIRINGI only) |
| FIRINGI | **Settings › Reviews & Questions** | every switch below and per business |

Permissions: `buyer.reviews.write` (Purchaser role), `vendor.reviews.manage` (Sales Manager), `admin.reviews.moderate`
(Operations, Sales, Support). Company administrators have them all.

## Rules

* **Verified purchase only:** a review needs a delivered order of the product with a delivered quantity. One review
  per product, supplier and business; editing keeps the same review (marked *edited*). In FIRINGI ordering mode
  (the supplier is hidden) it is one per product and ratings are shown per product across suppliers.
* **The filter** (FIRINGI switches each check): contact details (e-mail, "name at gmail dot com", phone numbers of 9+
  digits, WhatsApp / social handles), links, insults (a built-in list in the main EU languages, accents ignored),
  competitor names and other words FIRINGI lists. Caught posts wait for FIRINGI; the author sees why.
* **Reports:** anyone signed in, once per business, with a reason. After *N* reports (default 3, 0 = never) the post
  waits for FIRINGI. Hiding needs a reason; the author is told; open reports are closed.
* **Totals** count published reviews only, of suppliers whose reviews show. Hidden or held reviews don't count.
* **Photos:** JPG / PNG / WEBP checked by content; a published review's photos are visible to signed-in users, a held
  or hidden one's only to the author, the supplier and FIRINGI.
* **Supplier names are never shown to buyers in FIRINGI mode**; replies are labelled *Reply from the supplier*.
  Commission and payout never appear anywhere in reviews.

## Search

Stars and the count on every product card; **"4★ and up"** and **"Best rated"** on the shop, category and supplier
pages (unrated products last). FIRINGI can switch *stars in search* off.

## Reminders

Daily job `reviews` (`/api/cron/reviews`, 10:17 UTC): orders delivered *N* days ago (default 3; a 7-day window, so
old orders are never chased) — "How was …?" by e-mail / push to the person who ordered, **once per product, supplier
and business**, never for something already reviewed.

## AI summary

With the Anthropic key (AI Centre), a product with at least *N* reviews (default 3) gets a 2–4 sentence neutral summary
in the reader's language — no names, contacts or prices. It is fetched after the page shows (the page never waits),
cached per language and cleared when a review changes. Without a key: no summary. In development / browser tests
(`ASSISTANT_SIMULATE=1`) a clearly marked simulated summary stands in. Logged in *AI Centre › Activity*.

## FIRINGI's switches

On / off; who may write (customers, wholesalers); whose products show reviews (wholesalers', distributors'); parts
(reviews, detail scores, photos, helpful votes, questions, buyers answer, supplier replies, insights, reminders, stars
in search, AI summary); photos per review (0–3); longest text; days a review can be edited (0 = always); reminder
delay; reviews before an AI summary; the filter's checks and word lists; reports that hold a post. **Per business:**
Default / Always on / Off — a buyer switched off can't write, ask or answer and loses *My Reviews*; a supplier switched
off has no reviews shown on its products and loses its review pages.

## Notifications

`review.received` (supplier), `review.question` (supplier), `review.reply` (reviewer), `review.answered` (asker),
`review.reminder` (buyer), `review.hidden` (author), `review.to_moderate` (FIRINGI moderators).

## Tests

`tests/unit/reviews.test.ts` (filter, totals, complaints, trend, settings), `tests/integration/reviews.test.ts`
(verified purchase, edit, photos, filter → FIRINGI, votes, reply, reports → hide, Q&A roles, switches, card stars and
"4★ and up", insights, reminders once, AI summary cache), `node tests/e2e/reviews.mjs` (as buyer, supplier and FIRINGI;
phone + dark).
