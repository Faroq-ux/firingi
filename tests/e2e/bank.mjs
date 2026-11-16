/**
 * Browser test of Phase 37 — bank reconciliation, against a server started with BANKFEED_SIMULATE=1:
 * FIRINGI finance (English) adds its bank account, imports a CAMT.053 statement: a customer transfer naming an
 * invoice is suggested at 99 % and confirmed; a supplier transfer becomes the supplier's payout; a rule books
 * the bank fee; an unknown line is matched by hand (part payment), undone and ignored. A CSV export asks for
 * its columns (guessed) and is imported. FIRINGI switches on auto-booking and the (simulated) bank feed, links
 * the account, a new transfer arrives and is booked by itself. The customer (Portuguese) imports its own
 * statement and matches its transfer to the FIRINGI invoice; the supplier matches FIRINGI's payout. Phone + dark.
 *   node tests/e2e/bank.mjs [baseUrl] [screenshotDir]
 */
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
const { chromium } = createRequire(import.meta.url)("playwright");

const BASE = process.argv[2] ?? "http://localhost:3000";
const SHOTS = process.argv[3] ?? null;
const PASSWORD = process.env.SEED_PASSWORD ?? "Firingi!2026";
const DB = process.env.E2E_DATABASE_URL ?? "postgresql://postgres:postgres@localhost:5432/firingi";
const CRON = process.env.CRON_SECRET ?? "test-cron-secret-0123456789abcdef";
let failures = 0;
const check = (name, ok, extra = "") => { console.log(`${ok ? "✔" : "✘"} ${name}${extra ? ` — ${extra}` : ""}`); if (!ok) failures++; };
const shot = async (page, name, full = false) => SHOTS && page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: full });
const browser = await chromium.launch();
const settle = async (p) => { await p.waitForLoadState("networkidle").catch(() => {}); await p.waitForTimeout(400); };
const go = async (p, url) => { await p.goto(`${BASE}${url}`); await settle(p); };
const until = async (fn, ms = 20000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await fn().catch(() => false)) return true; await new Promise((r) => setTimeout(r, 300)); } return false; };
const sql = (q) => execFileSync("psql", ["-At", DB, "-c", q], { encoding: "utf8" }).trim();
const errors = [];
async function login(email, { viewport = { width: 1280, height: 900 }, colorScheme = "light", locale = null } = {}) {
  const ctx = await browser.newContext({ viewport, colorScheme, reducedMotion: "reduce", deviceScaleFactor: SHOTS ? 2 : 1 });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(`${email} @ ${page.url().replace(BASE, "")}: ${e.message.slice(0, 140)}`));
  await go(page, "/login");
  await page.fill("#email", email); await page.fill("#password", PASSWORD); await page.click("button[type=submit]");
  await page.waitForURL((u) => u.pathname !== "/login", { timeout: 15000 }).catch(() => {});
  if (locale) await ctx.addCookies([{ name: "NEXT_LOCALE", value: locale, url: BASE }]);
  await settle(page);
  return page;
}
const stamp = Date.now().toString().slice(-7);
const today = new Date().toISOString().slice(0, 10);
const FIRINGI_IBAN = "PT50000201231234567890154", KEBAB_IBAN = "PT50003300004567890123456", LX_IBAN = "PT50003500001111222233334";

