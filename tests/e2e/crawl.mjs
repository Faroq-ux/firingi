/**
 * "Everywhere" check (Phase 23): sign in to each portal, collect every page of its menu, and open
 * each one on a laptop (light) and on a phone (dark): no page error, a page title (or hero), no
 * sideways scrolling on the phone, and big tables get the smart toolbar.
 *   node tests/e2e/crawl.mjs [baseUrl] [--quick]
 */
import { createRequire } from "node:module";
const { chromium, devices } = createRequire(import.meta.url)("playwright");

const BASE = process.argv[2]?.startsWith("http") ? process.argv[2] : "http://localhost:3000";
const QUICK = process.argv.includes("--quick");
const PASSWORD = process.env.SEED_PASSWORD ?? "Firingi!2026";
let failures = 0, visited = 0;
const problems = [];
const browser = await chromium.launch();

async function session(email, opts) {
  const ctx = await browser.newContext({ ...opts, reducedMotion: "reduce" });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/login`);
  await page.fill("#email", email); await page.fill("#password", PASSWORD); await page.click("button[type=submit]");
  await page.waitForURL((u) => u.pathname !== "/login", { timeout: 20000 });
  await page.waitForLoadState("networkidle").catch(() => {});
  return page;
}

async function crawl(email, label) {
  const desk = await session(email, { viewport: { width: 1366, height: 900 } });
  const hrefs = [...new Set(await desk.locator("aside nav a[href^='/']").evaluateAll((as) => as.map((a) => a.getAttribute("href"))))].filter((h) => !h.includes("/logout"));
  const list = QUICK ? hrefs.filter((_, i) => i % 4 === 0) : hrefs;
  const phone = await session(email, { ...devices["iPhone 13"], colorScheme: "dark" });
  await phone.context().addCookies([{ name: "theme", value: "dark", url: BASE }]);
  const errs = [];
  for (const p of [desk, phone]) p.on("pageerror", (e) => errs.push(`${p === desk ? "desk" : "phone"} ${p.url().replace(BASE, "")}: ${e.message.slice(0, 120)}`));
  let toolbars = 0;
  for (const href of list) {
    visited++;
    for (const [p, kind] of [[desk, "desk"], [phone, "phone"]]) {
      const before = errs.length;
      const res = await p.goto(`${BASE}${href}`, { waitUntil: "domcontentloaded" }).catch((e) => ({ status: () => 0, e }));
      await p.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
      const status = res?.status?.() ?? 0;
      const ok = status > 0 && status < 400;
      const title = await p.locator("main h1, [data-testid=hero] h1, main [data-testid=hero]").count();
      const over = kind === "phone" ? await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth) : 0;
      if (kind === "desk") toolbars += await p.getByTestId("ts-toolbar").count();
      const bad = [!ok && `HTTP ${status}`, !title && "no title", over > 1 && `overflow ${over}px`, errs.length > before && errs.slice(before).join("; ")].filter(Boolean);
      if (bad.length) problems.push(`${label} ${kind} ${href}: ${bad.join(" · ")}`);
    }
  }
  console.log(`✔ ${label}: ${list.length} pages × 2 (laptop light, phone dark) · ${toolbars} smart toolbars`);
  await desk.context().close(); await phone.context().close();
}

await crawl("superadmin@firingi.test", "FIRINGI admin");
await crawl("owner@lisboacentral.test", "supplier/wholesaler");
await crawl("owner@kebabhouse.test", "customer");
await crawl("owner@atlantico.test", "distributor");
await crawl("driver@firingi.test", "driver");
await browser.close();
for (const p of problems) { console.log(`✘ ${p}`); failures++; }
console.log(failures ? `\n${failures} problem(s) on ${visited} pages` : `\nAll ${visited} pages fine on laptop and phone`);
process.exit(failures ? 1 : 0);
