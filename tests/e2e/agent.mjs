/**
 * Browser test of the Assistant as support & sales agent, against a server started with
 * ASSISTANT_SIMULATE=1 and no API key (a fixed-rule stand-in for the AI — no live AI calls):
 * customer (Portuguese) — tapping an example "add 2 boxes of olive oil to my cart" fills the cart
 * (card + link; nothing ordered), asking by voice for a person offers the hand-over, one tap opens a
 * Help & Support request with the summary and the chat (shown as sent after a reload, once only),
 * FIRINGI support sees it; read-aloud; phone width and dark mode;
 * supplier — support only (no cart), hand-over works too; FIRINGI switches it off → gone.
 *   ASSISTANT_SIMULATE=1 next start …  then  node tests/e2e/agent.mjs [baseUrl] [screenshotDir]
 */
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)("playwright");

const BASE = process.argv[2] ?? "http://localhost:3000";
const SHOTS = process.argv[3] ?? null;
const PASSWORD = process.env.SEED_PASSWORD ?? "Firingi!2026";
let failures = 0;
const check = (name, ok, extra = "") => { console.log(`${ok ? "✔" : "✘"} ${name}${extra ? ` — ${extra}` : ""}`); if (!ok) failures++; };
const shot = async (page, name, full = false) => SHOTS && page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: full });
const browser = await chromium.launch();
const settle = async (p) => { await p.waitForLoadState("networkidle").catch(() => {}); await p.waitForTimeout(400); };
const go = async (p, url) => { await p.goto(`${BASE}${url}`); await settle(p); };
const until = async (fn, ms = 20000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await fn().catch(() => false)) return true; await new Promise((r) => setTimeout(r, 250)); } return false; };
const errors = [];

/** A fake speech engine: the microphone "hears" `sentence`; read-aloud is recorded. */
const fakeSpeech = (sentence) => `(() => {
  const sentence = ${JSON.stringify(sentence)};
  class FakeRec { constructor() { this.lang = ""; } start() { window.__recLang = this.lang; setTimeout(() => { const r = [{ transcript: sentence }]; r.isFinal = true; this.onresult && this.onresult({ resultIndex: 0, results: [r] }); setTimeout(() => this.onend && this.onend(), 50); }, 150); } stop() { this.onend && this.onend(); } abort() {} }
  window.SpeechRecognition = FakeRec; window.webkitSpeechRecognition = FakeRec; window.__spoken = [];
  try { Object.defineProperty(window, "speechSynthesis", { value: { speaking: false, getVoices: () => [], cancel() {}, speak(u) { window.__spoken.push({ text: u.text, lang: u.lang }); } }, configurable: true }); } catch {}
  window.SpeechSynthesisUtterance = window.SpeechSynthesisUtterance || function (t) { this.text = t; };
})();`;
async function login(email, { sentence = "", viewport = { width: 1280, height: 900 }, colorScheme = "light" } = {}) {
  const ctx = await browser.newContext({ viewport, colorScheme, reducedMotion: "reduce", deviceScaleFactor: SHOTS ? 2 : 1 });
  if (sentence) await ctx.addInitScript(fakeSpeech(sentence));
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(`${email} @ ${page.url().replace(BASE, "")}: ${e.message.slice(0, 140)}`));
  await go(page, "/login");
  await page.fill("#email", email); await page.fill("#password", PASSWORD); await page.click("button[type=submit]");
  await page.waitForURL((u) => u.pathname !== "/login", { timeout: 15000 }).catch(() => {});
  await settle(page);
  return page;
}
const answers = (p) => p.getByTestId("msg-assistant");
const waitAnswer = async (p, n) => until(async () => (await answers(p).count()) >= n && (await p.getByTestId("thinking").count()) === 0, 30000);
const clearCart = async (p) => { await go(p, "/buy/orders/cart"); const b = p.getByRole("button", { name: /Esvaziar carrinho|Clear cart/ }); if (await b.count()) { await b.click(); await settle(p); } };

// ── 1. Customer (Portuguese): the agent fills the cart ──
const k = await login("owner@kebabhouse.test", { sentence: "Quero falar com uma pessoa sobre a fatura" });
await clearCart(k);
await go(k, "/buy/assistant");
check("Assistant page: support & sales agent description (Portuguese)", /assistente da FIRINGI/.test(await k.textContent("main")) && /pôr produtos no seu carrinho/.test(await k.textContent("main")));
const examples = k.getByTestId("examples").locator("button");
check("examples in Portuguese", (await examples.count()) === 4 && /Adiciona 2 caixas de azeite/.test(await examples.first().textContent()));
await shot(k, "agent-01-customer-start");
await examples.first().click();
check("answer arrives", await waitAnswer(k, 1));
const card = k.getByTestId("cart-card");
check("cart card: product added (Portuguese)", (await card.count()) === 1 && /adicionado ao carrinho/.test(await card.textContent()) && /ainda não encomendado/.test(await card.textContent()), (await card.textContent().catch(() => "")) ?? "");
check("tools shown as \"Adicionado ao carrinho\"", /Adicionado ao carrinho/.test(await answers(k).first().textContent()));
await shot(k, "agent-02-cart-filled");
await card.getByTestId("open-cart").click();
await k.waitForURL(/\/buy\/orders\/cart/, { timeout: 15000 }).catch(() => {});
await settle(k);
check("the product is in the cart — not ordered", /azeite/i.test(await k.textContent("main")) && (await k.getByRole("button", { name: /Fazer encomenda|Encomendar|Place order/ }).count()) > 0);
await k.goBack(); await settle(k);

