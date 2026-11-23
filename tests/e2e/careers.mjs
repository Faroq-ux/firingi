/**
 * Browser test of the footer pages (FIRINGI only): the footer's "FIRINGI" column links Sustainability and Careers;
 * the sustainability page shows the starting text in the visitor's language (Portuguese); FIRINGI (English) writes
 * its own text and adds a job opening; a visitor applies on /careers; FIRINGI sees the application, sets it "in review"
 * and deletes it; FIRINGI switches Careers off (link and page gone) and on; phone width; no page errors.
 *   node tests/e2e/careers.mjs [baseUrl] [screenshotDir]
 */
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
const { chromium } = createRequire(import.meta.url)("playwright");

const DB = process.env.E2E_DATABASE_URL ?? "postgresql://postgres:postgres@localhost:5432/firingi";
const sql = (q) => execFileSync("psql", ["-At", DB, "-c", q], { encoding: "utf8" }).trim();
const BASE = process.argv[2] ?? "http://localhost:3000";
const SHOTS = process.argv[3] ?? null;
const PASSWORD = process.env.SEED_PASSWORD ?? "Firingi!2026";
let failures = 0;
const check = (name, ok, extra = "") => { console.log(`${ok ? "✔" : "✘"} ${name}${extra ? ` — ${extra}` : ""}`); if (!ok) failures++; };
const shot = async (page, name, full = true) => SHOTS && page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: full });
const settle = async (p) => { await p.waitForLoadState("networkidle").catch(() => {}); await p.waitForTimeout(600); };
const go = async (p, url) => { const r = await p.goto(`${BASE}${url}`, { timeout: 240000 }); await settle(p); return r; };
const until = async (fn, ms = 30000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await fn().catch(() => false)) return true; await new Promise((r) => setTimeout(r, 400)); } return false; };
const tap = async (p, sel) => { const l = typeof sel === "string" ? p.locator(sel).first() : sel; await l.evaluate((e) => e.scrollIntoView({ block: "center" })); await l.click(); };
const stamp = Date.now();
const EMAIL = `e2e-careers-${stamp}@example.test`;
const saved = sql(`select value::text from "Setting" where scope='GLOBAL' and "scopeId"='' and key='landing.settings'`);
function restore() {
  sql(`delete from "JobApplication" where email like 'e2e-careers-%'`);
  if (saved) sql(`update "Setting" set value='${saved.replace(/'/g, "''")}'::jsonb where scope='GLOBAL' and "scopeId"='' and key='landing.settings'`);
  else sql(`delete from "Setting" where scope='GLOBAL' and "scopeId"='' and key='landing.settings'`);
}
process.on("exit", restore);
sql(`delete from "Setting" where scope='GLOBAL' and "scopeId"='' and key='landing.settings'`);
const errors = [];
const browser = await chromium.launch();
async function visitor(opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 }, locale: "pt-PT", reducedMotion: "reduce", deviceScaleFactor: SHOTS ? 2 : 1, ...opts });
  const p = await ctx.newPage();
  p.setDefaultTimeout(240000);
  p.on("pageerror", (e) => errors.push(`visitor: ${e.message.slice(0, 160)}`));
  return p;
}
try {
  // 1. footer column + sustainability (starting text, Portuguese)
  const v = await visitor();
  await go(v, "/welcome");
  const col = v.getByTestId("foot-company");
  check("footer has the FIRINGI column", (await col.count()) === 1);
  check("Sustainability and Careers links", (await v.getByTestId("foot-sustainability").count()) === 1 && (await v.getByTestId("foot-careers").count()) === 1);
  check("links in Portuguese", /Sustentabilidade/.test(await col.innerText()) && /Carreiras/.test(await col.innerText()));
  await v.locator("footer").scrollIntoViewIfNeeded();
  await shot(v, "01-footer", false);
  await tap(v, "[data-testid=foot-sustainability]");
  await v.waitForURL(/\/sustainability/); await settle(v);
  check("sustainability page with the starting text", /Sustentabilidade/.test(await v.getByTestId("about-title").innerText()) && (await v.getByTestId("about-body").innerText()).length > 200);
  check("footer on the page too", (await v.getByTestId("foot-company").count()) === 1);
  await shot(v, "02-sustainability");

  // 2. FIRINGI writes its own text and adds an opening
  const actx = await browser.newContext({ viewport: { width: 1360, height: 900 }, locale: "en-GB", reducedMotion: "reduce", deviceScaleFactor: SHOTS ? 2 : 1 });
  const a = await actx.newPage(); a.setDefaultTimeout(240000);
  a.on("pageerror", (e) => errors.push(`admin: ${e.message.slice(0, 160)}`));
  await go(a, "/login"); await a.fill("#email", "superadmin@firingi.test"); await a.fill("#password", PASSWORD); await a.click("button[type=submit]");
  await a.waitForURL((u) => u.pathname !== "/login", { timeout: 60000 }).catch(() => {}); await settle(a);
  await go(a, "/admin/marketing/careers");
  check("admin page", (await a.getByTestId("about-form").count()) === 1);
  await a.getByTestId("about-page").selectOption("sustainability");
  await a.getByTestId("about-lang").selectOption("pt-PT");
  await a.fill("[data-testid=about-text]", "A FIRINGI reduz o desperdício. Texto da FIRINGI.");
  await tap(a, "[data-testid=job-add]");
  await a.fill("[data-testid=job-title]", "Motorista de entregas");
  await a.fill("[data-testid=job-location]", "Lisboa");
  await a.fill("[data-testid=job-text]", "Entregas a restaurantes com carrinha refrigerada.");
  await tap(a, "[data-testid=about-save]");
  check("saved", await until(async () => sql(`select value->'jobs'->0->>'title' from "Setting" where key='landing.settings'`) === "Motorista de entregas"));
  await shot(a, "03-admin-pages");
  await go(v, "/sustainability");
  check("FIRINGI's own Portuguese text shown", (await v.getByTestId("about-body").innerText()).includes("Texto da FIRINGI"));

  // 3. a visitor applies
  await go(v, "/careers");
  check("careers page lists the opening", (await v.getByTestId("job").count()) === 1 && /Motorista de entregas/.test(await v.getByTestId("jobs").innerText()));
  await v.waitForTimeout(3000); // a person needs a few seconds (spam check)
  const f = v.getByTestId("apply-form");
  await f.locator("input[name=name]").fill("Ana Teste");
  await f.locator("input[name=email]").fill(EMAIL);
  await f.locator("input[name=link]").fill("https://www.linkedin.com/in/ana-teste");
  await f.locator("textarea[name=message]").fill("Gosto de conduzir e de clientes.");
  await tap(v, f.locator("input[name=consent]"));
  await tap(v, "[data-testid=apply-send]");
  check("application sent", await until(async () => (await v.getByTestId("apply-msg").innerText().catch(() => "")).length > 5 && Number(sql(`select count(*) from "JobApplication" where email='${EMAIL}'`)) === 1));
  check("for the opening", sql(`select "jobTitle" from "JobApplication" where email='${EMAIL}'`) === "Motorista de entregas");
  await shot(v, "04-careers");

  // 4. FIRINGI sees it, sets "in review", deletes it
  await go(a, "/admin/marketing/careers");
  const row = a.locator("[data-testid=app-row]", { hasText: "Ana Teste" }).first();
  check("application listed", (await row.count()) === 1);
  await shot(a, "05-admin-applications");
  await a.waitForTimeout(2000); // page fully ready before changing the status
  await row.getByTestId("app-status").selectOption("REVIEWING");
  check("in review", await until(async () => sql(`select status from "JobApplication" where email='${EMAIL}'`) === "REVIEWING"));
  a.on("dialog", (d) => d.accept());
  await go(a, "/admin/marketing/careers");
  await tap(a, a.locator("[data-testid=app-row]", { hasText: "Ana Teste" }).first().getByTestId("app-delete"));
  check("deleted (GDPR)", await until(async () => Number(sql(`select count(*) from "JobApplication" where email='${EMAIL}'`)) === 0));

  // 5. careers off → link and page gone; back on
  await go(a, "/admin/marketing/careers");
  await tap(a, "[data-testid=about-on-careers]");
  await tap(a, "[data-testid=about-save]");
  check("careers switched off", await until(async () => sql(`select value->'about'->'careers'->>'on' from "Setting" where key='landing.settings'`) === "false"));
  await go(v, "/welcome");
  check("careers link gone, sustainability stays", (await v.getByTestId("foot-careers").count()) === 0 && (await v.getByTestId("foot-sustainability").count()) === 1);
  check("careers page gone", (await v.goto(`${BASE}/careers`))?.status() === 404);
  await go(a, "/admin/marketing/careers");
  await tap(a, "[data-testid=about-on-careers]");
  await tap(a, "[data-testid=about-save]");
  check("careers back on", await until(async () => sql(`select value->'about'->'careers'->>'on' from "Setting" where key='landing.settings'`) === "true"));

  // 6. phone
  const ph = await visitor({ viewport: { width: 390, height: 844 } });
  await go(ph, "/careers");
  check("phone: no sideways scroll", await ph.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
  await shot(ph, "06-careers-phone");
} finally {
  check("no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
  await browser.close();
}
console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
process.exit(failures ? 1 : 0);
