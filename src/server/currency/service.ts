import "server-only";
/**
 * Multi-currency (Phase 45). Rules in src/lib/currency.ts; docs in docs/multi-currency.md.
 *
 * Settings (Setting "currency.settings"), the daily rates (ECB feed or typed by FIRINGI, with manual overrides),
 * rate alerts (big move, feed failure, stale rate), and the viewer's currency: a customer in a country FIRINGI
 * switched on sees, orders and pays in its own currency (customer rate = reference × (1 + FX margin)); a supplier
 * there prices and is paid in its own currency (reference rate).
 */
import { Prisma } from "@prisma/client";
import { prisma, type Tx } from "@/server/db";
import type { Ctx } from "@/server/context";
import { can } from "@/server/rbac/guard";
import { ForbiddenError, ValidationError } from "@/server/errors";
import { writeAudit } from "@/server/services/audit";
import { notify } from "@/server/notify/dispatch";
import {
  currencyForCountry, customerRate, decimalsOf, EUR_FX, LOCAL_CURRENCIES, mergeCurrencySettings, movePct, parseEcb,
  type CurrencySettings, type Fx,
} from "@/lib/currency";

const KEY = "currency.settings";
const isStaff = (ctx: Ctx) => ctx.company.type === "ADMIN";
const day = (d = new Date()) => new Date(d.toISOString().slice(0, 10));
const iso = (d: Date) => d.toISOString().slice(0, 10);
async function firingiId() { return (await prisma.company.findFirstOrThrow({ where: { type: "ADMIN" }, select: { id: true } })).id; }

// ── settings ────────────────────────────────────────────────────────────────

/** Read fresh every time: server actions and pages may run in separate module instances (no shared cache). */
export async function currencySettings(db: Tx | typeof prisma = prisma): Promise<CurrencySettings> {
  const row = await db.setting.findFirst({ where: { scope: "GLOBAL", scopeId: "", key: KEY } });
  return mergeCurrencySettings(row?.value);
}

export async function saveCurrencySettings(ctx: Ctx, input: unknown) {
  if (!isStaff(ctx) || !can(ctx, "admin.settings.manage")) throw new ForbiddenError();
  const v = mergeCurrencySettings(input);
  const row = await prisma.setting.findFirst({ where: { scope: "GLOBAL", scopeId: "", key: KEY } });
  const before = mergeCurrencySettings(row?.value);
  if (row) await prisma.setting.update({ where: { id: row.id }, data: { value: v as unknown as Prisma.InputJsonValue, updatedById: ctx.user.id } });
  else await prisma.setting.create({ data: { scope: "GLOBAL", scopeId: "", key: KEY, value: v as unknown as Prisma.InputJsonValue, updatedById: ctx.user.id } });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "currency.settings", entityType: "Setting", entityId: KEY, before, after: v });
  clearFxCache();
  return v;
}

// ── rates ───────────────────────────────────────────────────────────────────

export type RateRow = { code: string; rate: string; date: string; source: string; feedRate: string | null };
/** Kept for callers / tests; rates and settings are not cached across requests. */
export function clearFxCache() { /* nothing cached */ }

/** The rate of each currency in force on a day (the newest on or before it). */
export async function ratesOn(at: Date = new Date()): Promise<Map<string, RateRow>> {
  const rows = await prisma.exchangeRate.findMany({ where: { baseCode: "EUR", date: { lte: day(at) } }, orderBy: { date: "desc" }, take: 2000 });
  const map = new Map<string, RateRow>();
  for (const r of rows) if (!map.has(r.quoteCode)) map.set(r.quoteCode, { code: r.quoteCode, rate: r.rate.toString(), date: iso(r.date), source: r.source, feedRate: r.feedRate?.toString() ?? null });
  return map;
}

/** Reference rate (units per €) — 1 for EUR; null when there is none yet. */
export async function midRate(code: string, at?: Date): Promise<Prisma.Decimal | null> {
  if (code === "EUR") return new Prisma.Decimal(1);
  const r = (await ratesOn(at)).get(code);
  return r ? new Prisma.Decimal(r.rate) : null;
}

/**
 * How a company sees money today: customers in their billing currency at the customer rate (with the FX
 * margin), suppliers in theirs at the reference rate. No rate yet → EUR.
 */
