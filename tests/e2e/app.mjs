/**
 * Browser test of Phase 39 — the installable phone app, offline.
 * Manifests per portal (translated shortcuts); the service worker keeps the offline app; the phone keeps
 * each person's data. The customer (Portuguese, phone) scans to reorder, then loses signal: the app opens
 * offline mode, two orders are placed offline; back online they are sent — one is placed, the other comes
 * back to the customer (a product ran out) and is placed after the customer agrees. The FIRINGI driver
 * works the route offline (picked up, on the way, delivered with a signature) and it syncs; the supplier
 * picks offline with the scanner (a wrong scan is refused on the phone). FIRINGI sees installs and offline
 * actions and changes the price rule (English). iPhone gets Add-to-Home-Screen steps; sign-out clears the
 * phone. Phone + dark.
 *   node tests/e2e/app.mjs [baseUrl] [screenshotDir]
 */
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
const { chromium } = createRequire(import.meta.url)("playwright");

const BASE = process.argv[2] ?? "http://localhost:3000";
const SHOTS = process.argv[3] ?? null;
const PASSWORD = process.env.SEED_PASSWORD ?? "Firingi!2026";
const DB = process.env.E2E_DATABASE_URL ?? "postgresql://postgres:postgres@localhost:5432/firingi";
let failures = 0;
const check = (name, ok, extra = "") => { console.log(`${ok ? "✔" : "✘"} ${name}${extra ? ` — ${extra}` : ""}`); if (!ok) failures++; };
const shot = async (page, name, full = false) => SHOTS && page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: full });
const browser = await chromium.launch();
const settle = async (p) => { await p.waitForLoadState("networkidle").catch(() => {}); await p.waitForTimeout(400); };
const go = async (p, url) => { await p.goto(`${BASE}${url}`); await settle(p); };
const until = async (fn, ms = 25000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await fn().catch(() => false)) return true; await new Promise((r) => setTimeout(r, 400)); } return false; };
const sql = (q) => execFileSync("psql", ["-At", DB, "-c", q], { encoding: "utf8" }).trim();
const errors = [];
const PHONE = { width: 390, height: 844 };
async function login(email, { viewport = PHONE, colorScheme = "light", locale = null, userAgent } = {}) {
  const ctx = await browser.newContext({ viewport, colorScheme, reducedMotion: "reduce", deviceScaleFactor: SHOTS ? 2 : 1, ...(userAgent ? { userAgent } : {}) });
  if (locale) await ctx.addCookies([{ name: "NEXT_LOCALE", value: locale, url: BASE }]);
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(`${email} @ ${page.url().replace(BASE, "")}: ${e.message.slice(0, 140)}`));
  await go(page, "/login");
  await page.fill("#email", email); await page.fill("#password", PASSWORD); await page.click("button[type=submit]");
  await page.waitForURL((u) => u.pathname !== "/login", { timeout: 15000 }).catch(() => {});
  if (locale) await ctx.addCookies([{ name: "NEXT_LOCALE", value: locale, url: BASE }]);
  await settle(page);
  return page;
}
/** Read the phone's saved data (IndexedDB "firingi-app"). */
const kv = (p, key) => p.evaluate((k) => new Promise((res) => {
  const r = indexedDB.open("firingi-app");
  r.onsuccess = () => { const db = r.result; if (!db.objectStoreNames.contains("kv")) { db.close(); return res(null); } const g = db.transaction("kv").objectStore("kv").get(k); g.onsuccess = () => { res(g.result ?? null); db.close(); }; };
  r.onerror = () => res(null);
}), key);
const outbox = (p) => p.evaluate(() => new Promise((res) => {
  const r = indexedDB.open("firingi-app");
  r.onsuccess = () => { const db = r.result; if (!db.objectStoreNames.contains("outbox")) { db.close(); return res([]); } const g = db.transaction("outbox").objectStore("outbox").getAll(); g.onsuccess = () => { res(g.result); db.close(); }; };
  r.onerror = () => res([]);
}));
const ready = (p) => p.evaluate(async () => !!(await navigator.serviceWorker.ready).active && !!(await caches.match("/offline")));