// ── test data: three open FIRINGI invoices for Kebab House, one approved supplier invoice for Lisboa Central ──
const kebab = sql(`select id from "Company" where "legalName" like 'Kebab House%' limit 1`);
const lisboa = sql(`select id from "Company" where "legalName" like '%Lisboa Central%' limit 1`);
const le = sql(`select id from "LegalEntity" limit 1`);
const inv = (n, gross) => {
  const num = `FT E2E${stamp}/${n}`;
  sql(`insert into "Invoice" (id, "legalEntityId", "docType", status, "recipientCompanyId", "issuerSnapshot", "recipientSnapshot", "fullNumber", "netTotal", "vatTotal", "grossTotal", "issuedAt", "dueAt", "updatedAt")
       values ('e2e-bank-${stamp}-${n}', '${le}', 'INVOICE', 'ISSUED', '${kebab}', '{}', '{}', '${num}', ${(gross / 1.23).toFixed(2)}, ${(gross - gross / 1.23).toFixed(2)}, ${gross.toFixed(2)}, now(), now() + interval '${n} days', now())`);
  return num;
};
const A = inv(1, 123.45), B = inv(2, 50), C = inv(3, 77.7);
const VI = `FT LC/E2E${stamp}`;
sql(`insert into "VendorInvoice" (id, "vendorCompanyId", "externalNumber", "issueDate", "netTotal", "vatTotal", "grossTotal", "fileKey", status, "updatedAt")
     values ('e2e-bank-vi-${stamp}', '${lisboa}', '${VI}', now(), 81.30, 18.70, 100.00, 'test/none.pdf', 'APPROVED', now())`);

