# Rewards shop (Phase 55)

Businesses (customers and wholesalers with loyalty on — Phase 32) spend their **loyalty points** in a shop. Five kinds
of reward, each switched on or off by FIRINGI:

| Kind | Who pays | What the business gets |
|---|---|---|
| **Voucher** | FIRINGI | a **single-use coupon only this business can use** (`RW-XXXXXXXX`): € off one order, optional minimum order, valid *N* days |
| **Free delivery** | FIRINGI | the same, as a free-delivery coupon |
| **Supplier product** | the supplier | the supplier's own product (*qty* units), **free in the cart on the next order from that supplier** — within *N* days (default 90) |
| **Gift / merchandise** | FIRINGI | sent by FIRINGI to one of the business's addresses; stock count; tracking |
| **Partner offer** | the partner | a **code from a pool** FIRINGI pasted in, shown right after redeeming (with the partner's link and terms) |

## Pages

**Buyer** (25 languages): **Rewards Shop** (`/buy/rewards/shop`) — points, € value, tier, monthly allowance left,
**saving for** a reward (progress bar), tabs per kind, cards with points, stock, and why one can't be redeemed yet
(points missing, tier, sold out, limit…); a reward's page (`/shop/[id]`) — terms, where to send a gift, **Redeem**,
the code at once; **My Rewards** (`/buy/rewards/mine`) — codes to copy, **Use in cart** (the coupon goes into the
cart), **Add to cart** (the free product), status (waiting for your next order / on order N / on its way +
tracking / used / expired), **cancel — points back**. The points page (`/buy/rewards`) links to the shop. In the
cart, free reward units show as "N free (reward)" (apart from Phase 48 bonus units).

**Supplier** (25 languages): **Reward Products** (`/vendor/products/rewards`) — choose one of its active products,
quantity, points (FIRINGI's min–max), how many it gives away, per-customer limit, lowest tier, end date; pause /
resume / end; FIRINGI's note when rejected. **Rewards to Hand Over** (`/vendor/products/rewards/handover`) — who
redeemed what, waiting for an order / on order N / delivered / expired; **can't give it** (with a reason the customer
sees — points back).

**FIRINGI** (English): **Marketing › Rewards Shop** (`/admin/marketing/rewards`) — numbers (redeemed and € value in
30 days, supplier rewards to accept, gifts to send, voucher discounts given, gift cost), low stock, every reward with
filters; **new** voucher / free delivery / gift / partner offer (texts in English, Portuguese, Spanish; picture;
countries; customers / wholesalers; tier; per-business limit; dates; featured); a reward's page — edit, picture,
partner codes (paste, duplicates skipped, remove unused), **accept / reject** a supplier's reward, pause / end, who
redeemed it. **Reward Redemptions** (`/admin/marketing/rewards/redemptions`) — gifts to send (address, note,
**shipped + tracking**, delivered), coupons, codes, supplier products; **cancel — points back**.
**Settings › Rewards Shop** — every switch below and per-business switches. The member page (Loyalty) shows
"Spent in the rewards shop" in the ledger.

## Switches (Settings › Rewards Shop)

* The shop on / off; each **kind** on / off.
* **Who redeems:** customers, wholesalers (loyalty must be on for the business too). **Who offers products:**
  distributors, wholesalers; **FIRINGI accepts supplier rewards first** (default on — changes of product, quantity
  or points go back for acceptance; stock, limits and texts don't).
* **Per business:** default (by type) / always on / off — buyers: redeeming; suppliers: offering products.
* Supplier points range (100–100,000), days to order a supplier product (90), voucher validity (60), reminder before
  a voucher expires (7 days), low-stock alert (5), **most points per business per month** (0 = no limit),
  **points back for vouchers that expire unused** (on), **businesses may cancel** unused vouchers and gifts /
  products not yet on their way (on).

## Rules

* Redeeming spends points from the ledger (`REDEEM_REWARD`, oldest first, the account row locked so the same points
  can't be spent twice); the reward row is locked too, so the last unit can't go twice. Any refusal (sold out,
  limit, tier, monthly, points) leaves nothing behind.
* **Voucher** = a FIRINGI promotion (100 % FIRINGI-funded, `maxRedemptions` 1, targeted at the business, valid
  until the expiry). It is used at checkout like any coupon; invoices, statements and payouts follow Phase 15.
* **Supplier product** = a free-goods grant like Phase 48: in pricing, up to *qty* units of that offer cost nothing,
  carried by the system promotion **"Reward (points)"** (`rewards-shop`) as a **supplier-funded** discount — the
  supplier's payout carries it, commission is charged only on paid units. The minimum order counts what is paid.
  A cancelled order gives the units back (a week more if they had expired).
* **Cancelled** (buyer, supplier or FIRINGI) → all the points back (a supplier product partly taken: the untaken
  share), stock / code back to the pool, a voucher's coupon ended. Partner codes are shown at once, so only FIRINGI
  can cancel them.
* Commission stays hidden from buyers; supplier payouts stay hidden from buyers.

## Daily job (`rewards`, 04:47 UTC)

Vouchers: used on a live order → *used*; order cancelled → open again; past their date → *expired* (points back
when FIRINGI says so) and the coupon ended; reminder *N* days before. Supplier products: every unit on delivered
orders → *delivered*; not ordered in time → *expired*, points and stock back. Rewards past their end date leave the
shop. Low stock → one alert (FIRINGI or the supplier) until restocked.

## Notifications

`rewards.supplier_redeemed` (supplier), `rewards.to_review` (FIRINGI), `rewards.approved` / `rewards.rejected`
(supplier), `rewards.gift_to_send` (FIRINGI), `rewards.gift_shipped`, `rewards.voucher_expiring`, `rewards.refunded`
(buyer), `rewards.low_stock` (FIRINGI or supplier).

## Tests

`tests/unit/rewards.test.ts` (rules), `tests/integration/rewards.test.ts` (switches, vouchers used / cancelled /
expired, supplier product free in the cart and on the order — supplier-funded — given back on cancel and delivered
with the next order, supplier cancel and expiry, gifts, partner codes, limits, goals, job, numbers),
`node tests/e2e/rewards.mjs` (FIRINGI, supplier and customer in the browser, phone in dark mode, switches).