// ── test data: a delivery for the FIRINGI driver and an open pick list at Lisboa Central ──
const setup = JSON.parse(execFileSync("npx", ["tsx", "--require", "./tests/e2e/setup/no-server-only.cjs", "tests/e2e/setup/app-setup.ts"], { encoding: "utf8" }).trim().split("\n").pop());
check("test data ready", !!setup.deliveryId && !!setup.pickListId && setup.mode === "FIRINGI_FLEET", JSON.stringify(setup).slice(0, 120));
const kebab = sql(`select id from "Company" where "legalName" like 'Kebab House%' limit 1`);
const kebabUser = sql(`select id from "User" where email='owner@kebabhouse.test'`);

// ── 1. manifests ──
const mf = await (await fetch(`${BASE}/manifest/buy?l=pt-PT`)).json();
check("buyer manifest: installable (standalone, icons, start page)", mf.display === "standalone" && mf.start_url.startsWith("/buy") && mf.icons.some((i) => i.purpose === "maskable" && i.sizes === "512x512"));
check("buyer manifest: shortcuts in Portuguese", mf.shortcuts.some((s) => /Ler e Encomendar/.test(s.name)) && mf.shortcuts.some((s) => /Carrinho/.test(s.name)), mf.shortcuts.map((s) => s.name).join(", "));
const md = await (await fetch(`${BASE}/manifest/driver?l=pt-PT`)).json();
check("driver manifest: offline mode shortcut", md.shortcuts.some((s) => s.url.startsWith("/offline")));
check("unknown portal: no manifest", (await fetch(`${BASE}/manifest/nope`)).status === 404);

// ── 2. customer: app shell, scan to reorder ──
const kb = await login("owner@kebabhouse.test", { locale: "pt-PT" });
await go(kb, "/buy/dashboard/overview");
check("customer page links its manifest", (await kb.locator('link[rel="manifest"]').getAttribute("href"))?.startsWith("/manifest/buy"));
check("phone bottom bar (scan, cart)", (await kb.getByTestId("bottom-bar").count()) === 1 && (await kb.getByTestId("bar-scan").count()) === 1 && (await kb.getByTestId("bar-cart").count()) === 1);
check("service worker on, offline app kept", await until(() => ready(kb)));
check("customer data kept on the phone", await until(async () => ((await kv(kb, "snap:buy"))?.buy?.products?.length ?? 0) > 0));
const snap = await kv(kb, "snap:buy");
check("kept data has the customer's own prices, no commission", snap.buy.products.every((p) => typeof p.unitNet === "number") && !/commission|margin/i.test(JSON.stringify(snap)));
await shot(kb, "app-01-buyer-bar");
// the offer the setup ordered: Lisboa Central's single 2 kg block (an unordered query could return another supplier's or the case)
const gtin = sql(`select coalesce(pu.gtin, v.gtin) from "VendorOffer" o join "PackagingUnit" pu on pu.id=o."packagingUnitId" join "ProductVariant" v on v.id=pu."variantId" join "Membership" m on m."companyId"=o."vendorCompanyId" join "User" u on u.id=m."userId" where u.email='owner@lisboacentral.test' and v.sku='FIR-MOZZ2' and pu."unitsPerPack"=1 and o.status='ACTIVE' order by o."createdAt" limit 1`);
const cartBefore = Number(sql(`select coalesce(sum(qty),0) from "CartItem" ci join "Cart" c on c.id=ci."cartId" where c."buyerCompanyId"='${kebab}'`));
await go(kb, "/buy/orders/scan");
await kb.getByTestId("reorder-scan").fill(gtin);
await kb.getByTestId("reorder-scan").press("Enter");
await until(async () => (await kb.getByTestId("scan-result").count()) > 0);
if ((await kb.locator("[data-testid=scan-result][data-status=CHOOSE]").count()) > 0) await kb.getByTestId("scan-choose").first().click();
check("scan to reorder: product in the cart", await until(async () => Number(sql(`select coalesce(sum(qty),0) from "CartItem" ci join "Cart" c on c.id=ci."cartId" where c."buyerCompanyId"='${kebab}'`)) > cartBefore));
await kb.getByTestId("reorder-scan").fill("0000000000000");
await kb.getByTestId("reorder-scan").press("Enter");
check("scan to reorder: unknown code said plainly", await until(async () => (await kb.locator("[data-testid=scan-result][data-status=NOT_FOUND]").count()) === 1));
await shot(kb, "app-02-scan");
sql(`delete from "CartItem" where "cartId" in (select id from "Cart" where "buyerCompanyId"='${kebab}')`);