const camt = (iban, entries) => Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.02"><BkToCstmrStmt><Stmt><Id>E2E-${stamp}-${Math.random().toString(36).slice(2, 6)}</Id>
<Acct><Id><IBAN>${iban}</IBAN></Id><Ccy>EUR</Ccy></Acct>
${entries.map((e) => `<Ntry><Amt Ccy="EUR">${Math.abs(e.amt).toFixed(2)}</Amt><CdtDbtInd>${e.amt < 0 ? "DBIT" : "CRDT"}</CdtDbtInd><Sts>BOOK</Sts><BookgDt><Dt>${today}</Dt></BookgDt><AcctSvcrRef>${e.ref}-${stamp}</AcctSvcrRef>
<NtryDtls><TxDtls><RltdPties>${e.amt < 0 ? `<Cdtr><Nm>${e.name ?? ""}</Nm></Cdtr>${e.iban ? `<CdtrAcct><Id><IBAN>${e.iban}</IBAN></Id></CdtrAcct>` : ""}` : `<Dbtr><Nm>${e.name ?? ""}</Nm></Dbtr>${e.iban ? `<DbtrAcct><Id><IBAN>${e.iban}</IBAN></Id></DbtrAcct>` : ""}`}</RltdPties><RmtInf><Ustrd>${e.remit}</Ustrd></RmtInf></TxDtls></NtryDtls></Ntry>`).join("\n")}
</Stmt></BkToCstmrStmt></Document>`);
const line = (p, text) => p.getByTestId("bank-line").filter({ hasText: text }).first();
async function addAccount(p, base, name, iban) {
  await go(p, `${base}/accounts`);
  const f = p.getByTestId("account-form-new");
  await f.getByTestId("acc-name").fill(name);
  await f.getByTestId("acc-iban").fill(iban);
  await f.getByTestId("acc-save").click();
  return until(async () => (await p.getByTestId("bank-account").filter({ hasText: iban }).count()) === 1);
}
async function importFile(p, name, buffer) {
  const acc = p.getByTestId("bank-account").first();
  await acc.locator('input[type="file"]').setInputFiles({ name, mimeType: "application/octet-stream", buffer });
  await until(async () => (await p.getByTestId("import-result").count()) > 0 || (await p.getByTestId("mapping-form").count()) > 0 || (await acc.locator('[role="alert"]').count()) > 0, 30000);
}

// ── 1. FIRINGI finance (English) ──
const fin = await login("finance@firingi.test", { locale: "en" });
await go(fin, "/admin/finance/bank");
check("Bank Reconciliation page: KPIs and 'add an account first'", (await fin.getByTestId("bank-kpis").count()) === 1 && (await fin.getByTestId("bank-empty").count()) === 1);
check("FIRINGI's bank account added", await addAccount(fin, "/admin/finance/bank", "Millennium main", FIRINGI_IBAN));

await importFile(fin, "extrato.xml", camt(FIRINGI_IBAN, [
  { amt: 123.45, ref: "K1", name: "KEBAB HOUSE LISBOA LDA", iban: KEBAB_IBAN, remit: `Pagamento ${A}` },
  { amt: -100, ref: "L1", name: "Lisboa Central", iban: LX_IBAN, remit: `Pag ${VI}` },
  { amt: -3.5, ref: "F1", name: "", remit: `COMISSAO MANUTENCAO ${stamp}` },
  { amt: 12.34, ref: "U1", name: "Desconhecido", remit: `TRF ${stamp}` },
]));
const res = await fin.getByTestId("import-result").textContent().catch(() => "");
check("CAMT.053 imported: 4 lines, 4 new", /4 lines read, 4 new/.test(res), res.slice(0, 120));

await go(fin, "/admin/finance/bank");
const k1 = line(fin, `Pagamento ${A}`);
check("customer transfer: suggestion 'Customer payment — Kebab House', 99 % sure, with the reasons", /Customer payment — Kebab House/.test(await k1.textContent()) && /99 % sure/.test(await k1.textContent()) && /named in the transfer/.test(await k1.getByTestId("line-reasons").textContent()));
await shot(fin, "bank-01-firingi-lines", true);
await k1.getByTestId("line-confirm").click();
check("confirmed → matched; the invoice is paid", await until(async () => (await fin.getByTestId("bank-line").filter({ hasText: `Pagamento ${A}` }).count()) === 0) && sql(`select coalesce(sum(a.amount),0) from "PaymentAllocation" a join "Payment" p on p.id=a."paymentId" where a."invoiceId"='e2e-bank-${stamp}-1' and p.status='CONFIRMED'`) === "123.45");

const l1 = line(fin, `Pag ${VI}`);
check("supplier transfer: suggestion 'Supplier payout — Grossista Lisboa Central'", /Supplier payout — Grossista Lisboa Central/.test(await l1.textContent()));
await l1.getByTestId("line-confirm").click();
check("supplier payout recorded, its invoice PAID", await until(async () => sql(`select status from "VendorInvoice" where id='e2e-bank-vi-${stamp}'`) === "PAID"));

// rule for the bank fee
await go(fin, "/admin/finance/bank/rules");
await fin.getByTestId("rule-contains").fill("COMISSAO MANUTENCAO");
await fin.getByTestId("rule-save").click();
await until(async () => /Saved/.test(await fin.getByTestId("rule-form").textContent()), 30000);
check("rule added and used on the waiting fee line", await until(async () => { await go(fin, "/admin/finance/bank/rules"); return /used 1 times/.test(await fin.getByTestId("rules").textContent()); }, 30000));

// hand match (part payment), undo, ignore
await go(fin, "/admin/finance/bank");
const u1 = line(fin, `TRF ${stamp}`);
check("unknown line waits without a suggestion", (await u1.getAttribute("data-status")) === "OPEN");
await u1.getByTestId("line-manual").click();
const mm = u1.getByTestId("manual-match");
await mm.getByTestId("manual-company").fill("Kebab");
await fin.getByRole("button", { name: /Kebab House Lisboa/ }).first().click();
await until(async () => (await mm.getByTestId("manual-options").count()) === 1);
await mm.getByTestId("manual-options").locator("li").filter({ hasText: B }).getByTestId("manual-pick").check();
await shot(fin, "bank-02-hand-match");
await mm.getByTestId("manual-confirm").click();
check("matched by hand: 12.34 € on invoice B (part payment)", await until(async () => sql(`select coalesce(sum(a.amount),0) from "PaymentAllocation" a where a."invoiceId"='e2e-bank-${stamp}-2'`) === "12.34"));
await go(fin, "/admin/finance/bank?status=MATCHED");
await line(fin, `TRF ${stamp}`).getByTestId("line-undo").click();
check("undo: the payment is gone, invoice B open again", await until(async () => sql(`select coalesce(sum(a.amount),0) from "PaymentAllocation" a where a."invoiceId"='e2e-bank-${stamp}-2'`) === "0"));
await go(fin, "/admin/finance/bank");
const u2 = line(fin, `TRF ${stamp}`);
await u2.getByTestId("line-ignore").click();
await u2.getByTestId("line-ignore-note").fill("Test transfer");
await u2.getByTestId("line-ignore-confirm").click();
check("ignored with a note", await until(async () => sql(`select status from "BankLine" where "bankRef"='U1-${stamp}'`) === "IGNORED"));

// CSV export: columns guessed, imported
await go(fin, "/admin/finance/bank/accounts");
const csv = `Conta;${FIRINGI_IBAN}\nData Mov.;Data Valor;Descrição;Débito;Crédito;Saldo\n${today.split("-").reverse().join("/")};${today.split("-").reverse().join("/")};TRF KEBAB HOUSE ${B};;50,00;1.000,00\n`;
await importFile(fin, "movimentos.csv", Buffer.from(csv, "latin1"));
const mf = fin.getByTestId("mapping-form");
check("CSV: asks for the columns, guessed (date, money out / in, description)", (await mf.count()) === 1 && (await mf.getByTestId("map-date").inputValue()) === "Data Mov." && (await mf.getByTestId("map-credit").inputValue()) === "Crédito" && (await mf.getByTestId("map-remittance").inputValue()) === "Descrição");
await shot(fin, "bank-03-csv-columns", true);
await mf.getByTestId("map-import").click();
check("CSV imported: 1 new line", await until(async () => /1 lines read, 1 new/.test(await fin.getByTestId("import-result").textContent())));
await go(fin, "/admin/finance/bank");
const c1 = line(fin, B);
check("CSV line: invoice B suggested", /Customer payment — Kebab House/.test(await c1.textContent()));
await c1.getByTestId("line-confirm").click();
check("invoice B paid from the CSV line", await until(async () => sql(`select coalesce(sum(a.amount),0) from "PaymentAllocation" a join "Payment" p on p.id=a."paymentId" where a."invoiceId"='e2e-bank-${stamp}-2'`) === "50.00"));

// settings: auto-booking + simulated bank feed
await go(fin, "/admin/finance/bank/settings");
await fin.getByTestId("bs-mode").selectOption("AUTO");
await fin.getByTestId("bs-feed").check();
await fin.locator("#bs-prov").selectOption("SIMULATED");
await fin.getByTestId("bs-save").click();
check("settings saved (auto-booking, bank feed on)", await until(async () => /Saved/.test(await fin.getByTestId("bank-settings").textContent())));
await go(fin, "/admin/finance/bank/accounts");
const acc = fin.getByTestId("bank-account").first();
await acc.locator('[data-testid^="feed-link-"]').click();
await fin.waitForURL(/feed=linked/, { timeout: 20000 }).catch(() => {});
await settle(fin);
check("bank feed linked (simulated consent)", (await fin.getByTestId("feed-result").count()) === 1 && /Linked/.test(await fin.getByTestId("bank-account").first().textContent()));
const q = await fin.request.post(`${BASE}/api/bank/sim`, { headers: { authorization: `Bearer ${CRON}`, "content-type": "application/json" }, data: { iban: FIRINGI_IBAN, lines: [{ bookingDate: today, amount: 77.7, counterparty: "KEBAB HOUSE LISBOA LDA", counterpartyIban: KEBAB_IBAN, remittance: `Fatura ${C}`, bankRef: `FEED-${stamp}` }], balance: 10000 } });
check("simulated bank: a transfer arrives", q.status() === 200);
await fin.getByTestId("bank-account").first().locator('[data-testid^="feed-sync-"]').click();
check("fetched → booked by itself (≥ 95 % sure)", await until(async () => sql(`select status || ':' || "autoMatched" from "BankLine" where "bankRef"='FEED-${stamp}'`) === "MATCHED:true"));
await go(fin, "/admin/finance/bank?status=MATCHED");
check("shown as 'booked by itself'", /booked by itself/.test(await line(fin, `Fatura ${C}`).textContent().catch(() => "")));
await shot(fin, "bank-04-firingi-matched", true);

// ── 2. Customer (Portuguese): its own books ──
const kb = await login("owner@kebabhouse.test", { locale: "pt-PT" });
await go(kb, "/buy/finance/bank");
check("customer Bank page in Portuguese", /Banco/.test(await kb.locator("h1").first().textContent()) && (await kb.getByTestId("bank-empty").count()) === 1);
check("customer account added", await addAccount(kb, "/buy/finance/bank", "Conta BPI", KEBAB_IBAN));
await importFile(kb, "extrato.xml", camt(KEBAB_IBAN, [{ amt: -123.45, ref: "KB1", name: "FIRINGI", iban: FIRINGI_IBAN, remit: `Pagamento ${A}` }]));
await go(kb, "/buy/finance/bank");
const kl = line(kb, `Pagamento ${A}`);
check("customer: 'Fatura FIRINGI' suggested (FIRINGI already recorded the payment → recorded payment)", /Pagamento registado|Fatura FIRINGI/.test(await kl.textContent()));
await shot(kb, "bank-05-customer");
await kl.getByTestId("line-confirm").click();
check("customer: matched in its own books", await until(async () => sql(`select status from "BankLine" where "bankRef"='KB1-${stamp}'`) === "MATCHED"));

// ── 3. Supplier (Portuguese): FIRINGI's payout arrives ──
const lx = await login("owner@lisboacentral.test", { locale: "pt-PT" });
check("supplier account added", await addAccount(lx, "/vendor/finance/bank", "Conta CGD", LX_IBAN));
await importFile(lx, "extrato.xml", camt(LX_IBAN, [{ amt: 100, ref: "LX1", name: "FIRINGI LDA", iban: FIRINGI_IBAN, remit: `Pag ${VI}` }]));
await go(lx, "/vendor/finance/bank");
const xl = line(lx, `Pag ${VI}`);
check("supplier: FIRINGI's payout suggested (Pagamento registado)", /Pagamento registado/.test(await xl.textContent()));
await xl.getByTestId("line-confirm").click();
check("supplier: matched", await until(async () => sql(`select status from "BankLine" where "bankRef"='LX1-${stamp}'`) === "MATCHED"));

// ── 4. Phone + dark ──
const fp = await login("owner@lisboacentral.test", { viewport: { width: 390, height: 844 }, colorScheme: "dark", locale: "pt-PT" });
for (const u of ["/vendor/finance/bank", "/vendor/finance/bank/accounts", "/vendor/finance/bank/rules"]) {
  await go(fp, u);
  const over = await fp.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check(`phone width: no sideways scrolling (${u})`, over <= 1, `${over}px`);
}
await go(fp, "/vendor/finance/bank?status=ALL");
await shot(fp, "bank-06-phone-dark", true);
const ap = await login("finance@firingi.test", { viewport: { width: 390, height: 844 }, colorScheme: "dark", locale: "en" });
for (const u of ["/admin/finance/bank?status=ALL", "/admin/finance/bank/accounts", "/admin/finance/bank/settings"]) {
  await go(ap, u);
  const over = await ap.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check(`phone width: no sideways scrolling (${u.split("?")[0]})`, over <= 1, `${over}px`);
}

// ── tidy: settings back to default (feed off, confirm mode) ──
sql(`delete from "Setting" where key='bank.settings'`);
check("no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
await browser.close();
console.log(failures ? `\n${failures} check(s) failed` : "\nall bank checks passed");
process.exit(failures ? 1 : 0);
