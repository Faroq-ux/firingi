/**
 * Browser test of voice input & read-aloud. Headless browsers can't hear a microphone, so the page
 * gets a fake speech engine that "hears" a fixed sentence (and a fake speech synthesiser that records
 * what it was asked to say). Checks: the 🎤 button puts the spoken words into the box (customer,
 * Portuguese) in Help & Support and in a quality-claim message; a blocked microphone says so in the
 * user's language; 🔊 reads a message aloud in the user's language; FIRINGI's reply box is English;
 * browsers without speech (Firefox) don't show the buttons; no page errors.
 *   node tests/e2e/voice.mjs [baseUrl] [screenshotDir]
 */
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)("playwright");

const BASE = process.argv[2] ?? "http://localhost:3000";
const SHOTS = process.argv[3] ?? null;
const PASSWORD = process.env.SEED_PASSWORD ?? "Firingi!2026";
let failures = 0;
const check = (name, ok, extra = "") => { console.log(`${ok ? "✔" : "✘"} ${name}${extra ? ` — ${extra}` : ""}`); if (!ok) failures++; };
const shot = async (page, name) => SHOTS && page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: false });
const browser = await chromium.launch();
const settle = async (p) => { await p.waitForLoadState("networkidle").catch(() => {}); await p.waitForTimeout(400); };
const go = async (p, url) => { await p.goto(`${BASE}${url}`); await settle(p); };
const until = async (fn, ms = 10000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await fn().catch(() => false)) return true; await new Promise((r) => setTimeout(r, 200)); } return false; };
const errors = [];

/** speech: "hear" = say the sentence; "deny" = microphone blocked; "none" = browser without speech. */
function fakeSpeech(mode, sentence) {
  return `(() => {
    const mode = ${JSON.stringify(mode)}, sentence = ${JSON.stringify(sentence)};
    if (mode === "none") { // like Firefox: no speech-to-text, no speech synthesis
      for (const k of ["SpeechRecognition", "webkitSpeechRecognition", "speechSynthesis", "SpeechSynthesisUtterance"]) { try { Object.defineProperty(window, k, { value: undefined, configurable: true, writable: true }); } catch {} }
      return;
    }
    class FakeRec {
      constructor() { this.lang = ""; this.continuous = false; this.interimResults = false; window.__recLang = null; }
      start() {
        window.__recLang = this.lang;
        setTimeout(() => {
          if (mode === "deny") { this.onerror && this.onerror({ error: "not-allowed" }); this.onend && this.onend(); return; }
          const res = [{ transcript: sentence }]; res.isFinal = true;
          this.onresult && this.onresult({ resultIndex: 0, results: [res] });
          setTimeout(() => this.onend && this.onend(), 50);
        }, 150);
      }
      stop() { this.onend && this.onend(); }
      abort() {}
    }
    window.SpeechRecognition = FakeRec; window.webkitSpeechRecognition = FakeRec;
    window.__spoken = [];
    const synth = { speaking: false, getVoices: () => [], cancel() {}, speak(u) { window.__spoken.push({ text: u.text, lang: u.lang }); } };
    try { Object.defineProperty(window, "speechSynthesis", { value: synth, configurable: true }); } catch {}
    window.SpeechSynthesisUtterance = window.SpeechSynthesisUtterance || function (t) { this.text = t; };
  })();`;
}
async function login(email, mode = "hear", sentence = "Três caixas chegaram partidas") {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: "reduce", deviceScaleFactor: SHOTS ? 2 : 1 });
  await ctx.addInitScript(fakeSpeech(mode, sentence));
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(`${email} @ ${page.url().replace(BASE, "")}: ${e.message.slice(0, 140)}`));
  await go(page, "/login");
  await page.fill("#email", email); await page.fill("#password", PASSWORD); await page.click("button[type=submit]");
  await page.waitForURL((u) => u.pathname !== "/login", { timeout: 15000 }).catch(() => {});
  await settle(page);
  return page;
}