// ── 3. customer offline: two orders ──
await kb.context().setOffline(true);
await go(kb, "/buy/orders/history");
check("no signal: offline mode opens instead of an error", (await kb.getByTestId("net-status").getAttribute("data-online")) === "false");
check("offline mode in Portuguese", /Modo offline/.test(await kb.locator("header").first().textContent()));
const products = kb.getByTestId("offline-product");
check("saved products listed", (await products.count()) > 0);
const offers = await products.evaluateAll((els) => els.map((e) => e.getAttribute("data-offer")));
const fill = async (offerId, min) => {
  const row = kb.locator(`[data-testid=offline-product][data-offer="${offerId}"]`);
  await row.getByTestId("offline-add").click();
  for (let i = 0; i < 40; i++) {
    const total = Number(((await kb.getByTestId("offline-total").textContent()) ?? "0").replace(/[^\d,]/g, "").replace(",", "."));
    if (total >= min) break;
    await row.getByRole("button").last().click();
  }
};
// order 1: one product above the minimum order
await fill(offers[0], 70);
await shot(kb, "app-03-offline-order");
await kb.getByTestId("offline-place").click();
check("order 1 kept on the phone", await until(async () => (await outbox(kb)).filter((e) => e.kind === "order.place" && e.state === "WAITING").length === 1));
// order 2: the same product + another one that will run out before the phone is back online
await kb.getByTestId("tab-order").click();
await fill(offers[0], 70);
const B = offers.find((o, i) => i > 0 && o !== offers[0]);
await kb.locator(`[data-testid=offline-product][data-offer="${B}"]`).getByTestId("offline-add").click();
await kb.getByTestId("offline-place").click();
check("order 2 kept on the phone", await until(async () => (await outbox(kb)).filter((e) => e.kind === "order.place" && e.state === "WAITING").length === 2));
check("outbox shows both waiting", await until(async () => (await kb.locator("[data-testid=outbox-entry][data-state=WAITING]").count()) === 2));
await shot(kb, "app-04-outbox-offline");
const stockB = sql(`select string_agg(id || ':' || "onHand", ',') from "StockLevel" where "offerId"='${B}'`);
sql(`update "StockLevel" set "onHand" = reserved where "offerId"='${B}'`); // product B runs out meanwhile
const opsBefore = Number(sql(`select count(*) from "OfflineOp" where "userId"='${kebabUser}' and kind='order.place' and status='DONE'`));
await kb.context().setOffline(false);
await kb.evaluate(() => window.dispatchEvent(new Event("online")));
check("back online: order 1 placed", await until(async () => (await kb.locator("[data-testid=outbox-entry][data-state=DONE] [data-testid=outbox-number]").count()) >= 1));
check("order 2 comes back: a product ran out", await until(async () => (await kb.locator("[data-testid=outbox-entry][data-state=NEEDS_CONFIRM]").count()) === 1));
check("the customer sees why", /stock/i.test(await kb.getByTestId("outbox-confirm").textContent()));
await shot(kb, "app-05-outbox-confirm");
await kb.getByTestId("outbox-accept").click();
check("order 2 placed without the missing product", await until(async () => (await kb.locator("[data-testid=outbox-entry][data-state=DONE]").count()) === 2));
check("server carried out each order once", Number(sql(`select count(*) from "OfflineOp" where "userId"='${kebabUser}' and kind='order.place' and status='DONE'`)) === opsBefore + 2);
for (const pair of stockB.split(",")) { const [id, n] = pair.split(":"); sql(`update "StockLevel" set "onHand"=${n} where id='${id}'`); }
await kb.waitForTimeout(500);
await shot(kb, "app-06-outbox-done");

