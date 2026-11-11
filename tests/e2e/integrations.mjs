/**
 * Browser test of Phase 21 (integrations) against a server started with
 * INTEGRATIONS_ALLOW_PRIVATE_URLS=1 (so it may call this script's local feed / webhook receiver):
 * a supplier uploads a price file (columns guessed) → checks → applies; saves the columns as a
 * feed fetched from a URL and runs it; creates an API key and uses API v2 (me, offers, sync,
 * scope refused, no key refused); adds a webhook and sends a signed test; a customer creates a
 * key and places an order through the API → the supplier's system is told (order.created) and
 * the customer's answer hides commission; customers and suppliers download exports; FIRINGI
 * previews a balanced accounting export and downloads the PHC layout; the admin overview shows
 * the traffic; pages fit a phone in dark mode.
 *   INTEGRATIONS_ALLOW_PRIVATE_URLS=1 next start …  then  node tests/e2e/integrations.mjs [baseUrl] [screenshotDir]
 */
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { createHmac } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const { chromium, devices } = createRequire(import.meta.url)("playwright");

const BASE = process.argv[2] ?? "http://localhost:3000";
const SHOTS = process.argv[3] ?? null;
const PASSWORD = process.env.SEED_PASSWORD ?? "Firingi!2026";
const CRON = process.env.CRON_SECRET ?? "test-cron-secret-0123456789abcdef";
let failures = 0;
const check = (name, ok, extra = "") => { console.log(`${ok ? "✔" : "✘"} ${name}${extra ? ` — ${extra}` : ""}`); if (!ok) failures++; };
const shot = async (page, name) => SHOTS && page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
const browser = await chromium.launch();
const settle = async (p) => { await p.waitForLoadState("networkidle"); await p.waitForTimeout(400); };
const go = async (p, url) => { await p.goto(`${BASE}${url}`); await settle(p); };
const errors = [];
async function login(email, opts = { viewport: { width: 1440, height: 950 } }) {
  const page = await (await browser.newContext({ ...opts, reducedMotion: "reduce", acceptDownloads: true })).newPage();
  page.on("pageerror", (e) => errors.push(`${email} @ ${page.url().replace(BASE, "")}: ${e.message.slice(0, 120)}`));
  page.on("dialog", (d) => d.accept());
  await go(page, "/login");
  await page.fill("#email", email);
  await page.fill("#password", PASSWORD);
  await page.click("button[type=submit]");
  await page.waitForURL((u) => u.pathname !== "/login", { timeout: 15000 }).catch(() => {});
  await settle(page);
  return page;
}
const api = async (key, method, path, body) => {
  const r = await fetch(`${BASE}/api/v2${path}`, { method, headers: { ...(key ? { authorization: `Bearer ${key}` } : {}), ...(body ? { "content-type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, headers: r.headers, json: await r.json().catch(() => null) };
};
const fmt = (n) => n.toFixed(2).replace(".", ",");
const until = async (fn, ms = 15000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) return true; await new Promise((r) => setTimeout(r, 500)); } return false; };

// ── local "supplier ERP": serves a feed file and receives webhooks ──
const hits = [];
let feedBody = "";
const srv = createServer((req, res) => {
  let body = ""; req.on("data", (c) => (body += c)); req.on("end", () => {
    if (req.url === "/feed.csv") { res.writeHead(200, { "content-type": "text/csv" }); return res.end(feedBody); }
    hits.push({ path: req.url, headers: req.headers, body });
    res.writeHead(200, { "content-type": "text/plain" }); res.end("ok");
  });
});
await new Promise((ok) => srv.listen(0, "127.0.0.1", ok));
const LOCAL = `http://127.0.0.1:${srv.address().port}`;

// ── 0. leftovers of an earlier, interrupted run ──
const vendor = await login("owner@lisboacentral.test");
await go(vendor, "/vendor/company/integrations");
for (const row of await vendor.getByTestId("hook-row").filter({ hasText: "127.0.0.1" }).all()) { await row.getByRole("button", { name: /Delete|Eliminar/ }).click().catch(() => null); await vendor.waitForTimeout(500); }
for (const row of await vendor.getByTestId("key-row").filter({ hasText: "E2E ERP" }).all()) { const b = row.getByTestId("key-revoke"); if (await b.count()) { await b.click(); await vendor.waitForTimeout(500); } }
await go(vendor, "/vendor/products/import");
for (const c of await vendor.getByTestId("feed-card").filter({ hasText: "E2E feed" }).all()) { await c.getByRole("button", { name: /Delete|Eliminar/ }).click().catch(() => null); await vendor.waitForTimeout(500); }

// ── 1. supplier: import a price file ──
await go(vendor, "/vendor/products/import");
check("import page with hero and wizard", await vendor.getByTestId("hero").isVisible() && await vendor.getByTestId("import-wizard").isVisible());
const tpl = await (await vendor.request.get(`${BASE}/api/imports/template?file=csv`)).text();
const lusoLine = tpl.split("\r\n").find((l) => l.startsWith("GRO-LUSO15;"));
check("template download lists my offers", !!lusoLine, lusoLine?.slice(0, 60));
const was = Number(lusoLine.split(";")[3].replace(",", "."));
const dir = mkdtempSync(join(tmpdir(), "firingi-e2e-"));
const file = join(dir, "precos.csv");
writeFileSync(file, `﻿Referência;Descrição;Preço;Stock\nGRO-LUSO15;Água Luso 1,5 L;${fmt(was + 0.07)};\nNAO-EXISTE;?;1,00;\n`);
await vendor.getByTestId("import-file").setInputFiles(file);
await vendor.getByTestId("rows-found").waitFor({ timeout: 15000 });
check("columns guessed from Portuguese headers", (await vendor.getByTestId("map-0").inputValue()) === "vendor_sku" && (await vendor.getByTestId("map-2").inputValue()) === "price", await vendor.getByTestId("rows-found").textContent());
await shot(vendor, "p21-import-mapping");
await vendor.getByTestId("import-preview").click();
await vendor.waitForURL("**/vendor/products/import/**", { timeout: 15000 });
await settle(vendor);
const rowsText = await vendor.getByTestId("run-rows").textContent();
check("preview shows the price change", /price .*→/.test(rowsText), rowsText.slice(0, 90));
await vendor.getByTestId("filter-problems").click();
check("problems filter shows the unknown product", (await vendor.getByTestId("run-rows").textContent()).includes("NAO-EXISTE"));
await shot(vendor, "p21-import-check");
await vendor.getByTestId("import-apply").click();
await vendor.getByTestId("import-result").waitFor({ timeout: 15000 });
check("apply → result", /1/.test(await vendor.getByTestId("import-result").textContent()), await vendor.getByTestId("import-result").textContent());
const tpl2 = await (await vendor.request.get(`${BASE}/api/imports/template?file=csv`)).text();
check("new price in my offers", tpl2.includes(`GRO-LUSO15;`) && Math.abs(Number(tpl2.split("\r\n").find((l) => l.startsWith("GRO-LUSO15;")).split(";")[3].replace(",", ".")) - (was + 0.07)) < 0.001);

// ── 2. supplier: saved columns → scheduled feed from a URL ──
await go(vendor, "/vendor/products/import");
await vendor.getByTestId("import-file").setInputFiles(file);
await vendor.getByTestId("rows-found").waitFor({ timeout: 15000 });
const feedName = `E2E feed ${Date.now() % 100000}`;
await vendor.getByTestId("save-as").fill(feedName);
await vendor.getByTestId("import-preview").click();
await vendor.waitForURL("**/vendor/products/import/**", { timeout: 15000 });
await settle(vendor);
await vendor.getByTestId("import-discard").click();
await vendor.waitForTimeout(800);
await go(vendor, "/vendor/products/import");
const card = vendor.getByTestId("feed-card").filter({ hasText: feedName });
feedBody = `Referência;Descrição;Preço;Stock\nGRO-LUSO15;Água;${fmt(was)};\n`; // back to the original price
await card.getByTestId("feed-url").fill(`${LOCAL}/feed.csv`);
await card.getByTestId("feed-save").click();
await vendor.waitForTimeout(1200);
await settle(vendor);
await card.getByTestId("feed-run").click();
check("feed run now → applied", await until(async () => /Applied|Aplicad/i.test(await card.textContent())), (await card.textContent()).slice(0, 120));
const tpl3 = await (await vendor.request.get(`${BASE}/api/imports/template?file=csv`)).text();
check("feed restored the original price", Math.abs(Number(tpl3.split("\r\n").find((l) => l.startsWith("GRO-LUSO15;")).split(";")[3].replace(",", ".")) - was) < 0.001);
await shot(vendor, "p21-import-page");

// ── 3. supplier: API key + API v2 ──
await go(vendor, "/vendor/company/integrations");
check("integrations hub", await vendor.getByTestId("api-keys").isVisible() && await vendor.getByTestId("webhooks").isVisible());
await vendor.getByTestId("key-name").fill("E2E ERP");
await vendor.getByTestId("scope-catalogue.read").uncheck({ force: true });
await vendor.getByTestId("scope-offers.write").check({ force: true });
await vendor.getByTestId("key-create").click();
await vendor.getByTestId("key-secret").waitFor({ timeout: 15000 });
const vKey = (await vendor.getByTestId("key-secret").textContent()).trim();
check("key shown once", vKey.startsWith("fk_live_"));
const me = await api(vKey, "GET", "/me");
check("GET /me with the key", me.status === 200 && me.json.company.name === "Lisboa Central" && me.json.key.scopes.includes("offers.write"), JSON.stringify(me.json?.key));
check("rate-limit headers", me.headers.get("x-ratelimit-limit") === "120");
check("no key → 401", (await api(null, "GET", "/me")).status === 401);
const cat = await api(vKey, "GET", "/catalogue");
check("missing scope → 403", cat.status === 403 && cat.json.error.code === "MISSING_SCOPE");
const offs = await api(vKey, "GET", "/offers");
check("GET /offers", offs.status === 200 && offs.json.offers.some((o) => o.vendorSku === "GRO-LUSO15"));
const dry = await api(vKey, "POST", "/offers/sync", { rows: [{ vendorSku: "GRO-LUSO15", priceNet: was + 1 }], dryRun: true });
check("POST /offers/sync dry run", dry.status === 200 && dry.json.rows[0].status === "UPDATE", JSON.stringify(dry.json?.summary));
const big = await api(vKey, "POST", "/offers/sync", { rows: [{ vendorSku: "GRO-LUSO15", priceNet: was * 5 }] });
check("big change refused without confirmation", big.status === 409 && big.json.error.code === "BIG_CHANGES");
const badBody = await api(vKey, "POST", "/offers/sync", { rows: [{ sku: "x" }] });
check("invalid body → 400 with issues", badBody.status === 400 && badBody.json.error.code === "VALIDATION");
const oa = await fetch(`${BASE}/api/v2/openapi.json`);
check("OpenAPI document", oa.status === 200 && (await oa.json()).openapi === "3.1.0");

// ── 4. supplier: webhook + signed test ──
await vendor.getByTestId("hook-url").fill(`${LOCAL}/hooks/lx`);
await vendor.getByTestId("hook-add").click();
await vendor.getByTestId("hook-secret").waitFor({ timeout: 15000 });
const secret = (await vendor.getByTestId("hook-secret").textContent()).trim();
await go(vendor, "/vendor/company/integrations");
await vendor.getByTestId("hook-row").filter({ hasText: `${LOCAL}/hooks/lx` }).getByTestId("hook-test").click();
check("test ping received", await until(() => hits.some((h) => h.path === "/hooks/lx" && JSON.parse(h.body).event === "ping")));
const ping = hits.find((h) => h.path === "/hooks/lx");
const [, t, v1] = /t=(\d+),v1=(\w+)/.exec(ping.headers["x-firingi-signature"]);
check("signature verifies with the secret", v1 === createHmac("sha256", secret).update(`${t}.${ping.body}`).digest("hex"));
check("test result shown", /200/.test(await vendor.getByTestId("hook-note").textContent()));
await vendor.reload(); await settle(vendor);
await shot(vendor, "p21-integrations");

// ── 5. customer: key → order by API → supplier's system told ──
const buyer = await login("owner@kebabhouse.test");
await go(buyer, "/buy/company/integrations");
await buyer.getByTestId("key-name").fill("E2E POS");
await buyer.getByTestId("scope-orders.write").check({ force: true });
await buyer.getByTestId("key-create").click();
await buyer.getByTestId("key-secret").waitFor({ timeout: 15000 });
const bKey = (await buyer.getByTestId("key-secret").textContent()).trim();
const catalogue = await api(bKey, "GET", "/catalogue?q=mozzarella&lang=pt");
const mozz = catalogue.json?.items?.find((i) => i.supplier === "Lisboa Central" && i.packaging.unitsPerPack === 1);
check("catalogue by API (no funding details)", !!mozz && !JSON.stringify(catalogue.json).includes("firingiPerUnit"), mozz?.name);
// The supplier's ERP tops up stock through the API first (single 2 kg block: code shared with the case → barcode decides).
const topUp = await api(vKey, "POST", "/offers/sync", { rows: [{ vendorSku: "GRO-MOZZ2", gtin: "5601000000608", stock: 900 }] });
check("supplier tops up stock by API", topUp.status === 200 && topUp.json.failed === 0, JSON.stringify(topUp.json?.rows?.[0]));
hits.length = 0;
let placed = await api(bKey, "POST", "/orders", { lines: [{ offerId: mozz.offerId, qty: 30 }], notes: "E2E API order" });
if (placed.status === 409 && placed.json?.error?.code === "CART_NOT_EMPTY") {
  check("refused while the portal cart has products", true);
  await go(buyer, "/buy/orders/cart");
  await buyer.getByRole("button", { name: /^(Clear|Limpar|Esvaziar|Vaciar)/i }).first().click();
  await buyer.waitForTimeout(1000);
  placed = await api(bKey, "POST", "/orders", { lines: [{ offerId: mozz.offerId, qty: 30 }], notes: "E2E API order" });
}
check("order placed by API → 201", placed.status === 201 && placed.json.orders.length === 1, JSON.stringify(placed.json).slice(0, 140));
const orderId = placed.json.orders[0].id;
const asBuyer = await api(bKey, "GET", `/orders/${orderId}`);
check("buyer's order view hides commission", asBuyer.status === 200 && !/commission|payable|margin/i.test(JSON.stringify(asBuyer.json)));
const asSupplier = await api(vKey, "GET", `/orders/${orderId}`);
check("supplier's order view shows its payout, not FIRINGI's margin", asSupplier.status === 200 && asSupplier.json.payableToYouNet && !/margin/i.test(JSON.stringify(asSupplier.json)));
let told = await until(() => hits.some((h) => h.path === "/hooks/lx" && JSON.parse(h.body).event === "order.created"), 6000);
if (!told) { await fetch(`${BASE}/api/cron/integrations`, { method: "POST", headers: { authorization: `Bearer ${CRON}` } }); told = await until(() => hits.some((h) => JSON.parse(h.body).event === "order.created"), 6000); }
check("supplier's system got order.created", told);
const conf = await api(vKey, "POST", `/orders/${orderId}/confirm`, {});
check("supplier key without orders.write can't confirm", conf.status === 403);
await buyer.request.post(`${BASE}/api/v2/orders/${orderId}/status`, { headers: { authorization: `Bearer ${bKey}`, "content-type": "application/json" }, data: { status: "CANCELLED", reason: "e2e" } }).catch(() => null);

// ── 6. exports ──
await go(buyer, "/buy/finance/exports");
const [dl] = await Promise.all([buyer.waitForEvent("download"), buyer.getByTestId("export-download").click()]);
check("customer export downloads", /firingi-.*\.xlsx$/.test(dl.suggestedFilename()), dl.suggestedFilename());
await shot(buyer, "p21-exports");
await go(vendor, "/vendor/finance/exports");
check("supplier exports page", await vendor.getByTestId("company-exports").isVisible() && await vendor.getByTestId("kind-supplier.statements").isVisible());

// ── 7. FIRINGI: accounting export + overview ──
const fin = await login("finance@firingi.test");
await go(fin, "/admin/finance/accounting-export");
const today = new Date().toISOString().slice(0, 10);
await fin.getByTestId("acc-from").fill(`${today.slice(0, 8)}01`);
await fin.getByTestId("acc-to").fill(today);
await fin.getByTestId("acc-preview").click();
await fin.getByTestId("acc-balance").waitFor({ timeout: 20000 });
const bal = await fin.getByTestId("acc-balance").textContent();
check("accounting preview is balanced (this month, real documents)", /Balanced/.test(bal) && !/ 0 journal lines/.test(bal), bal.slice(0, 100));
await fin.waitForTimeout(800);
await shot(fin, "p21-accounting-export");
await fin.getByTestId("acc-format").selectOption("phc");
const href = await fin.getByTestId("acc-download").getAttribute("href");
const phc = await (await fin.request.get(`${BASE}${href.replace("file=xlsx", "file=csv")}`)).text();
check("PHC layout downloads", phc.slice(1).startsWith("Diario;Data;Documento;Conta;Descricao;Debito;Credito;NIF"), phc.slice(1, 60));
const sa = await login("superadmin@firingi.test");
await go(sa, "/admin/settings/integrations");
const overview = await sa.locator("main").textContent();
check("admin overview shows keys and feeds", /Active keys/.test(overview) && overview.includes(feedName));
await shot(sa, "p21-admin-integrations");

// ── 8. phones, dark mode ──
const phone = await login("owner@lisboacentral.test", { ...devices["iPhone 13"], colorScheme: "dark" });
for (const url of ["/vendor/products/import", "/vendor/company/integrations", "/vendor/company/integrations/api", "/vendor/finance/exports"]) {
  await go(phone, url);
  const over = await phone.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check(`phone fits ${url}`, over <= 1, `overflow ${over}px`);
}
await go(phone, "/vendor/company/integrations");
await shot(phone, "p21-phone-integrations-dark");

// ── clean up: keys, webhook, feed ──
await go(vendor, "/vendor/company/integrations");
for (const row of await vendor.getByTestId("key-row").filter({ hasText: "E2E ERP" }).all()) { const b = row.getByTestId("key-revoke"); if (await b.count()) { await b.click(); await vendor.waitForTimeout(600); } }
for (const row of await vendor.getByTestId("hook-row").filter({ hasText: "127.0.0.1" }).all()) { await row.getByRole("button", { name: /Delete|Eliminar/ }).click().catch(() => null); await vendor.waitForTimeout(600); }
await go(buyer, "/buy/company/integrations");
for (const row of await buyer.getByTestId("key-row").filter({ hasText: "E2E POS" }).all()) { const b = row.getByTestId("key-revoke"); if (await b.count()) { await b.click(); await buyer.waitForTimeout(600); } }
check("revoked key no longer works", (await api(vKey, "GET", "/me")).status === 401);
await go(vendor, "/vendor/products/import");
await vendor.getByTestId("feed-card").filter({ hasText: feedName }).getByRole("button", { name: /Delete|Eliminar/ }).click().catch(() => null);
await vendor.waitForTimeout(800);

check("no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
await browser.close();
srv.close();
console.log(failures ? `\n${failures} check(s) failed` : "\nAll integration checks passed");
process.exit(failures ? 1 : 0);
