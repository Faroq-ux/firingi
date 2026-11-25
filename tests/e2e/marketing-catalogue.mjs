/**
 * Browser test: FIRINGI marketing catalogue. Admin (English) creates a catalogue for one wholesaler, fills it from the
 * filters (best sellers), switches price to incl. VAT and barcodes off, builds a second one with AI for a district
 * (simulated), publishes, opens the public share link (Portuguese, prices, no barcodes), downloads the PDF, makes the
 * campaign for the customers; phone width of the public page; no page errors.
 *   node tests/e2e/marketing-catalogue.mjs [baseUrl] [screenshotDir]      (server with ASSISTANT_SIMULATE=1 and no AI key)
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
const settle = async (p) => { await p.waitForLoadState("networkidle").catch(() => {}); await p.waitForTimeout(500); };
const go = async (p, url) => { const r = await p.goto(`${BASE}${url}`, { timeout: 240000 }); await settle(p); return r; };
const until = async (fn, ms = 90000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await fn().catch(() => false)) return true; await new Promise((r) => setTimeout(r, 500)); } return false; };
const sql = (q) => execFileSync("psql", ["-At", DB, "-c", q], { encoding: "utf8" }).trim();
const tap = async (p, sel) => { const l = typeof sel === "string" ? p.locator(sel).first() : sel; await l.evaluate((e) => e.scrollIntoView({ block: "center" })); await l.click(); };

const TITLE = "E2E Lisboa Central best sellers", AITITLE = "E2E drinks for cafés";
const cleanup = () => { sql(`delete from "MarketingCampaign" where name like 'Catalogue: E2E%'`); sql(`delete from "MarketingCatalogue" where title like 'E2E%' or "aiPrompt" like 'E2E%'`); sql(`delete from "Setting" where key='marketingCatalogue.settings'`); };
cleanup();
process.on("exit", () => { try { cleanup(); } catch (e) { console.log("cleanup:", e.message); } });

const errors = [];
const browser = await chromium.launch();
async function login(email, opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 }, locale: "en-GB", reducedMotion: "reduce", deviceScaleFactor: SHOTS ? 2 : 1, serviceWorkers: "block", acceptDownloads: true, ...opts });
  const page = await ctx.newPage();
  page.setDefaultTimeout(240000);
  page.on("pageerror", (e) => errors.push(`${email}: ${e.message.slice(0, 160)}`));
  if (email) {
    await go(page, "/login");
    await page.fill("#email", email); await page.fill("#password", PASSWORD); await page.click("button[type=submit]");
    await page.waitForURL((u) => u.pathname !== "/login", { timeout: 120000 }).catch(() => {});
    await settle(page);
  }
  return page;
}

try {
  const a = await login("superadmin@firingi.test");
  // 1. one wholesaler, filled from the filters
  await go(a, "/admin/marketing/catalogues");
  check("catalogues page", await a.getByTestId("mc-list").isVisible());
  await tap(a, "[data-testid=mc-new]");
  await a.waitForURL(/catalogues\/new/);
  await settle(a);
  await a.getByTestId("mc-title").fill(TITLE);
  await tap(a, "[data-testid=mc-scope-WHOLESALER]");
  await a.getByTestId("mc-scope-ids").locator("label", { hasText: "Lisboa Central" }).locator("input").check();
  await a.getByTestId("mc-max").fill("12");
  await tap(a, "[data-testid=mc-save]");
  check("created", await until(async () => /catalogues\/c[a-z0-9]+$/.test(a.url())));
  await settle(a);
  await tap(a, "[data-testid=mc-fill]");
  check("filled from filters", await until(async () => (await a.getByTestId("mc-item").count()) >= 3), await a.locator("[role=alert]").allInnerTexts().then((x) => x.join(" | ")).catch(() => ""));
  const n = await a.getByTestId("mc-item").count();
  await a.getByTestId("mc-price").selectOption("GROSS");
  await a.getByTestId("mc-barcode").uncheck();
  await tap(a, "[data-testid=mc-save]");
  check("options saved", await until(async () => sql(`select options->>'price' || '/' || (options->>'barcode') from "MarketingCatalogue" where title='${TITLE}'`) === "GROSS/false"));
  const pdf = await a.request.get(`${BASE}/api/admin/marketing/catalogues/${a.url().split("/").pop()}/pdf`);
  check("PDF made", pdf.ok() && (await pdf.body()).subarray(0, 4).toString() === "%PDF", String(pdf.status()));
  await tap(a, "[data-testid=mc-publish]");
  check("published", await until(async () => (await a.getByTestId("mc-status").innerText()) === "published"));
  await shot(a, "01-editor", true);
  const link = (await a.getByTestId("mc-link").innerText()).trim();

  // 2. public share link (Portuguese), prices incl. VAT, no barcodes
  const pub = await login(null, { locale: "pt-PT" });
  await go(pub, link);
  check("public page", await pub.getByTestId("public-catalogue").isVisible() && (await pub.getByTestId("pc-title").innerText()) === TITLE);
  check("all products shown", (await pub.getByTestId("pc-item").count()) === n, `${await pub.getByTestId("pc-item").count()} / ${n}`);
  check("prices incl. VAT (Portuguese)", /c\/ IVA|com IVA/i.test(await pub.getByTestId("pc-price").first().innerText()), await pub.getByTestId("pc-price").first().innerText());
  check("no barcodes", !/Código de barras|Barcode/i.test(await pub.locator("main").innerText()));
  await shot(pub, "02-public", true);
  const dl = await pub.request.get(`${BASE}${link}/pdf`);
  check("public PDF download", dl.ok() && dl.headers()["content-type"] === "application/pdf");
  if (SHOTS) (await import("node:fs")).writeFileSync(`${SHOTS}/catalogue.pdf`, await dl.body());

  // 3. AI for a district (simulated)
  await go(a, "/admin/marketing/catalogues/new");
  await a.getByTestId("mc-title").fill("E2E draft");
  await tap(a, "[data-testid=mc-scope-DISTRICT]");
  await a.getByTestId("mc-scope-ids").locator("label").first().locator("input").check();
  await tap(a, "[data-testid=mc-save]");
  await until(async () => /catalogues\/c[a-z0-9]+$/.test(a.url()));
  await settle(a);
  await a.getByTestId("mc-brief").fill(`${AITITLE}, 6 products`);
  await tap(a, "[data-testid=mc-ai]");
  check("AI built it", await until(async () => (await a.getByTestId("mc-item").count()) === 6));
  check("AI wrote the title", await until(async () => (await a.getByTestId("mc-title").inputValue()).startsWith("E2E drinks")));
  await shot(a, "03-ai", true);
  // barcode + QR both on (defaults): scannable bars on the share link and in the PDF
  await tap(a, "[data-testid=mc-publish]");
  await until(async () => (await a.getByTestId("mc-status").innerText()) === "published");
  const link2 = (await a.getByTestId("mc-link").innerText()).trim();
  const pub2 = await login(null, { locale: "pt-PT" });
  await go(pub2, link2);
  check("barcodes drawn (scannable lines)", (await pub2.getByTestId("pc-bars").count()) >= 1, String(await pub2.getByTestId("pc-bars").count()));
  await shot(pub2, "02b-public-barcodes", true);
  const dl2 = await pub2.request.get(`${BASE}${link2}/pdf`);
  if (SHOTS) (await import("node:fs")).writeFileSync(`${SHOTS}/catalogue-bars.pdf`, await dl2.body());

  // 4. send: a campaign draft for the customers
  await go(a, "/admin/marketing/catalogues");
  await tap(a, a.getByTestId("mc-row").filter({ hasText: TITLE }).locator("a"));
  await settle(a);
  await tap(a, "[data-testid=mc-send]");
  check("campaign draft opened", await until(async () => /\/admin\/marketing\/campaigns\/c/.test(a.url())));
  check("campaign links the catalogue", sql(`select "ctaPath" from "MarketingCampaign" where name='Catalogue: ${TITLE}'`) === link);

  // 5. phone
  const ph = await login(null, { locale: "pt-PT", viewport: { width: 390, height: 844 } });
  await go(ph, link);
  check("phone: no sideways scroll", !(await ph.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)));
  await shot(ph, "04-public-phone", true);

  check("no page errors", errors.length === 0, errors.join(" | "));
} catch (e) {
  console.log("✘ crashed —", e.message); failures++;
} finally {
  await browser.close();
}
console.log(failures ? `\n${failures} failed` : "\nall passed");
process.exit(failures ? 1 : 0);