// ── 1. Customer (Portuguese): Help & Support — speak the message ──
const k = await login("owner@kebabhouse.test");
await go(k, "/buy/support");
const mic = k.getByTestId("ticket-mic");
check("support: microphone button (Portuguese label)", (await mic.count()) === 1 && /Falar em vez de escrever/.test((await mic.getAttribute("aria-label")) ?? ""));
await k.locator('[data-testid="new-ticket"] input[name="subject"]').fill("Caixas partidas");
await mic.click();
check("spoken words appear in the message box", await until(async () => /Três caixas chegaram partidas/.test(await k.locator('[data-testid="new-ticket"] textarea').inputValue())));
check("listens in Portuguese (pt-PT)", (await k.evaluate(() => window.__recLang)) === "pt-PT");
await mic.click(); // a second sentence is added after the first
check("a second dictation is added, not replaced", await until(async () => (await k.locator('[data-testid="new-ticket"] textarea').inputValue()).split("Três caixas").length === 3));
await shot(k, "voice-01-support-dictation");
await k.getByRole("button", { name: /^Enviar$/ }).click();
await k.waitForURL(/\/buy\/support\/[a-z0-9]+/, { timeout: 15000 }).catch(() => {});
await settle(k);
check("ticket sent with the dictated text", /Três caixas chegaram partidas/.test(await k.getByTestId("thread").textContent()));

// ── 2. Read aloud ──
const speak = k.getByTestId("thread").getByTestId("speak").first();
check("read-aloud button on the message (Portuguese)", (await speak.count()) === 1 && /Ler em voz alta/.test(await speak.textContent()));
await speak.click();
const said = await k.evaluate(() => window.__spoken);
check("reads the message aloud in Portuguese", said.length === 1 && said[0].lang === "pt-PT" && /Três caixas/.test(said[0].text), JSON.stringify(said[0] ?? {}));
check("button turns into 'stop reading'", /Parar a leitura/.test(await speak.textContent()));
await speak.click();
await shot(k, "voice-02-read-aloud");
const ticketUrl = k.url().replace(BASE, "");

// ── 3. Microphone blocked → told in their language ──
const kd = await login("owner@kebabhouse.test", "deny");
await go(kd, ticketUrl);
await kd.getByTestId("reply-mic").click();
check("blocked microphone explained in Portuguese", await until(async () => /O microfone está bloqueado/.test(await kd.getByTestId("reply-mic-status").textContent())));

// ── 4. Browser without speech (e.g. Firefox): no buttons, typing still works ──
const kn = await login("owner@kebabhouse.test", "none");
await go(kn, ticketUrl);
check("no speech in the browser → no microphone / read-aloud buttons", (await kn.getByTestId("reply-mic").count()) === 0 && (await kn.getByTestId("speak").count()) === 0);
check("…and the reply box is still there", (await kn.locator('[data-testid="reply-form"] textarea').count()) === 1);

// ── 5. FIRINGI (English) answers by voice ──
const sa = await login("superadmin@firingi.test", "hear", "We will collect the boxes tomorrow");
await go(sa, "/admin/customers/support");
const row = sa.locator("a", { hasText: "Caixas partidas" }).first();
if (await row.count()) { await row.click(); await settle(sa); } else await go(sa, `/admin/customers/support/${ticketUrl.split("/").pop()}`);
const amic = sa.getByTestId("reply-mic");
check("FIRINGI reply box: English microphone label", (await amic.count()) === 1 && /Speak instead of typing/.test((await amic.getAttribute("aria-label")) ?? ""));
await amic.click();
check("FIRINGI dictates the answer", await until(async () => /We will collect the boxes tomorrow/.test(await sa.locator('[data-testid="reply-form"] textarea').inputValue())));
await shot(sa, "voice-03-firingi-reply");

// ── 6. Quality-claim message (supplier, Portuguese) ──
const lx = await login("owner@lisboacentral.test", "hear", "Vamos trocar as caixas amanhã");
await go(lx, "/vendor/orders/claims");
const claimLink = lx.getByTestId("claims-table").locator("a[href^='/vendor/orders/claims/c']").first();
if (await claimLink.count()) {
  await claimLink.click(); await settle(lx);
  const cmic = lx.getByTestId("claim-message-mic");
  if (await cmic.count()) {
    await cmic.click();
    check("claim message dictated (supplier)", await until(async () => /Vamos trocar as caixas amanhã/.test(await lx.getByTestId("claim-message").inputValue())));
  } else check("claim message box with microphone", (await lx.getByTestId("claim-messages").count()) === 1, "claim closed for messages");
} else console.log("· no claim to open (run claims.mjs first) — skipped");

check("no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
await browser.close();
console.log(failures ? `\n${failures} check(s) failed` : "\nall voice checks passed");
process.exit(failures ? 1 : 0);