export type FxRole = "BUYER" | "SUPPLIER";
export async function fxFor(company: { countryCode: string; type: string }, role?: FxRole, at?: Date): Promise<Fx> {
  if (company.type === "ADMIN") return EUR_FX;
  const s = await currencySettings();
  const r0: FxRole = role ?? (company.type === "DISTRIBUTOR" ? "SUPPLIER" : "BUYER");
  const code = currencyForCountry(s, company.countryCode, r0);
  if (code === "EUR") return EUR_FX;
  const r = (await ratesOn(at)).get(code);
  if (!r) return EUR_FX;
  const margin = r0 === "BUYER" ? s.margins[code] ?? 0 : 0;
  return { code, rate: customerRate(r.rate, margin).toString(), mid: r.rate, marginPct: margin, decimals: decimalsOf(code), showEur: s.showEur, date: r.date };
}

/** The viewer's Fx: customer pages (BUYER, the default for customers and wholesalers buying) or supplier pages (SUPPLIER). FIRINGI staff → EUR. */
export async function viewerFx(ctx: Ctx, role?: FxRole): Promise<Fx> {
  return fxFor({ countryCode: ctx.company.countryCode, type: ctx.company.type }, role);
}

/** What a buyer is billed in, at the rate used for an order placed now. */
export async function buyerBilling(company: { countryCode: string }) {
  const s = await currencySettings();
  const code = currencyForCountry(s, company.countryCode, "BUYER");
  if (code === "EUR") return { code, mid: new Prisma.Decimal(1), rate: new Prisma.Decimal(1), marginPct: 0 };
  const mid = await midRate(code);
  if (!mid) return { code: "EUR", mid: new Prisma.Decimal(1), rate: new Prisma.Decimal(1), marginPct: 0 };
  const marginPct = s.margins[code] ?? 0;
  return { code, mid, rate: new Prisma.Decimal(customerRate(mid, marginPct).toString()), marginPct };
}

/** What a supplier is paid in, at today's reference rate. */
export async function supplierBilling(company: { countryCode: string }) {
  const s = await currencySettings();
  const code = s.payoutsLocal ? currencyForCountry(s, company.countryCode, "SUPPLIER") : "EUR";
  const mid = code === "EUR" ? null : await midRate(code);
  return mid ? { code, rate: mid } : { code: "EUR", rate: new Prisma.Decimal(1) };
}

/** FIRINGI reports: the currency switch (EUR or any rate we have), at today's reference rate. */
export async function reportFx(code: string | null | undefined): Promise<Fx> {
  const s = await currencySettings();
  if (!code || code === "EUR" || !s.reportSwitch) return EUR_FX;
  const r = (await ratesOn()).get(code);
  return r ? { code, rate: r.rate, mid: r.rate, marginPct: 0, decimals: decimalsOf(code), showEur: false, date: r.date } : EUR_FX;
}

export async function rateOverview() {
  const [today, s, history] = await Promise.all([
    ratesOn(), currencySettings(),
    prisma.exchangeRate.findMany({ where: { baseCode: "EUR", date: { gte: new Date(Date.now() - 45 * 86400_000) } }, orderBy: [{ date: "desc" }, { quoteCode: "asc" }] }),
  ]);
  const used = new Set(Object.entries(s.countries).filter(([, on]) => on).map(([c]) => currencyForCountry({ ...s, enabled: true }, c, "BUYER")));
  const byCode = new Map<string, { date: string; rate: number }[]>();
  for (const h of history) byCode.set(h.quoteCode, [...(byCode.get(h.quoteCode) ?? []), { date: iso(h.date), rate: Number(h.rate) }]);
  const ageDays = (d: string) => Math.floor((day().getTime() - new Date(d).getTime()) / 86400_000);
  return {
    settings: s,
    rows: LOCAL_CURRENCIES.map((code) => {
      const r = today.get(code) ?? null;
      const hist = (byCode.get(code) ?? []).slice().reverse();
      const prev = hist.length > 1 ? hist[hist.length - 2].rate : null;
      return {
        code, used: s.enabled && used.has(code), rate: r?.rate ?? null, date: r?.date ?? null, source: r?.source ?? null, feedRate: r?.feedRate ?? null,
        margin: s.margins[code] ?? 0, customerRate: r ? customerRate(r.rate, s.margins[code] ?? 0).toString() : null,
        change: r && prev ? movePct(prev, r.rate) : null, stale: r ? ageDays(r.date) > s.staleDays : true, ageDays: r ? ageDays(r.date) : null, history: hist,
      };
    }),
    history: history.map((h) => ({ id: h.id, code: h.quoteCode, rate: h.rate.toString(), date: iso(h.date), source: h.source, feedRate: h.feedRate?.toString() ?? null, note: h.note })),
  };
}

