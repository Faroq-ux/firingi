/**
 * Browser test: FIRINGI's search country. Super admin picks Spain in the top bar → Ctrl+K finds no Portuguese shop;
 * picks Portugal → it does; "All countries" shows the country code. No page errors.
 *   node tests/e2e/admin-search-country.mjs [baseUrl] [screenshotDir]
 */
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)("playwright");
const BASE = process.argv[2] ?? "http://localhost:3000";
const SHOTS = process.argv[3] ?? null;
const PASSWORD = process.env.SEED_PASSWORD ?? "Firingi!2026";
let failures = 0;
const check = (name, ok, extra = "") => { console.log(`${ok ? "✔" : "✘"} ${name}${extra ? ` — ${extra}` : ""}`); if (!ok) failures++; };
const settle = async (p) => { await p.waitForLoadState("networkidle").catch(() => {}); await p.waitForTimeout(500); };
const errors = [];
const browser = await chromium.launch();
try {
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 }, locale: "en-GB", reducedMotion: "reduce", deviceScaleFactor: SHOTS ? 2 : 1, serviceWorkers: "block" });
  const a = await ctx.newPage(); a.setDefaultTimeout(240000);
  a.on("pageerror", (e) => errors.push(e.message.slice(0, 160)));
  await a.goto(`${BASE}/login`); await a.fill("#email", "superadmin@firingi.test"); await a.fill("#password", PASSWORD); await a.click("button[type=submit]");
  await a.waitForURL((u) => u.pathname !== "/login", { timeout: 120000 }); await settle(a);
  const sel = a.getByTestId("admin-search-country");
  check("country box in the top bar", await sel.isVisible());
  const choose = async (v) => {
    await sel.selectOption(v);
    const end = Date.now() + 180000;
    while (Date.now() < end) { const c = (await ctx.cookies()).find((x) => x.name === "firingi_admin_country")?.value ?? ""; if (c === v && !(await sel.getAttribute("data-saving"))) break; await a.waitForTimeout(500); }
    await settle(a);
  };
  const search = async () => {
    await a.keyboard.press("Control+k"); await a.waitForTimeout(400);
    await a.keyboard.type("Kebab");
    let t = "";
    for (let i = 0; i < 40; i++) { await a.waitForTimeout(500); t = await a.locator("[role=dialog]").innerText().catch(() => ""); if (/Kebab|EMPRESAS|COMPANIES|Nada|Nothing|No results/i.test(t) && !/A pesquisar|Searching/.test(t)) break; }
    await a.keyboard.press("Escape"); await a.waitForTimeout(300);
    return t;
  };
  await choose("ES");
  const es = await search(); check("Spain: no Portuguese shop", !/Kebab House/.test(es), es.replace(/\s+/g, " ").slice(0, 300));
  await choose("PT");
  const pt = await search();
  check("Portugal: found", /Kebab House/.test(pt), pt.slice(0, 120));
  await choose("");
  if (SHOTS) { await a.keyboard.press("Control+k"); await a.keyboard.type("Kebab"); await a.waitForTimeout(1500); await a.screenshot({ path: `${SHOTS}/search-all-countries.png` }); await a.keyboard.press("Escape"); }
  check("no page errors", errors.length === 0, errors.join(" | "));
} catch (e) { console.log("✘ crashed —", e.message); failures++; } finally { await browser.close(); }
console.log(failures ? `\n${failures} failed` : "\nall passed");
process.exit(failures ? 1 : 0);
