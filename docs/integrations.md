# FIRINGI integrations — developer guide

Everything a supplier's or buyer's developer needs to connect an ERP, shop or till to FIRINGI.
The same reference, with the company's own addresses, is in the portal: **Company › Integrations › API reference**.

## 1. API v2 in five minutes

1. In the portal, **Company › Integrations › API keys**: give the key a name, tick only what it
   needs, *Create key*, copy it (shown once).
2. Call the API with it:

```bash
curl -H "Authorization: Bearer $FIRINGI_KEY" https://<your-firingi-host>/api/v2/me
```

| Scope | Who | What it allows |
|---|---|---|
| `catalogue.read` | buyers | `GET /catalogue` — what you can order, at your prices |
| `orders.read` | both | `GET /orders`, `GET /orders/{id}` |
| `orders.write` | both | buyers `POST /orders`, `GET /addresses`; suppliers `POST /orders/{id}/confirm`, everyone `POST /orders/{id}/status` |
| `offers.write` | suppliers | `GET /offers`, `POST /offers/sync` |
| `invoices.read` | both | `GET /invoices`, `GET /invoices/{id}/pdf` |

- A key acts as the person who created it and can never do more than that person may do today.
- Money is a string: 2 decimals (unit prices 4), **net of VAT** unless the field says gross.
- Errors: HTTP status + `{ "error": { "code": "…", "message": "…" } }` (e.g. `MISSING_SCOPE`, `VALIDATION`
  with `issues`, `BIG_CHANGES`, `CART_NOT_EMPTY`, `OUT_OF_STOCK`, `RATE_LIMITED`).
- At most **120 calls per minute per key** (`X-RateLimit-Limit`, `X-RateLimit-Remaining`, `Retry-After`).
- Machine-readable description: `GET /api/v2/openapi.json` (OpenAPI 3.1).

### Suppliers: keep prices and stock in sync

```json
POST /api/v2/offers/sync
{ "rows": [ { "vendorSku": "GRO-LUSO15", "priceNet": 2.45, "stock": 120 },
            { "vendorSku": "GRO-MOZZ2", "gtin": "5601000000608", "stock": 900, "warehouse": "Armazém Lisboa" } ],
  "dryRun": false, "confirmBigChanges": false }
```

Rows match by your code (`vendorSku`) or the barcode (`gtin`); a code you use on several pack sizes
needs the barcode. Only what you send changes. A price moving more than 50 % is refused with
`409 BIG_CHANGES` until you send `confirmBigChanges: true`. `dryRun: true` answers what would change.
Each sync appears in *Products › Import & Sync › History*.

### Buyers: order from your own system

```json
POST /api/v2/orders
{ "lines": [ { "offerId": "<from GET /catalogue>", "qty": 30 } ], "requestedDeliveryDate": "2026-11-20", "notes": "PO 4711" }
```

The order goes through exactly the same checks as in the portal (your suppliers, minimums, credit,
delivery). It is refused with `409 CART_NOT_EMPTY` while the key's user has products in the
portal cart (so the two never mix).

## 2. Webhooks

*Company › Integrations › Webhooks*: your https address and the events you want. FIRINGI POSTs:

```json
{ "id": "<delivery id>", "event": "order.created", "createdAt": "2026-11-11T09:50:12.000Z",
  "data": { "orderId": "…", "number": "FO-2026-000123", "status": "PENDING_CONFIRMATION", "previousStatus": "NEW", "reason": null } }
```

Fetch details with the API (`GET /api/v2/orders/{orderId}`). Answer any 2xx within 10 s. Otherwise
FIRINGI retries after 1 min, 5 min, 30 min, 2 h, 6 h and 24 h; after 20 failures in a row the
webhook is switched off and you are told. Use `X-Firingi-Delivery` to ignore repeats.

**Check the signature** (`X-Firingi-Signature: t=<unix>,v1=<hex>`), with the secret shown when you added the webhook:

```js
import { createHmac, timingSafeEqual } from "node:crypto";
function verify(header, rawBody, secret) {
  const [, t, v1] = /t=(\d+),v1=([0-9a-f]+)/.exec(header) ?? [];
  if (!t || Math.abs(Date.now() / 1000 - Number(t)) > 300) return false;
  const expected = createHmac("sha256", secret).update(`${t}.${rawBody}`).digest("hex");
  return v1.length === expected.length && timingSafeEqual(Buffer.from(expected), Buffer.from(v1));
}
```

| Event | Sent to |
|---|---|
| `order.created` | supplier — a new order to confirm (only once FIRINGI releases it) |
| `order.placed` | buyer — order placed (also when FIRINGI moved it to another supplier) |
| `order.status_changed` | both |
| `invoice.issued` | buyer |
| `payment.received` | buyer |
| `payout.sent` | supplier |

## 3. Files (Import & Sync)

Excel (`.xlsx`, first sheet) or CSV (`;` `,` tab or `|`; UTF-8; decimal comma or dot), up to
10 MB / 5000 rows. Columns FIRINGI understands (any names — they are matched in the preview):

| Field | Examples of headers it recognises |
|---|---|
| your product code | Referência, Ref, SKU, Código, Artigo |
| barcode | EAN, GTIN, Código de barras |
| price (net) | Preço, Preço s/ IVA, Price, Precio, PVP |
| stock | Stock, Quantidade, Existências, Qty |
| warehouse | Armazém, Almacén, Warehouse (default: your first warehouse) |
| minimum / step / lead time | Mínimo, MOQ · Múltiplo · Prazo, Lead time |
| for sale | Ativo (sim / não) |

A **feed** is the same file published at an https address; FIRINGI fetches it every 1–168 hours
and holds a run for your check when prices move more than 50 % or more than 20 % of rows are wrong.

## 4. Accounting export (FIRINGI finance)

*Finance › Accounting Export* — documents or balanced journal entries for a date range, in the
PHC, Primavera or Sage column layouts, Excel or CSV. The chart of accounts (SNC defaults) and the
journal codes are editable. **Import templates differ between program versions and set-ups: have
the accountant confirm the columns and accounts before the first import.** The Portuguese tax file
is the SAF-T (*Invoices › SAF-T*), not this export.