/** FIRINGI sets a rate by hand for a day (today by default) — the feed keeps its own value aside and never overwrites it. */
export async function overrideRate(ctx: Ctx, input: { code: string; rate: number; date?: string | null; note?: string | null }) {
  if (!isStaff(ctx) || !(can(ctx, "admin.settings.manage") || can(ctx, "admin.international.manage"))) throw new ForbiddenError();
  if (!LOCAL_CURRENCIES.includes(input.code)) throw new ValidationError("Unknown currency");
  if (!(input.rate > 0) || input.rate > 100000) throw new ValidationError("The rate must be a positive number");
  const date = input.date ? day(new Date(input.date)) : day();
  if (date.getTime() > day().getTime() + 86400_000) throw new ValidationError("A rate can't be set more than a day ahead");
  const where = { baseCode_quoteCode_date: { baseCode: "EUR", quoteCode: input.code, date } };
  const cur = await prisma.exchangeRate.findUnique({ where });
  const feedRate = cur ? (cur.source === "MANUAL" ? cur.feedRate : cur.rate) : null;
  const row = await prisma.exchangeRate.upsert({
    where, update: { rate: input.rate, source: "MANUAL", feedRate, note: input.note ?? null, createdById: ctx.user.id },
    create: { baseCode: "EUR", quoteCode: input.code, rate: input.rate, date, source: "MANUAL", feedRate, note: input.note ?? null, createdById: ctx.user.id },
  });
  await prisma.fxEvent.create({ data: { kind: "OVERRIDE", currencyCode: input.code, message: `${input.code} set to ${input.rate} for ${iso(date)} by hand`, data: { rate: input.rate, feedRate: feedRate?.toString() ?? null, note: input.note ?? null, by: ctx.user.id }, ackAt: new Date(), ackById: ctx.user.id } });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "currency.override", entityType: "ExchangeRate", entityId: row.id, before: cur ? { rate: cur.rate.toString(), source: cur.source } : null, after: { rate: input.rate, date: iso(date) } });
  clearFxCache();
  return { id: row.id };
}

/** Undo an override: back to the feed's rate for that day (or remove the row when there was none). */
export async function clearOverride(ctx: Ctx, id: string) {
  if (!isStaff(ctx) || !(can(ctx, "admin.settings.manage") || can(ctx, "admin.international.manage"))) throw new ForbiddenError();
  const r = await prisma.exchangeRate.findUnique({ where: { id } });
  if (!r || r.source !== "MANUAL") throw new ValidationError("Not a manual rate");
  if (r.feedRate) await prisma.exchangeRate.update({ where: { id }, data: { rate: r.feedRate, source: "ECB", feedRate: null, note: null } });
  else await prisma.exchangeRate.delete({ where: { id } });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "currency.override_cleared", entityType: "ExchangeRate", entityId: id, before: { rate: r.rate.toString() }, after: { rate: r.feedRate?.toString() ?? null } });
  clearFxCache();
  return true;
}

// ── the feed ────────────────────────────────────────────────────────────────

const ECB_URL = "https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml";

/** Simulated ECB file (FX_SIMULATE=1 / tests / no internet): yesterday's rates ± a small deterministic move. */
async function simulatedEcb(): Promise<string> {
  if (process.env.FX_SIMULATE_FAIL === "1") throw new Error("ECB feed unreachable (simulated)");
  const today = iso(new Date());
  const cur = await ratesOn();
  const seed = [...today].reduce((a, ch) => (a * 31 + ch.charCodeAt(0)) % 100003, 7);
  const cubes = LOCAL_CURRENCIES.map((c, i) => {
    const base = Number(cur.get(c)?.feedRate ?? cur.get(c)?.rate ?? 1);
    const jig = (((seed * (i + 3)) % 61) - 30) / 10000; // ±0.3 %
    return `<Cube currency='${c}' rate='${(base * (1 + jig)).toFixed(decimalsOf(c) === 0 ? 2 : 4)}'/>`;
  }).join("");
  return `<?xml version="1.0"?><gesmes:Envelope><Cube><Cube time='${today}'>${cubes}</Cube></Cube></gesmes:Envelope>`;
}

async function fetchEcb(): Promise<string> {
  if (process.env.FX_SIMULATE === "1" || process.env.NODE_ENV === "test") return simulatedEcb();
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 15_000);
  try {
    const res = await fetch(ECB_URL, { signal: ctl.signal, headers: { accept: "application/xml" } });
    if (!res.ok) throw new Error(`ECB answered ${res.status}`);
    return await res.text();
  } finally { clearTimeout(t); }
}

