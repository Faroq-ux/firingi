# Storefronts (Phase 61)

A wholesaler (or distributor) gets its own branded page on FIRINGI. It uses it to bring its existing customers in:
- a link `/s/<name>`;
- a QR code to print on invoices, vans and the counter.

Prices stay behind sign-in, and FIRINGI still invoices every order.

## What the page shows

The public page `/s/<name>` needs no sign-in:

- **Branding:**
  - logo and banner picture;
  - accent colour (one of FIRINGI's brand-safe colours);
  - name, tagline, city and country, and the number of products.
- **Delivery:** the same rules checkout uses, so the page and the cart always agree. All amounts exclude VAT.
  - *Wholesalers* (customers buy from them):
    - minimum order = FIRINGI's minimum for the country;
    - **free delivery from** = the wholesaler's free-delivery minimum (or FIRINGI's free delivery when it is on and lower);
    - **below that** = FIRINGI's delivery fee.
  - *Distributors* (wholesalers buy from them):
    - free delivery from the distributor's minimum (amount or units);
    - its own flat rate below it, or the minimum as a hard minimum when it has no flat rate.
- **Current offers:**
  - the supplier's automatic promotions that apply to everyone (% off, € off per unit, € off the order, free delivery, buy X get Y), with the products, minimums and end date;
  - its live clearance deals (kind, product, end date, best-before).

  Coupons and offers made for chosen customers (customer groups, single businesses, CRM segments) are never shown.
- **Products:** featured first, then the rest (up to 24), as name, brand, pack and picture. Never prices. The supplier, or FIRINGI for everyone, can hide products from visitors who aren't signed in.
- **Buttons:**
  - *Register your business to order* opens `/register/customer?store=<name>` (or `/register/wholesaler` for a distributor's store).
  - *Already a customer? Sign in* signs in, then opens the store in the shop.
  - A signed-in buyer sees *Open the store and order* instead.

Visits are counted per day (the owner's and FIRINGI's previews are not). The owner and FIRINGI can preview a store that isn't public.

## Registrations from the link

A business that registers from a store's link is **linked to that store**. This happens once, only for the matching account type, and only while the store is published.
- The store is told, and the sign-up is counted.
- After approval, the customer sees **Your wholesaler** at the top of *Shop › Suppliers*.
- The supplier sees the businesses that joined from its link, how many are approved, and their orders and amount.

## In the shop

On a supplier's page in the shop (`/buy/catalogue/suppliers/<id>`), signed-in buyers see the same delivery terms and current offers, and the storefront's banner, logo, tagline and about text when the store is published.

## Who does what

| Who | Where | What |
|---|---|---|
| Supplier | *Company › Storefront* (`/vendor/company/storefront`, 25 languages) | Edits the link name (unique; 3–40 letters, numbers and dashes; reserved words refused), tagline, about text, colour, featured products (up to FIRINGI's maximum) and "show products to visitors". Uploads a logo and banner (JPG, PNG or WEBP, checked by content). Publishes or takes the page offline. Gets the link, the QR code (download), results for the last 30 days, and the businesses that joined. |
| FIRINGI | *Vendors › Vendor Management › Storefronts* (`/admin/vendors/storefronts`, English) | **Settings:** storefronts on/off, approval before the first publication, products shown to visitors, maximum featured products. **Stores:** approve or refuse (with a reason) the first publication, suspend (with a reason) or restore any store. Also shows visits, sign-ups and the businesses joined per store. |

Statuses:
- **Not published:** visible to the owner and FIRINGI only.
- **Waiting for FIRINGI:** the first publication, when approval is on.
- **Published.**
- **Suspended by FIRINGI:** gone from public view; the supplier can't publish it again until FIRINGI restores it.

Once approved, a store can be taken offline and published again without a new approval.

Notifications:
- `storefront.review` to FIRINGI;
- `storefront.decided` to the supplier (approved, not approved, suspended);
- `storefront.signup` to the supplier when a business registers from its link.

## Tests

- `tests/unit/storefront.test.ts`: link names, settings, which account type registers where.
- `tests/integration/storefront.test.ts`:
  - save, publish, approve;
  - the public page's delivery terms match the delivery rules;
  - public offers only;
  - shop branding;
  - visits and registrations from the link;
  - suspend and restore, switches, rights.
- `tests/e2e/storefront.mjs`: the browser flow, including logo and banner upload, approval, the visitor's page, opening the store in the shop, suspend and restore, phone width and dark mode.
