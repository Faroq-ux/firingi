# Till / POS (Phase 47)

A till for **suppliers' counters** (cash & carry: distributors and wholesalers selling from their own stock) and for
**wholesale customers' own shops and restaurants** (selling to their guests). A till sale is the **business's own
sale**: the business issues the receipt, not FIRINGI (FIRINGI keeps invoicing every FIRINGI order as before).

It runs in the browser of any phone, tablet, Android POS terminal or PC; receipts print on any printer the device
can use (80 mm receipt printers included), or go by e-mail / QR.

## FIRINGI decides (admin › Till (POS))

| Switch | Where |
|---|---|
| Till on/off for FIRINGI | Till Settings |
| Per company type: distributors, wholesalers, wholesale customers | Till Settings |
| Per country: on/off, **receipts non-fiscal or via a certified provider**, which provider, "non-fiscal meanwhile" | Till Settings |
| Features: offline selling, weighed items / scale labels, cash & shifts, card, MB WAY, loyalty, recipes, tables, kitchen tickets, e-mail receipts, accounting, age check | Till Settings |
| Offline limits (hours without reaching FIRINGI, sales waiting) | Till Settings |
| **Per company**: follow its type / always on / off | Till per Company |
| Tills a business may open without approval; approve / refuse each further till | Till Settings, Till per Company |

Suppliers sell from *Sell › Till (POS)* (`/vendor/pos`), wholesale customers from *Buy › Till (POS)* (`/buy/pos`).

### Receipts per country — two stages

- **Non-fiscal** (default everywhere): the till sells, keeps stock, cash, reports and accounting; each receipt says
  *"Not a fiscal document"* and the business gives the legal receipt from its own certified till / fiscal printer.
- **Certified provider**: each receipt goes to the business's **own account** with the provider FIRINGI chose for
  the country — *Moloni* (Portugal), a *certified cloud fiscalisation service* (TSE, RKSV, Verifactu, RT, NF525 …) or
  the business's *fiscal printer / online cash register* through a local bridge. Online, the legal number comes back
  with the sale and is printed; offline / during an outage the receipt is provisional and the number follows on the
  receipt page (QR). Retries with back-off (1 min … 8 h, 8 tries), then *Refused* + an alert to the business; FIRINGI
  sees the queue under *Till Receipts Queue*. A business that hasn't connected its account can't sell unless FIRINGI
  ticked "non-fiscal meanwhile". The provider secret is stored encrypted (AES-256-GCM, `POS_SECRET_KEY`).

  The provider adapters run **simulated** (`POS_FISCAL_SIMULATE=1`, always in tests): a live connection needs
  FIRINGI's agreement with each provider and is refused with a clear message until then.

## Shops, warehouses and their own tills

- A business can run **several tills**: each **shop** (wholesale customers: e.g. a grocery and a restaurant, the
  shops of Phase 27) or **warehouse** (suppliers: the till takes stock from it) has its own tills.
- **Approval**: the first tills (admin setting *Tills a business may open without FIRINGI's approval*, 1 by default)
  are ready at once; each further till **waits for FIRINGI** (*Till per Company › Extra tills waiting for approval*,
  approve or refuse with a reason; both sides are notified). A waiting or refused till can't sell.
- **People per till**: the owner chooses who uses each till — **cashier** or **shop manager**. A till with nobody
  chosen is open to everyone with the till right (staff limited to some shops only in their shops); someone given
  particular tills uses only those. A shop manager approves that till's refunds, discounts and cash out (their PIN
  works only on the tills they manage) and sees that till's sales and reports; the owner sees everything.
- **Adding staff** (*Till Staff*): the **owner** and each **shop manager** add employees themselves — name, e-mail,
  a first password (at least 10 characters, changed after signing in) and the tills. A shop manager adds **cashiers**
  for the tills they manage only; the owner adds cashiers or **shop managers** for any till. The new login gets the
  system role **Cashier**; being shop manager is per till, so a shop manager never manages the other shops' tills. The
  plan's user limit applies; an e-mail already in the company is only put on the tills (an e-mail of another company
  is refused). A shop manager takes cashiers off their tills; only the owner changes shop managers; removing someone
  from the company stays under *Team*. Everything is in the audit log (`pos.staff.add`, `pos.staff.remove`).
- **Revenue at all times**: the owner and shop managers see on the till overview the **revenue of the tills they
  manage** — today, last 7 days, this month, this year and **all time** (sales minus refunds, VAT included, since the
  first sale) — in total and **per till / shop**. Cashiers don't see it.