async function alert(kind: "MOVE" | "FEED_FAILED" | "STALE", code: string | null, message: string, data: Record<string, unknown>) {
  // one open alert of a kind per currency per day
  const since = day();
  const dup = await prisma.fxEvent.findFirst({ where: { kind, currencyCode: code, createdAt: { gte: since } } });
  if (dup) return null;
  const e = await prisma.fxEvent.create({ data: { kind, currencyCode: code, message, data: data as Prisma.InputJsonValue } });
  await notify("fx.alert", [{ companyId: await firingiId(), link: "/admin/international/currency/alerts" }], { message }, { ref: { type: "FxEvent", id: e.id } }).catch(() => null);
  return e;
}

/**
 * Daily job (and FIRINGI's "Fetch now"): read the ECB reference rates, store today's (a manual rate that day
 * is kept; the feed's value is put beside it), alert on big moves, feed failures and stale rates.
 */
export async function runFxJob(opts: { force?: boolean } = {}) {
  const s = await currencySettings();
  const out = { fetched: false, date: null as string | null, stored: 0, moves: 0, failed: null as string | null, stale: 0 };
  if (s.feed === "ECB" && (s.autoFetch || opts.force)) {
    try {
      const parsed = parseEcb(await fetchEcb());
      if (!parsed) throw new Error("The ECB file could not be read");
      out.fetched = true; out.date = parsed.date;
      const date = day(new Date(parsed.date));
      const before = await ratesOn(new Date(date.getTime() - 86400_000));
      for (const code of LOCAL_CURRENCIES) {
        const v = parsed.rates[code];
        if (!v) continue;
        const where = { baseCode_quoteCode_date: { baseCode: "EUR", quoteCode: code, date } };
        const cur = await prisma.exchangeRate.findUnique({ where });
        if (cur?.source === "MANUAL") await prisma.exchangeRate.update({ where: { id: cur.id }, data: { feedRate: v } });
        else await prisma.exchangeRate.upsert({ where, update: { rate: v, source: "ECB" }, create: { baseCode: "EUR", quoteCode: code, rate: v, date, source: "ECB" } });
        out.stored++;
        const prev = before.get(code);
        if (prev && prev.date !== parsed.date) {
          const mv = movePct(prev.rate, v);
          if (Math.abs(mv) >= s.alertMovePct) { out.moves++; await alert("MOVE", code, `${code} moved ${mv > 0 ? "+" : ""}${mv.toFixed(2)} % (${prev.rate} → ${v})`, { from: prev.rate, to: v, pct: mv, date: parsed.date }); }
        }
      }
      clearFxCache();
    } catch (e) {
      out.failed = e instanceof Error ? e.message : String(e);
      if (s.alertFeedFailure) await alert("FEED_FAILED", null, `The ECB rates could not be fetched: ${out.failed}. Conversions use the last rates.`, { error: out.failed });
    }
  }
  // stale: a currency in use with no new rate for too long
  if (s.enabled) {
    const now = await ratesOn();
    const used = new Set(Object.entries(s.countries).filter(([, on]) => on).map(([c]) => currencyForCountry({ ...s, enabled: true }, c, "BUYER")));
    for (const code of used) {
      const r = now.get(code);
      const age = r ? Math.floor((day().getTime() - new Date(r.date).getTime()) / 86400_000) : null;
      if (age === null || age > s.staleDays) { out.stale++; await alert("STALE", code, r ? `${code}: the newest rate is ${age} days old (${r.date})` : `${code}: no rate at all — customers there are billed in EUR`, { date: r?.date ?? null, age }); }
    }
  }
  return out;
}

// ── alerts ──────────────────────────────────────────────────────────────────

export async function fxEvents(opts: { open?: boolean } = {}) {
  return prisma.fxEvent.findMany({ where: opts.open ? { ackAt: null } : {}, orderBy: { createdAt: "desc" }, take: 200 });
}
export async function openFxAlerts() { return prisma.fxEvent.count({ where: { ackAt: null } }); }
export async function ackFxEvent(ctx: Ctx, id: string | "ALL") {
  if (!isStaff(ctx) || !(can(ctx, "admin.settings.manage") || can(ctx, "admin.international.manage") || can(ctx, "admin.finance.manage"))) throw new ForbiddenError();
  await prisma.fxEvent.updateMany({ where: id === "ALL" ? { ackAt: null } : { id, ackAt: null }, data: { ackAt: new Date(), ackById: ctx.user.id } });
  return true;
}

// ── FIRINGI pages ───────────────────────────────────────────────────────────