// ── 4. FIRINGI driver offline ──
const dv = await login("driver@firingi.test", { locale: "pt-PT" });
await go(dv, "/driver/deliveries/today");
check("driver: route kept on the phone", await until(async () => ((await kv(dv, "snap:driver"))?.driver?.stops ?? []).some((s) => s.deliveryId === setup.deliveryId)));
check("driver: service worker ready", await until(() => ready(dv)));
await dv.context().setOffline(true);
await go(dv, "/driver/deliveries/history");
const stop = dv.locator(`[data-testid=offline-stop][data-delivery="${setup.deliveryId}"]`);
if (!(await stop.getByTestId("stop-pickup").count())) await stop.locator("button").first().click();
await stop.getByTestId("stop-pickup").click();
await stop.getByTestId("stop-start").click();
await stop.getByTestId("stop-delivered").click();
await dv.getByTestId("pod-name").fill("Ahmed Kebab");
await dv.getByTestId("signature-pad").scrollIntoViewIfNeeded();
const pad = await dv.getByTestId("signature-pad").boundingBox();
await dv.mouse.move(pad.x + 20, pad.y + 40); await dv.mouse.down();
for (let i = 1; i <= 12; i++) await dv.mouse.move(pad.x + 20 + i * 20, pad.y + 40 + (i % 2 ? 30 : -10));
await dv.mouse.up();
await shot(dv, "app-07-driver-pod");
await dv.getByTestId("pod-save").click();
check("driver: delivered on the phone, three steps waiting", await until(async () => (await outbox(dv)).filter((e) => e.portal === "driver" && e.state === "WAITING").length === 3) && (await stop.getAttribute("data-status")) === "DELIVERED");
check("driver: nothing reached the server yet", sql(`select status from "Delivery" where id='${setup.deliveryId}'`) === "ASSIGNED");
await dv.context().setOffline(false);
await dv.evaluate(() => window.dispatchEvent(new Event("online")));
check("driver: back online, delivered with proof", await until(async () => sql(`select d.status || ':' || coalesce(p."recipientName",'') || ':' || (p."signatureKey" is not null) from "Delivery" d left join "ProofOfDelivery" p on p."deliveryId"=d.id where d.id='${setup.deliveryId}'`) === "DELIVERED:Ahmed Kebab:true"));
check("driver: order delivered", sql(`select status from "Order" where number='${setup.orderNumber}'`) === "DELIVERED");

// ── 5. supplier picking offline ──
const lx = await login("owner@lisboacentral.test", { locale: "pt-PT" });
await go(lx, "/vendor/warehouse/pick");
check("supplier: pick list kept on the phone", await until(async () => ((await kv(lx, "snap:vendor"))?.vendor?.pickLists ?? []).some((l) => l.id === setup.pickListId)));
check("supplier: service worker ready", await until(() => ready(lx)));
await lx.context().setOffline(true);
await go(lx, "/vendor/dashboard/overview");
await lx.getByTestId("offline-pick-scan").fill("9999999999994");
await lx.getByTestId("offline-pick-scan").press("Enter");
check("wrong scan refused on the phone", (await lx.getByTestId("pick-msg").textContent()).length > 0 && (await outbox(lx)).length === 0);
await lx.getByTestId("offline-pick-scan").fill(gtin);
await lx.getByTestId("offline-pick-scan").press("Enter");
check("right product counted", await until(async () => (await outbox(lx)).filter((e) => e.kind === "pick.scan").length === 1));
// FEFO can split the order over two batches (two lines): the scanned line, then the rest, all marked picked
const open = () => lx.locator("[data-testid=offline-pick-line][data-done=false] [data-testid=pick-all]");
for (let i = 0; i < setup.lines.length && (await open().count()); i++) { await open().first().click(); await lx.waitForTimeout(300); }
check("lines done on the phone", await until(async () => (await lx.locator("[data-testid=offline-pick-line][data-done=true]").count()) === setup.lines.length));
await shot(lx, "app-08-pick-offline");
await lx.context().setOffline(false);
await lx.evaluate(() => window.dispatchEvent(new Event("online")));
check("supplier: back online, lines picked (scan-checked)", await until(async () => sql(`select bool_and("pickedQty" = qty) || ':' || bool_or(verified = 'SCAN') from "PickLine" where "pickListId"='${setup.pickListId}'`) === "true:true"));
check("supplier: pick list picked", await until(async () => sql(`select status from "PickList" where id='${setup.pickListId}'`) === "PICKED"));