// ── 2. Voice: ask for a person → hand-over offered → one tap sends it to FIRINGI support ──
await go(k, "/buy/assistant");
await k.getByTestId("mic").click();
check("spoken question in the box", await until(async () => /Quero falar com uma pessoa/.test(await k.getByTestId("chat-input").inputValue())));
await k.getByTestId("chat-input").press("Enter");
check("answer arrives", await waitAnswer(k, 1));
const ho = k.getByTestId("handover-card");
check("hand-over card offered (Portuguese)", (await ho.count()) === 1 && /Passar isto ao suporte da FIRINGI/.test(await ho.textContent()));
const said = answers(k).last().getByTestId("speak");
await said.click();
check("the answer can be read aloud", (await k.evaluate(() => window.__spoken.length)) === 1 && (await k.evaluate(() => window.__spoken[0].lang)) === "pt-PT");
await said.click();
await shot(k, "agent-03-handover-offered");
const chatUrl = k.url().replace(BASE, "");
await ho.getByTestId("handover-send").click();
check("sent to FIRINGI support with a request number", await until(async () => /Enviado ao suporte da FIRINGI — pedido TK/.test(await ho.textContent())));
await shot(k, "agent-04-handover-sent");
await ho.getByTestId("handover-open").click();
await k.waitForURL(/\/buy\/support\/[a-z0-9]+/, { timeout: 15000 }).catch(() => {});
await settle(k);
const thread = await k.getByTestId("thread").textContent().catch(() => "");
check("Help & Support request holds the summary and the chat", /asked for a person/.test(thread) && /Customer: Quero falar com uma pessoa/.test(thread), thread.slice(0, 120));
const ticketUrl = k.url().replace(BASE, "");
await go(k, chatUrl);
check("after a reload the card shows it was sent (no second request)", (await k.getByTestId("handover-send").count()) === 0 && (await k.getByTestId("handover-open").count()) === 1);

// FIRINGI support sees it
const sup = await login("support@firingi.test");
await go(sup, `/admin/customers/support/${ticketUrl.split("/").pop()}`);
check("FIRINGI support opens the request", /Quero falar com uma pessoa/.test(await sup.textContent("main")));

// ── 3. Phone width + dark mode ──
const kp = await login("owner@kebabhouse.test", { viewport: { width: 390, height: 844 }, colorScheme: "dark" });
await go(kp, chatUrl);
const overflow = await kp.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
check("phone width: no sideways scrolling", overflow <= 1, `${overflow}px`);
await kp.getByTestId("handover-card").scrollIntoViewIfNeeded().catch(() => {});
await shot(kp, "agent-05-phone-dark");
await clearCart(k);

// ── 4. Supplier: support only, hand-over works ──
const lx = await login("owner@lisboacentral.test");
await go(lx, "/vendor/assistant");
check("supplier: support description, no cart examples", /extratos de faturação/.test(await lx.textContent("main")) && !/carrinho/.test(await lx.getByTestId("examples").textContent()));
await lx.getByTestId("examples").locator("button", { hasText: "Quero falar com alguém da FIRINGI" }).click();
check("supplier answer", await waitAnswer(lx, 1));
check("supplier: hand-over offered, no cart card", (await lx.getByTestId("handover-card").count()) === 1 && (await lx.getByTestId("cart-card").count()) === 0);
await lx.getByTestId("handover-send").click();
check("supplier request sent", await until(async () => /Enviado ao suporte da FIRINGI/.test(await lx.getByTestId("handover-card").textContent())));
check("link goes to the supplier's Help & Support", /^\/vendor\/support\//.test((await lx.getByTestId("handover-open").getAttribute("href")) ?? ""));
await shot(lx, "agent-06-supplier");

// ── 5. FIRINGI switches it off for the supplier ──
const sa = await login("superadmin@firingi.test");
await go(sa, "/admin/settings/business-features");
const row = sa.getByTestId("business-features").locator("tr", { hasText: "Lisboa Central" }).first();
await row.getByTestId("assistant-switch").click();
check("switched off for the supplier", await until(async () => (await row.getByTestId("assistant-switch").getAttribute("aria-checked")) === "false"));
check("supplier: Assistant gone", await until(async () => (await lx.request.get(`${BASE}/vendor/assistant`)).status() === 404));
await row.getByTestId("assistant-switch").click();
await until(async () => (await row.getByTestId("assistant-switch").getAttribute("aria-checked")) === "true");

check("no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
await browser.close();
console.log(failures ? `\n${failures} check(s) failed` : "\nall agent checks passed");
process.exit(failures ? 1 : 0);