- **The receipt address is fixed**: a till prints its own address (else the head office). Once it has issued a
  receipt, that address can't be edited or removed and the till's address can't change — a new address means a new
  till (Phase 47d).
- **Items per till**: an item can be sold at chosen tills only (the grocery's bread, the restaurant's dishes) or at
  all of them.
- **Accounting per shop and till**: each day's sales go into Accounting per till — and so per shop — as cash, card
  and other (`Till sales <day> — <till> — cash`), with the shop on each entry; reports show *By shop / till*.

## The till

- Tap items (categories, search), **scan** barcodes, **scale labels** (EAN-13 with weight, prefixes 28/29) and
  loyalty cards; **weighed items** by kg; line and sale discounts — above the business's limit a **manager's PIN**
  (checked on the device, so it also works offline).
- **Payments**: cash (tendered, change), card (terminal reference), MB WAY (Portugal), loyalty points, other; split
  payments. Alcohol / tobacco asks for the **age check**.
- **VAT per item**: every receipt (printed, on screen, the QR page and the e-mail) shows each line's VAT rate (the QR
  page and the sale also its VAT amount), a **VAT summary** per rate (base, VAT, total), *Total excl. VAT*, *Total VAT*
  and the total — so the customer sees exactly which VAT each item carries.
- **The customer's NIF, when the customer asks**: the cashier taps **Customer NIF** on the ticket (or types it when
  paying) — with the customer's name if wanted. A Portuguese NIF is checked digit by digit as it is typed; other
  countries' numbers (with or without their VAT prefix) get a format check; `999999990` (final consumer) means no NIF.
  A wrong NIF can't be used online; a sale made offline keeps what was printed. **After paying**, the NIF can still
  be added — on the receipt screen or the sale's page — while the receipt **isn't certified yet** (non-fiscal stage,
  or not yet accepted by the provider); a certified receipt is refunded and sold again with the NIF. Audited
  (`pos.sale.tax_id`).
- **E-mail** receipt; **QR** to the receipt page (`/r/<token>`, no login).
- **Tables / tabs** kept open across devices, **kitchen tickets** for new kitchen items.
- **Shifts**: open with the cash float, **X report** any time, cash in / out (out needs a manager), open drawer,
  **close with the counted cash → Z report** (sales minus refunds by payment, VAT rate and cashier; cash expected,
  counted, difference).
- **Offline**: the till keeps a snapshot on the device and keeps selling without internet (also from the phone
  app's offline page); sales are numbered on the device per shift (`C1-0012-0034`) and sent when back online —
  stored once each. It stops after FIRINGI's offline limits.
- Every receipt carries a **hash chain** per till (each receipt's hash covers the previous one).

## Stock

- **Suppliers**: *Fill from my products* creates till items from their own offers (retail price = price list + VAT,
  barcode, scale code, age and allergen flags). A sale takes the product **FEFO** from the till's warehouse
  (fractions of a pack add up first); a refund can put it back.
- **Restaurants**: each dish has a **recipe** made of products bought on FIRINGI (kg / pieces / packs per portion).
  Selling a dish marks the purchased packs used, oldest expiry first. *Ingredient Stock* shows packs left, use per
  day, days left and the next expiry, with **Add to cart** to reorder.

## Loyalty (the business's own)

A loyalty card for the business's guests (consent recorded): points per currency unit spent, value per point,
minimum to pay with points. Points paid with points earn none; a refund takes earned points back.

## Accounting and the accountant

- **Daily, automatically**: each day's till sales go into the company's **Accounting** (*Daily Sales*) as **cash**,
  **card** (MB WAY included) and **other**, by VAT rate, refunds taken off — at shift close and every night over the
  last 7 days (so offline sales sent late still count). Never posted twice. The business can switch it off.
- **Monthly accountant pack** (Phase 46): a third side, *Your till sales*, with day totals by VAT in the PDF and
  `xml/till/till-sales-YYYY-MM.xml` with every receipt (lines, VAT, payments, legal numbers, hashes). Admin switch
  *Till sales (POS)* in E-Invoicing Settings.

## Rights

`company.pos.sell` (sell, shifts, own sales) and `company.pos.manage` (items, recipes, tills, loyalty, provider,
PINs, refunds, discounts, reports). System roles **Cashier** and **Shop Manager**; company administrators have both.

## Jobs

`/api/cron/pos` every 5 minutes (waiting receipts to providers), `/api/cron/pos-daily` daily (till sales into
accounting).
