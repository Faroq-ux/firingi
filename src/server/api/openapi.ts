/**
 * OpenAPI 3.1 description of FIRINGI API v2 — served at /api/v2/openapi.json and rendered on the
 * Integrations › API page. Kept by hand next to the routes (src/app/api/v2).
 */
import { SCOPES } from "@/server/services/api-keys";
import { WEBHOOK_EVENTS } from "@/server/integrations/webhooks";

type Op = { method: "get" | "post"; path: string; scope: string | null; summary: string; who: "Buyers" | "Suppliers" | "Everyone"; body?: Record<string, unknown>; params?: { name: string; in: "query" | "path"; description: string }[] };

export const OPERATIONS: Op[] = [
  { method: "get", path: "/me", scope: null, who: "Everyone", summary: "Your company, the user the key acts as, and the key's permissions." },
  { method: "get", path: "/orders", scope: "orders.read", who: "Everyone", summary: "Orders you placed (buyers) or received (suppliers), newest first, 50 a page.",
    params: [{ name: "as", in: "query", description: "buyer | supplier (wholesalers are both)" }, { name: "since", in: "query", description: "ISO date — orders placed since" }, { name: "status", in: "query", description: "comma-separated statuses" }, { name: "page", in: "query", description: "page number" }] },
  { method: "post", path: "/orders", scope: "orders.write", who: "Buyers", summary: "Place an order. Same checks as the portal (minimums, credit, delivery). Refused while the key's user has products in their portal cart.",
    body: { lines: [{ offerId: "string", qty: 10 }], deliveryAddressId: "string (optional — default delivery address)", requestedDeliveryDate: "2026-11-20 (optional)", notes: "string (optional)" } },
  { method: "get", path: "/orders/{id}", scope: "orders.read", who: "Everyone", summary: "One order: lines, history, delivery, and nextStatuses (what you may move it to).", params: [{ name: "id", in: "path", description: "order id" }] },
  { method: "post", path: "/orders/{id}/confirm", scope: "orders.write", who: "Suppliers", summary: "Confirm an order — all lines as ordered, or less with quantities per line id.", body: { quantities: { "<lineId>": 8 } }, params: [{ name: "id", in: "path", description: "order id" }] },
  { method: "post", path: "/orders/{id}/status", scope: "orders.write", who: "Everyone", summary: "Move an order on (e.g. READY_FOR_PICKUP, DISPATCHED, DELIVERED, CANCELLED).", body: { status: "DISPATCHED", reason: "string (optional)" }, params: [{ name: "id", in: "path", description: "order id" }] },
  { method: "get", path: "/offers", scope: "offers.write", who: "Suppliers", summary: "Your offers: code, barcode, base price, stock, minimum, step, lead time." },
  { method: "post", path: "/offers/sync", scope: "offers.write", who: "Suppliers", summary: "Send prices / stock / minimums from your ERP (up to 5000 rows). Rows match by your code or the barcode. Prices changing by more than 50 % need confirmBigChanges. dryRun shows what would change.",
    body: { rows: [{ vendorSku: "GRO-LUSO15", gtin: "5602000000100 (optional)", priceNet: 2.45, stock: 120, warehouse: "Armazém Lisboa (optional)", minQty: 1, qtyStep: 1, leadDays: 1, active: true }], dryRun: false, confirmBigChanges: false } },
  { method: "get", path: "/catalogue", scope: "catalogue.read", who: "Buyers", summary: "What you can order, at your prices (search, category, page, language).",
    params: [{ name: "q", in: "query", description: "search text or barcode" }, { name: "category", in: "query", description: "category id" }, { name: "page", in: "query", description: "page (24 a page)" }, { name: "lang", in: "query", description: "pt, en, es, …" }] },
  { method: "get", path: "/addresses", scope: "orders.write", who: "Buyers", summary: "Your delivery addresses (for placing orders)." },
  { method: "get", path: "/invoices", scope: "invoices.read", who: "Everyone", summary: "Buyers: FIRINGI's invoices and credit notes with paid / open amounts. Suppliers: billing statements.", params: [{ name: "as", in: "query", description: "buyer | supplier" }] },
  { method: "get", path: "/invoices/{id}/pdf", scope: "invoices.read", who: "Buyers", summary: "The invoice PDF (the certified invoicing system's document when it issued it).", params: [{ name: "id", in: "path", description: "invoice id" }] },
];

export function openApiDocument(origin: string) {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const op of OPERATIONS) {
    paths[op.path] ??= {};
    paths[op.path][op.method] = {
      summary: op.summary, tags: [op.who],
      ...(op.scope ? { security: [{ apiKey: [op.scope] }], "x-scope": op.scope } : { security: [{ apiKey: [] }] }),
      parameters: (op.params ?? []).map((p) => ({ name: p.name, in: p.in, required: p.in === "path", description: p.description, schema: { type: "string" } })),
      ...(op.body ? { requestBody: { required: true, content: { "application/json": { example: op.body } } } } : {}),
      responses: {
        "200": { description: "OK" }, "400": { $ref: "#/components/responses/Error" }, "401": { $ref: "#/components/responses/Error" },
        "403": { $ref: "#/components/responses/Error" }, "404": { $ref: "#/components/responses/Error" }, "409": { $ref: "#/components/responses/Error" }, "429": { $ref: "#/components/responses/Error" },
      },
    };
  }
  return {
    openapi: "3.1.0",
    info: {
      title: "FIRINGI API", version: "2.0.0",
      description: "Connect your ERP, shop or POS to FIRINGI. Create a key in the portal (Company › Integrations); it acts as you, limited to the permissions you choose. At most 120 calls a minute per key. Errors: { error: { code, message } }. Money is a string with 2 decimals (unit prices 4), net of VAT unless named gross.",
    },
    servers: [{ url: `${origin}/api/v2` }],
    components: {
      securitySchemes: { apiKey: { type: "http", scheme: "bearer", description: `Authorization: Bearer fk_live_… — scopes: ${Object.keys(SCOPES).join(", ")}` } },
      responses: { Error: { description: "Error", content: { "application/json": { example: { error: { code: "VALIDATION", message: "…" } } } } } },
    },
    paths,
    "x-webhooks": {
      signature: "X-Firingi-Signature: t=<unix time>,v1=<hex HMAC-SHA256(secret, t + '.' + raw body)> — reject if the time is more than 5 minutes off",
      headers: ["X-Firingi-Event", "X-Firingi-Delivery (unique id — ignore repeats)"],
      events: Object.fromEntries(Object.entries(WEBHOOK_EVENTS).map(([k, v]) => [k, v.label])),
      retries: "after 1 min, 5 min, 30 min, 2 h, 6 h, 24 h; switched off after 20 failures in a row",
    },
  };
}