// ── 6. FIRINGI (English) ──
const ad = await login("superadmin@firingi.test", { viewport: { width: 1280, height: 900 }, locale: "en" });
await go(ad, "/admin/settings/app");
check("admin: offline actions listed", /Offline order/.test(await ad.getByTestId("app-ops").textContent()) && /Delivered \(proof\)/.test(await ad.getByTestId("app-ops").textContent()));
await ad.selectOption("#ap-mode", "AUTO");
await ad.fill("#ap-maxpct", "3");
await ad.getByTestId("ap-save").click();
check("admin: price rule saved", await until(async () => { const v = JSON.parse(sql(`select value from "Setting" where key='app.settings'`) || "{}"); return v.offlineOrders?.mode === "AUTO" && v.offlineOrders?.maxChangePct === 3; }));
await shot(ad, "app-09-admin", true);
sql(`delete from "Setting" where key='app.settings'`);

// ── 7. iPhone: Add-to-Home-Screen steps; sign-out clears the phone ──
const ios = await login("owner@kebabhouse.test", { locale: "pt-PT", userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1" });
await go(ios, "/buy/dashboard/overview");
check("iPhone: install card with the Add-to-Home-Screen steps", await until(async () => (await ios.getByTestId("install-card").count()) === 1 && /Partilhar/.test(await ios.getByTestId("install-card").textContent())));
await shot(ios, "app-10-iphone-install");
await ios.getByTestId("install-dismiss").click();
await go(ios, "/buy/dashboard/overview");
check("iPhone: dismissed card stays away", (await ios.getByTestId("install-card").count()) === 0);
await kb.setViewportSize({ width: 1280, height: 900 });
await go(kb, "/buy/dashboard/overview");
await until(async () => !!(await kv(kb, "snap:buy")));
await kb.locator("header").getByRole("button", { name: /Terminar sessão|Sign out/ }).last().click();
await kb.waitForURL((u) => u.pathname === "/login", { timeout: 15000 }).catch(() => {});
check("sign-out: the phone's saved data is removed", (await kv(kb, "snap:buy")) === null);

// ── 8. phone + dark ──
const dk = await login("owner@kebabhouse.test", { colorScheme: "dark", locale: "pt-PT" });
for (const u of ["/buy/orders/scan", "/offline", "/buy/dashboard/overview"]) {
  await go(dk, u);
  const over = await dk.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check(`phone width: no sideways scrolling (${u})`, over <= 1, `${over}px`);
}
await until(async () => !!(await kv(dk, "snap:buy")));
await go(dk, "/offline");
await shot(dk, "app-11-offline-dark");
const ap = await login("superadmin@firingi.test", { colorScheme: "dark", locale: "en" });
await go(ap, "/admin/settings/app");
const overA = await ap.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
check("phone width: admin Phone App page", overA <= 1, `${overA}px`);

check("no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
await browser.close();
console.log(failures ? `\n${failures} check(s) failed` : "\nall app checks passed");
process.exit(failures ? 1 : 0);