/** The non-euro Schengen countries with their names (settings page). */
export async function localCountries() {
  const { LOCAL_COUNTRIES, NON_EURO_COUNTRIES } = await import("@/lib/currency");
  const rows = await prisma.country.findMany({ where: { code: { in: [...LOCAL_COUNTRIES] } }, select: { code: true, name: true, flag: true } });
  return LOCAL_COUNTRIES.map((code) => {
    const r = rows.find((x) => x.code === code);
    const n = (r?.name ?? {}) as Record<string, string>;
    return { code, name: n.en ?? n.pt ?? code, flag: r?.flag ?? null, currency: NON_EURO_COUNTRIES[code] };
  });
}

/** Realised exchange gains / losses and FX margin (FIRINGI finance). */
export async function fxReport(ctx: Ctx, opts: { months?: number } = {}) {
  if (!isStaff(ctx) || !can(ctx, ["admin.finance.view", "admin.finance.manage"])) throw new ForbiddenError();
  const from = new Date(Date.now() - Math.min(24, Math.max(1, opts.months ?? 12)) * 31 * 86400_000);
  const [entries, byCcy, margin, openLocal] = await Promise.all([
    prisma.fxEntry.findMany({ where: { date: { gte: from } }, orderBy: { date: "desc" }, take: 300 }),
    prisma.fxEntry.groupBy({ by: ["currencyCode", "kind"], where: { date: { gte: from } }, _sum: { gainLossEur: true, amountLocal: true }, _count: true }),
    prisma.$queryRaw<{ code: string; n: number; local: number; eur: number; margin: number }[]>`
      SELECT i."currencyCode" AS code, count(*)::int AS n, sum(i."grossTotalLocal")::float8 AS local, sum(i."grossTotal")::float8 AS eur,
        sum(CASE WHEN i."docType" = 'CREDIT_NOTE' THEN -1 ELSE 1 END * (i."netTotalLocal" / NULLIF(i."midRate", 0) - i."netTotal"))::float8 AS margin
      FROM "Invoice" i WHERE i."currencyCode" <> 'EUR' AND i."grossTotalLocal" IS NOT NULL AND i.status <> 'DRAFT' AND i."issuedAt" >= ${from} GROUP BY 1 ORDER BY 1`,
    // what customers still owe in other currencies, at today's rate vs the invoices' rates (unrealised)
    prisma.$queryRaw<{ code: string; open_eur: number; open_local: number }[]>`
      SELECT i."currencyCode" AS code,
        sum(i."grossTotal" - coalesce((SELECT sum(a.amount) FROM "PaymentAllocation" a JOIN "Payment" p ON p.id = a."paymentId" WHERE a."invoiceId" = i.id AND p.status IN ('CONFIRMED','REFUNDED')), 0))::float8 AS open_eur,
        sum((i."grossTotal" - coalesce((SELECT sum(a.amount) FROM "PaymentAllocation" a JOIN "Payment" p ON p.id = a."paymentId" WHERE a."invoiceId" = i.id AND p.status IN ('CONFIRMED','REFUNDED')), 0)) * i."grossTotalLocal" / NULLIF(i."grossTotal", 0))::float8 AS open_local
      FROM "Invoice" i WHERE i."currencyCode" <> 'EUR' AND i."grossTotalLocal" IS NOT NULL AND i.status <> 'DRAFT' AND i."docType" IN ('INVOICE', 'INVOICE_RECEIPT') GROUP BY 1`,
  ]);
  const rates = await ratesOn();
  const companies = new Map((await prisma.company.findMany({ where: { id: { in: [...new Set(entries.map((e) => e.companyId))] } }, select: { id: true, legalName: true } })).map((c) => [c.id, c.legalName]));
  return {
    entries: entries.map((e) => ({ ...e, company: companies.get(e.companyId) ?? "" })),
    byCurrency: byCcy.map((r) => ({ code: r.currencyCode, kind: r.kind, n: r._count, local: Number(r._sum.amountLocal ?? 0), gainLoss: Number(r._sum.gainLossEur ?? 0) })),
    margin: margin.map((m) => ({ ...m, margin: Math.round(m.margin * 100) / 100 })),
    exposure: openLocal.filter((o) => o.open_eur > 0.004).map((o) => {
      const mid = Number(rates.get(o.code)?.rate ?? 0);
      const today = mid ? o.open_local / mid : o.open_eur;
      return { code: o.code, openEur: Math.round(o.open_eur * 100) / 100, openLocal: Math.round(o.open_local * 100) / 100, atToday: Math.round(today * 100) / 100, unrealised: Math.round((today - o.open_eur) * 100) / 100 };
    }),
    total: Math.round(byCcy.reduce((a, r) => a + Number(r._sum.gainLossEur ?? 0), 0) * 100) / 100,
  };
}
