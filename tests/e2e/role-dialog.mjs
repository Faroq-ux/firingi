/**
 * Pop-up forms must sit on top of the page (they used to open behind the role cards).
 * Checks the "New role" form on the admin, supplier and customer Roles pages, at desktop and phone width:
 * the point in the middle of the form must belong to the form, and a role can be saved and deleted.
 * Run: node tests/e2e/role-dialog.mjs http://localhost:3100
 */
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)("playwright");

const BASE = process.argv[2] ?? "http://localhost:3000";
const PASSWORD = process.env.SEED_PASSWORD ?? "Firingi!2026";
const CASES = [
  ["superadmin@firingi.test", "/admin/users/roles", 1360],
  ["superadmin@firingi.test", "/admin/users/roles", 390],
  ["owner@atlantico.test", "/vendor/company/roles", 1360],
  ["owner@kebabhouse.test", "/buy/company/roles", 390],
];
let failed = 0;
const ok = (c, m) => { console.log(`${c ? "✓" : "✗"} ${m}`); if (!c) failed++; };

const browser = await chromium.launch();
for (const [email, path, width] of CASES) {
  const ctx = await browser.newContext({ viewport: { width, height: 900 }, locale: "en-GB", serviceWorkers: "block" });
  const page = await ctx.newPage(); page.setDefaultTimeout(240000);
  await page.goto(BASE + "/login"); await page.fill("#email", email); await page.fill("#password", PASSWORD); await page.click("button[type=submit]");
  await page.waitForURL((u) => u.pathname !== "/login");
  await page.goto(BASE + path); await page.waitForLoadState("networkidle").catch(() => {});
  await page.locator("main button").filter({ has: page.locator("svg.lucide-plus") }).first().click();
  const dlg = page.locator("[role=dialog] form").first(); await dlg.waitFor();
  const onTop = await dlg.evaluate((f) => {
    const r = f.getBoundingClientRect();
    const pts = [[0.5, 0.15], [0.5, 0.5], [0.5, 0.85], [0.1, 0.5], [0.9, 0.5]];
    return pts.every(([x, y]) => f.contains(document.elementFromPoint(r.left + r.width * x, r.top + r.height * y)));
  });
  ok(onTop, `${path} @${width}: New role form is on top of the page`);
  const name = `E2E role ${Date.now()}`;
  await dlg.locator("#rname").fill(name);
  await dlg.locator("input[type=checkbox]").first().check();
  await dlg.locator("button[type=submit]").click();
  await page.locator("[role=dialog]").waitFor({ state: "detached" });
  const saved = await page.getByText(name).first().waitFor({ timeout: 60000 }).then(() => true, () => false);
  ok(saved, `${path} @${width}: role saved`);
  page.on("dialog", (d) => d.accept());
  const del = page.locator(`text=${name}`).locator("xpath=ancestor::*[.//button][1]").locator("button", { hasText: /Delete|Eliminar/ });
  let gone = false;
  if (saved && await del.count()) { await del.first().click(); gone = await page.getByText(name).first().waitFor({ state: "detached", timeout: 60000 }).then(() => true, () => false); }
  ok(gone, `${path} @${width}: role deleted again`);
  await ctx.close();
}
await browser.close();
console.log(failed ? `\n${failed} failed` : "\nAll passed");
process.exit(failed ? 1 : 0);
