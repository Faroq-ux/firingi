# Customer assortments (Phase 64)

A supplier decides what each customer can see and buy from it, and which products a customer should always carry.

## Who does what

| Who | Right | Pages |
| --- | --- | --- |
| Supplier | `vendor.pricing.manage` to make lists (`vendor.products.view` to look) | *Products › Customer Assortments* (+ each list) |
| Sales rep | `vendor.reps.field` | Customer card: *Must-stock not ordered lately* |
| Customer | `buyer.orders.view` / `buyer.orders.place` | *Orders › Must-Stock List* |
| FIRINGI | `admin.vendors.view` / `admin.settings.manage` | *Vendors › Customer Assortments* (English) |

Supplier and customer pages are in 25 languages. The customer page only shows once the customer has a must-stock list.

## Kinds of list

A list is for **all the supplier's customers**, **one of its customer groups** (the same groups as its price lists), or **one customer**.

| Kind | Effect |
| --- | --- |
| **Approved list** | The customers it covers see **only** the products on the supplier's approved lists for them. Items can be marked **must-stock**. |
| **Hidden items** | The customers it covers **don't** see the products on the list. |
| **Must-stock list** | Products the customers should always carry. What they can see doesn't change. |

How lists combine:

- Approved lists add up: a customer covered by two approved lists sees the products of both.
- Hidden items win over approved lists, unless **that customer's own list** has the product. The most specific list wins.
- Must-stock products are always visible to that customer, even when they're not on an approved list (and never when hidden).
- Inactive lists don't apply. Lists only change what this supplier shows; other suppliers are untouched.

Products can be added by search, or by **pasting SKUs** (the supplier's own or FIRINGI's). Unknown SKUs are listed back. A supplier may sell one product in several packs under the same SKU: pasting the SKU adds every pack; when searching, choose the packs to add.

**See it as a customer:** choose a customer to see how many of the supplier's products it can see, how many are hidden, and how many are must-stock.

## Every channel follows the lists

The rules live in the catalogue's single visibility filter (`visibleOfferWhere`, fed by `buyerAssortment`). So everything that shows or prices products for a customer follows them:

- the shop, search, the supplier's store, sponsored products and deals;
- the cart, checkout, quotes, recurring orders and order lists;
- sales reps' product lists, van sales prices, WhatsApp ordering and the API;
- FIRINGI's routed orders (allocation).

A product a customer can no longer see can't be added to its cart. If it's already in a cart, checkout refuses it ("no longer available").

## Must-stock for the customer

- *Must-Stock List* shows each supplier's must-stock products, the price and when the customer last ordered each one.
- Products not ordered for **30 days** (FIRINGI's setting, 7–365) are marked *Not ordered lately*.
- **Add the missing ones to the cart** puts them in at their minimum quantity, per supplier or all at once.
- A **weekly reminder** (job `assortments`, hourly; at most once a week per customer) tells the customer how many must-stock products are waiting. FIRINGI can switch it off.
- The supplier's **sales rep** sees the customer's must-stock gaps on the customer card.

## FIRINGI's switches (*Vendors › Customer Assortments*)

| Setting | Default |
| --- | --- |
| Assortments on/off | on |
| Off for a single supplier (its lists are ignored) | — |
| Kinds of list allowed (approved / hidden / must-stock), each on/off | all on |
| A must-stock gap after (days) | 30 |
| Weekly reminders to customers | on |

The page lists suppliers with their lists (by kind, active) and the reminders sent.

## Technical notes

- Schema: `prisma/schema/assortments.prisma`.
  - `Assortment`: kind, target, active.
  - `AssortmentItem`: offer, must-stock.
  - `MustStockReminder`: last weekly reminder per customer.
- Rules: `src/lib/assortments.ts` covers:
  - `resolveRules`: approved, hidden and must-stock;
  - gaps;
  - pasted SKUs;
  - settings.
- Service: `src/server/assortments/service.ts`. Actions: `src/server/actions/assortments.ts`.
- `BuyerScope.assortment` (`onlyVendorIds`, `allowedOfferIds`, `hiddenOfferIds`) is added to the visibility filter in `src/server/catalogue/visibility.ts`.
- Notification: `assortment.gaps` (customer). Job: `/api/cron/assortments`.
- Tests:
  - `tests/unit/assortments.test.ts`;
  - `tests/integration/assortments.test.ts`;
  - browser: `node tests/e2e/assortments.mjs [baseUrl] [screenshotDir]`.
