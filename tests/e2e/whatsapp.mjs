/**
 * Browser test of Phase 58 (WhatsApp ordering with AI). FIRINGI in English, the customer in Portuguese:
 * the Kebab House writes from its WhatsApp number (setup script, simulated AI) → proposal → "sim" places the order
 * marked WhatsApp → FIRINGI's WhatsApp Orders page lists the conversation, the proposal and the order; staff take
 * over and give back → settings: wholesalers switched on and off, small orders limited (0 for the Kebab House) →
 * the customer's cart says to reach the wholesaler's free-delivery amount → the customer's WhatsApp page (Portuguese)
 * shows FIRINGI's number, its own number, the order and small orders used; reminders switched on → phone width →
 * no page errors. Cleans up after itself.
 *   node tests/e2e/whatsapp.mjs [baseUrl] [screenshotDir]
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
const until = async (fn, ms = 20000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await fn().catch(() => false)) return true; await new Promise((r) => setTimeout(r, 400)); } return false; };
const sql = (q) => execFileSync("psql", ["-At", DB, "-c", q], { encoding: "utf8" }).trim();
const errors = [];
const PHONE = { width: 390, height: 844 };
async function login(email, opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 }, locale: "en-GB", reducedMotion: "reduce", deviceScaleFactor: SHOTS ? 2 : 1, serviceWorkers: "block", ...opts });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(`${email}: ${e.message.slice(0, 160)}`));
  page.on("dialog", (d) => d.accept());
  await go(page, "/login");
  await page.fill("#email", email); await page.fill("#password", PASSWORD); await page.click("button[type=submit]");
  await page.waitForURL((u) => u.pathname !== "/login", { timeout: 15000 }).catch(() => {});
  await settle(page);
  return page;
}
const noSideways = async (p, label) => {
  const over = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check(`phone width: no sideways scrolling (${label})`, over <= 1, `${over}px`);
};
const wa = (...texts) => execFileSync("npx", ["tsx", "--require", "./tests/e2e/setup/no-server-only.cjs", "tests/e2e/setup/wa-inbound.ts", NUM, ...texts], { encoding: "utf8", env: { ...process.env, ASSISTANT_SIMULATE: "1", WA_MEDIA_SIMULATE: "1", ANTHROPIC_API_KEY: "" } })
  .trim().split("\n").filter((l) => l.startsWith("{")).map((l) => JSON.parse(l));

const NUM = "+351910000058";
const KEBAB = sql(`select id from "Company" where "legalName"='Kebab House Lisboa, Lda'`);
const KEBAB_USER = sql(`select u.id from "User" u where u.email='owner@kebabhouse.test'`);
const cleanup = () => {
  sql(`update "Company" set whatsapp=null, "whatsappReminders"=false, "smallOrdersPerMonth"=null, "smallOrdersUnlimited"=false where id='${KEBAB}'`);
  sql(`delete from "Setting" where key in ('whatsapp.ordering','orders.smallOrders')`);
  sql(`delete from "WaOrderDraft" where "companyId"='${KEBAB}'`);
  sql(`delete from "AiConversation" where "companyId"='${KEBAB}' and channel='WHATSAPP'`);
  sql(`delete from "CartItem" where "cartId" in (select id from "Cart" where "userId"='${KEBAB_USER}')`);
};
cleanup();
sql(`update "Company" set whatsapp='${NUM}' where id='${KEBAB}'`);

// ── the customer writes on WhatsApp ──
const [ask, yes] = wa("add 6 Arroz", "sim");
check("the AI proposes the order with the total and asks for YES (Portuguese)", ask.result === "DONE" && /Total/.test(ask.reply) && ask.reply.includes("SIM"), ask.reply.slice(-160));
const ORDER = sql(`select number from "Order" where "buyerCompanyId"='${KEBAB}' and "placedVia"='WHATSAPP' order by "placedAt" desc limit 1`);
check("\"sim\" places the order, marked WhatsApp", yes.result === "DONE" && !!ORDER && yes.reply.includes(ORDER), yes.reply);

const admin = await login("superadmin@firingi.test");
const customer = await login("owner@kebabhouse.test", { locale: "pt-PT" });

// ── FIRINGI: WhatsApp Orders ──
await go(admin, "/admin/notifications/whatsapp-ordering");
check("the overview counts the WhatsApp order", (await admin.getByTestId("wa-tiles").textContent()).includes("Orders by WhatsApp (30 days)"));
check("…lists the conversation", (await admin.getByTestId("wa-conversations").textContent()).includes("Kebab House"));
check("…the placed proposal", /Kebab House[\s\S]*Placed/.test(await admin.getByTestId("wa-drafts").textContent()));
check("…and the order", (await admin.getByTestId("wa-orders").textContent()).includes(ORDER));
await shot(admin, "p58-01-overview", true);
const CONV = sql(`select id from "AiConversation" where "companyId"='${KEBAB}' and channel='WHATSAPP' order by "updatedAt" desc limit 1`);
await admin.getByTestId(`wa-pause-${CONV}`).click();
check("staff take over: the AI is paused", await until(async () => sql(`select ("aiPausedUntil" > now())::text from "AiConversation" where id='${CONV}'`) === "true"));
check("…a message now gets no AI answer", wa("olá?")[0].result === "SKIPPED");
await go(admin, "/admin/notifications/whatsapp-ordering");
await admin.getByTestId(`wa-pause-${CONV}`).click();
check("…given back to the AI", await until(async () => sql(`select coalesce("aiPausedUntil"::text,'') from "AiConversation" where id='${CONV}'`) === ""));

// ── FIRINGI: settings ──
await go(admin, "/admin/settings/whatsapp-ordering");
check("wholesalers are off by default", (await admin.getByTestId("wa-aud-wholesalers").getAttribute("aria-checked")) === "false");
await admin.getByTestId("wa-aud-wholesalers").click();
await admin.getByTestId("wa-save").click();
check("…switched on and saved", await until(async () => sql(`select value->'audiences'->>'wholesalers' from "Setting" where key='whatsapp.ordering'`) === "true"));
await admin.getByTestId("wa-aud-wholesalers").click();
await admin.getByTestId("wa-save").click();
await until(async () => sql(`select value->'audiences'->>'wholesalers' from "Setting" where key='whatsapp.ordering'`) === "false");
await admin.getByTestId("small-enabled").click();
await admin.getByTestId("small-per-month").fill("4");
await admin.getByTestId("small-save").click();
check("small orders limited to 4 a month", await until(async () => sql(`select value::text from "Setting" where key='orders.smallOrders'`).includes('"perMonth": 4')));
await admin.getByTestId(`small-co-${KEBAB}`).fill("0");
await admin.getByTestId(`small-co-save-${KEBAB}`).click();
check("…the Kebab House gets its own limit of 0", await until(async () => sql(`select "smallOrdersPerMonth" from "Company" where id='${KEBAB}'`) === "0"));
await go(admin, "/admin/settings/whatsapp-ordering");
const USED = sql(`select count(*) from "Order" where "buyerCompanyId"='${KEBAB}' and "smallOrder" and status<>'CANCELLED' and "placedAt" >= date_trunc('month', now() at time zone 'UTC') at time zone 'UTC'`);
check("…the businesses table shows its small orders this month", Number(USED) >= 1 && (await admin.getByTestId(`wa-business-${KEBAB}`).textContent()).includes(`${USED} / 0`), `${USED} used`);
await shot(admin, "p58-02-settings", true);

// ── the customer: cart and WhatsApp page (Portuguese) ──
const blocked = wa("add 6 Arroz")[0];
check("on WhatsApp the AI says the free-delivery amount must be reached", /SMALL_ORDER_LIMIT/.test(blocked.reply), blocked.reply);
await go(customer, "/buy/orders/cart");
check("the cart says the small orders are used (Portuguese)", await until(async () => (await customer.getByTestId("small-orders").textContent()).length > 10));
check("…and how much more to add for the wholesaler's free delivery", /entrega grátis|gratuita/i.test(await customer.getByTestId("group-delivery").first().textContent()), await customer.getByTestId("group-delivery").first().textContent());
await shot(customer, "p58-03-cart");
await go(customer, "/buy/company/whatsapp");
check("the WhatsApp page is in Portuguese and shows the customer's number", /WhatsApp/.test(await customer.textContent("main")) && (await customer.getByTestId("wa-mine").textContent()).includes(NUM));
check("…its WhatsApp order", (await customer.getByTestId("wa-my-orders").textContent()).includes(ORDER));
check("…and the small orders used", (await customer.getByTestId("wa-small").isVisible()));
await customer.getByTestId("wa-my-reminders").click();
await customer.getByTestId("wa-my-save").click();
check("…reorder reminders switched on", await until(async () => sql(`select "whatsappReminders"::text from "Company" where id='${KEBAB}'`) === "true"));
await shot(customer, "p58-04-customer", true);

// ── phone width ──
await admin.setViewportSize(PHONE);
await go(admin, "/admin/notifications/whatsapp-ordering");
await noSideways(admin, "FIRINGI WhatsApp Orders");
await customer.setViewportSize(PHONE);
await go(customer, "/buy/company/whatsapp");
await noSideways(customer, "customer WhatsApp page");
await shot(customer, "p58-05-phone");

check("no page errors", errors.length === 0, errors.join(" | "));
cleanup();
await browser.close();
console.log(failures ? `\n${failures} check(s) failed` : "\nAll WhatsApp ordering checks passed");
process.exit(failures ? 1 : 0);
