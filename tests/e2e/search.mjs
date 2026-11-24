/**
 * Browser test of Phase 72 (smart search). Customer in Portuguese: a typo and missing accents still find the product,
 * the (simulated) AI reads a sentence — product word, cheapest first, max price — shown as chips that can be removed,
 * filters (category, max price) and clear; FIRINGI (English) adds a synonym and the customer finds the product by it,
 * deletes it; AI switched off → no AI line but typo matching still works; phone width, dark; no page errors.
 *   node tests/e2e/search.mjs [baseUrl] [screenshotDir]      (server with ASSISTANT_SIMULATE=1 and no AI key)
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
const until = async (fn, ms = 30000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await fn().catch(() => false)) return true; await new Promise((r) => setTimeout(r, 400)); } return false; };
const sql = (q) => execFileSync("psql", ["-At", DB, "-c", q], { encoding: "utf8" }).trim();
const tap = async (p, sel) => { const l = typeof sel === "string" ? p.locator(sel).first() : sel; await l.evaluate((e) => e.scrollIntoView({ block: "center" })); await l.click(); };
const hits = async (p) => p.locator("[data-testid=search-hit]").evaluateAll((els) => els.map((e) => e.getAttribute("data-product")));
const search = (q, extra = "") => `/buy/catalogue/search?q=${encodeURIComponent(q)}${extra}`;

const saved = sql(`select value::text from "Setting" where scope='GLOBAL' and "scopeId"='' and key='search.settings'`);
const restore = () => {
  sql(`delete from "SearchSynonym" where term in ('aqua','mozarela','mozzarella','agua','luso')`);
  sql(`delete from "SearchUnderstanding"`);
  if (saved) sql(`update "Setting" set value='${saved.replace(/'/g, "''")}'::jsonb where scope='GLOBAL' and "scopeId"='' and key='search.settings'`);
  else sql(`delete from "Setting" where scope='GLOBAL' and "scopeId"='' and key='search.settings'`);
};
restore();
sql(`delete from "Setting" where scope='GLOBAL' and "scopeId"='' and key='search.settings'`);
process.on("exit", restore);

const errors = [];
const browser = await chromium.launch();
async function login(email, opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 }, locale: "pt-PT", reducedMotion: "reduce", deviceScaleFactor: SHOTS ? 2 : 1, serviceWorkers: "block", ...opts });
  const page = await ctx.newPage();
  page.setDefaultTimeout(240000);
  page.on("pageerror", (e) => errors.push(`${email}: ${e.message.slice(0, 160)}`));
  page.on("dialog", (d) => d.accept());
  await go(page, "/login");
  await page.fill("#email", email); await page.fill("#password", PASSWORD); await page.click("button[type=submit]");
  await page.waitForURL((u) => u.pathname !== "/login", { timeout: 120000 }).catch(() => {});
  await settle(page);
  return page;
}

try {
  const c = await login("owner@kebabhouse.test");
  // 1. typo + accents
  await go(c, search("mozarela"));
  check("typo: 'mozarela' finds the mozzarella", (await hits(c)).includes("Mozzarella block 2kg"), (await hits(c)).join(", "));
  check("the AI's reading is shown (simulated)", await c.getByTestId("understood-words").isVisible() && /mozzarella/.test(await c.getByTestId("understood-words").innerText()));
  check("did you mean …", (await c.getByTestId("did-you-mean").count()) === 1);
  await shot(c, "01-typo", true);
  await go(c, search("agua luso"));
  check("no accents: 'agua luso' finds Água Luso", (await hits(c)).includes("Luso still water 1.5L"));

  // 2. a sentence: product + cheapest + max price → chips
  await go(c, search("mozarela mais barato até 1000 euros"));
  check("sentence: product found", (await hits(c)).includes("Mozzarella block 2kg"));
  check("chips: max price and cheapest first", (await c.getByTestId("chip-max").count()) === 1 && (await c.getByTestId("chip-sort").count()) === 1);
  check("filters show the AI's choices", (await c.getByTestId("sf-sort").inputValue()) === "price" && (await c.getByTestId("sf-max").inputValue()) === "1000");
  await shot(c, "02-sentence", true);
  await tap(c, "[data-testid=chip-max]");
  await until(async () => c.url().includes("aif=0")); await settle(c);
  check("chip removed: no max price, AI filters off, sort kept", !c.url().includes("max=") && c.url().includes("aif=0") && c.url().includes("sort=price") && (await c.getByTestId("chip-max").count()) === 0, c.url());
  check("still finds it", (await hits(c)).includes("Mozzarella block 2kg"));

  // 3. filters
  await go(c, search("mozzarella"));
  const cat = c.getByTestId("sf-cat");
  const catOpts = await cat.locator("option").count();
  check("category facets offered", catOpts >= 2);
  await cat.selectOption({ index: 1 });
  await tap(c, "[data-testid=sf-apply]"); await settle(c);
  check("category filter applied", c.url().includes("cat=") && (await hits(c)).includes("Mozzarella block 2kg"));
  await c.getByTestId("sf-max").fill("0.01");
  await tap(c, "[data-testid=sf-apply]"); await settle(c);
  check("max price 0.01 → nothing, with advice", (await hits(c)).length === 0 && (await c.getByTestId("no-results").count()) === 1);
  await tap(c, "[data-testid=sf-clear]");
  await until(async () => !c.url().includes("max=")); await settle(c);
  check("clear filters", !c.url().includes("max=") && (await hits(c)).includes("Mozzarella block 2kg"), c.url());

  // 4. FIRINGI adds a synonym → found by it → deleted
  await go(c, search("aqua"));
  check("before: 'aqua' does not find the water", !(await hits(c)).includes("Luso still water 1.5L"));
  const a = await login("superadmin@firingi.test", { locale: "en-GB" });
  await go(a, "/admin/catalogue/search");
  check("admin page", (await a.getByTestId("search-settings").count()) === 1 && (await a.getByTestId("syn-new").count()) === 1);
  await a.waitForTimeout(1500);
  const n = a.getByTestId("syn-new");
  await n.getByTestId("syn-term").fill("aqua"); await n.getByTestId("syn-alts").fill("water, agua");
  await tap(a, n.getByTestId("syn-save"));
  check("synonym saved", await until(async () => sql(`select source from "SearchSynonym" where term='aqua'`) === "ADMIN"));
  await settle(a);
  await shot(a, "03-admin", true);
  await go(c, search("aqua"));
  check("after: 'aqua' finds the water", (await hits(c)).includes("Luso still water 1.5L"));
  await go(a, "/admin/catalogue/search");
  await a.waitForTimeout(1500);
  await tap(a, a.locator("[data-testid=syn-row][data-term=aqua]").getByTestId("syn-delete"));
  check("synonym deleted", await until(async () => sql(`select count(*) from "SearchSynonym" where term='aqua'`) === "0"));

  // 5. AI off → no AI line, typos still matched
  await go(a, "/admin/catalogue/search");
  await a.waitForTimeout(1500);
  await tap(a, "[data-testid=ss-ai]");
  await tap(a, "[data-testid=ss-save]");
  check("AI switched off", await until(async () => sql(`select value->>'ai' from "Setting" where key='search.settings'`) === "false"));
  await go(c, search("mozarela queijo"));
  check("no AI line when off", (await c.getByTestId("understood-words").count()) === 0);
  check("typos still matched (most words)", (await hits(c)).includes("Mozzarella block 2kg"));

  // 6. phone, dark
  const ph = await login("owner@kebabhouse.test", { viewport: { width: 390, height: 844 }, colorScheme: "dark", isMobile: true, hasTouch: true });
  await go(ph, search("mozzarella"));
  check("phone: no sideways scroll", await ph.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
  await shot(ph, "04-phone-dark", true);
} catch (e) {
  console.log("✘ crashed —", e.message.split("\n")[0]); failures++;
} finally {
  check("no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
  await browser.close();
}
console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
process.exit(failures ? 1 : 0);
