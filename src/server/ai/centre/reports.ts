import "server-only";
/**
 * AI Reports (Phase 66): Executive, Sales, Suppliers, Stock, Finance, Delivery risks, Fraud & risk alerts.
 * A report is a snapshot (KPIs against the period before, tables, highlights) plus a written summary — Claude's when the
 * AI is connected and FIRINGI allows it, otherwise FIRINGI's own wording from the same numbers. Kept in AiReportRun
 * (history, PDF, CSV). Weekly: the executive report is emailed to FIRINGI's admins on Monday morning (switchable).
 */
import type Anthropic from "@anthropic-ai/sdk";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/server/db";
import type { Ctx } from "@/server/context";
import { can } from "@/server/rbac/guard";
import { ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import type { PermissionCode } from "@/server/rbac/permissions";
import { REPORT_LABEL, REPORTS, type ReportKind } from "@/lib/ai-centre";
import { reasonText } from "@/lib/ai";
import { aiCentreSettings } from "./settings";

const DAY = 86400_000;
const r2 = (n: number) => Math.round(n * 100) / 100;
const nameOf = (c: { legalName: string; tradeName: string | null } | null | undefined) => c?.tradeName ?? c?.legalName ?? "—";
const eur = (n: number) => new Intl.NumberFormat("en", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(n);

export type ReportKpi = { label: string; value: number; prev?: number | null; fmt: "money" | "number" | "percent" };
export type ReportTable = { title: string; columns: string[]; rows: (string | number)[][] };
export type ReportData = { kind: ReportKind; title: string; from: string; to: string; kpis: ReportKpi[]; highlights: string[]; tables: ReportTable[] };

export const REPORT_DATA: Record<ReportKind, PermissionCode[]> = {
  EXECUTIVE: ["admin.dashboard.view", "admin.analytics.view", "admin.finance.view"],
  SALES: ["admin.orders.view", "admin.analytics.view"],
  SUPPLIER: ["admin.vendors.view", "admin.vendors.approve"],
  STOCK: ["admin.orders.view", "admin.analytics.view", "admin.catalogue.view"],
  FINANCE: ["admin.finance.view", "admin.finance.manage"],
  DELIVERY_RISK: ["admin.delivery.view", "admin.orders.view"],
  FRAUD: ["admin.risk.view", "admin.risk.manage"],
};
export const canReport = (ctx: Ctx, k: ReportKind) => ctx.company.type === "ADMIN" && can(ctx, "admin.ai.view") && can(ctx, REPORT_DATA[k]);
const pctOf = (a: number, b: number) => (b ? Math.round(((a - b) / b) * 100) : null);
const delta = (k: ReportKpi) => { const p = k.prev == null ? null : pctOf(k.value, k.prev); return p === null ? "" : ` (${p >= 0 ? "+" : ""}${p}% vs the period before)`; };
const fmtKpi = (k: ReportKpi) => (k.fmt === "money" ? eur(k.value) : k.fmt === "percent" ? `${k.value}%` : k.value.toLocaleString("en"));

// ── shared numbers ──────────────────────────────────────────────────────────

async function salesBetween(from: Date, to: Date) {
  const [o] = await prisma.$queryRaw<{ sales: number; orders: number; buyers: number; margin: number }[]>`
    SELECT COALESCE(SUM(l."lineNet"), 0)::float8 AS sales, COUNT(DISTINCT o.id)::int AS orders, COUNT(DISTINCT o."buyerCompanyId")::int AS buyers,
      COALESCE(SUM(l."lineNet" - l."vendorLineNet"), 0)::float8 AS margin
    FROM "OrderLine" l JOIN "Order" o ON o.id = l."orderId" WHERE o.status <> 'CANCELLED' AND o."placedAt" >= ${from} AND o."placedAt" < ${to}`;
  return o ?? { sales: 0, orders: 0, buyers: 0, margin: 0 };
}
async function topSellers(from: Date, to: Date, n = 10) {
  const rows = await prisma.$queryRaw<{ id: string; sales: number; orders: number }[]>`
    SELECT o."sellerCompanyId" AS id, SUM(l."lineNet")::float8 AS sales, COUNT(DISTINCT o.id)::int AS orders FROM "OrderLine" l JOIN "Order" o ON o.id = l."orderId"
    WHERE o.status <> 'CANCELLED' AND o."placedAt" >= ${from} AND o."placedAt" < ${to} GROUP BY 1 ORDER BY 2 DESC LIMIT ${n}`;
  const cos = await prisma.company.findMany({ where: { id: { in: rows.map((r) => r.id) } }, select: { id: true, legalName: true, tradeName: true } });
  return rows.map((r) => ({ name: nameOf(cos.find((c) => c.id === r.id)), sales: r2(r.sales), orders: r.orders }));
}
async function topProducts(from: Date, to: Date, n = 10) {
  return prisma.$queryRaw<{ name: string; units: number; sales: number }[]>`
    SELECT COALESCE(l."productName"->>'en', l."productName"->>'pt', l."productName"::text) AS name, SUM(l."qtyOrdered")::int AS units, SUM(l."lineNet")::float8 AS sales FROM "OrderLine" l JOIN "Order" o ON o.id = l."orderId"
    WHERE o.status <> 'CANCELLED' AND o."placedAt" >= ${from} AND o."placedAt" < ${to} GROUP BY 1 ORDER BY 3 DESC LIMIT ${n}`;
}
async function byCountry(from: Date, to: Date) {
  const rows = await prisma.$queryRaw<{ id: string; sales: number; orders: number }[]>`
    SELECT o."countryId" AS id, SUM(o."netTotal")::float8 AS sales, COUNT(*)::int AS orders FROM "Order" o
    WHERE o.status <> 'CANCELLED' AND o."placedAt" >= ${from} AND o."placedAt" < ${to} GROUP BY 1 ORDER BY 2 DESC`;
  const cs = await prisma.country.findMany({ where: { id: { in: rows.map((r) => r.id) } }, select: { id: true, code: true } });
  return rows.map((r) => ({ country: cs.find((c) => c.id === r.id)?.code ?? "—", sales: r2(r.sales), orders: r.orders }));
}
async function openRecs(kinds?: string[], n = 10) {
  return prisma.aiRecommendation.findMany({ where: { audience: "STAFF", status: "OPEN", ...(kinds ? { kind: { in: kinds } } : {}) }, orderBy: [{ score: "desc" }], take: n, select: { kind: true, title: true, score: true } });
}

// ── building each report ────────────────────────────────────────────────────

export async function buildReport(ctx: Ctx, kind: ReportKind, days = 7, now = new Date()): Promise<ReportData> {
  if (!canReport(ctx, kind)) throw new ForbiddenError();
  const to = now, from = new Date(now.getTime() - days * DAY), pFrom = new Date(from.getTime() - days * DAY);
  const base = { kind, title: `${REPORT_LABEL[kind]} report`, from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
  const recTable = (title: string, rows: { kind: string; title: string; score: number }[]): ReportTable => ({ title, columns: ["Suggestion", "Importance"], rows: rows.map((r) => [r.title, r.score]) });

  if (kind === "EXECUTIVE" || kind === "SALES") {
    const [cur, prev, sellers, products, countries] = await Promise.all([salesBetween(from, to), salesBetween(pFrom, from), topSellers(from, to), topProducts(from, to), byCountry(from, to)]);
    const kpis: ReportKpi[] = [
      { label: "Net sales", value: r2(cur.sales), prev: r2(prev.sales), fmt: "money" },
      { label: "Orders", value: cur.orders, prev: prev.orders, fmt: "number" },
      { label: "Buying customers", value: cur.buyers, prev: prev.buyers, fmt: "number" },
      { label: "Average order", value: cur.orders ? r2(cur.sales / cur.orders) : 0, prev: prev.orders ? r2(prev.sales / prev.orders) : null, fmt: "money" },
      { label: "FIRINGI margin", value: r2(cur.margin), prev: r2(prev.margin), fmt: "money" },
    ];
    const tables: ReportTable[] = [
      { title: "Top suppliers by sales", columns: ["Supplier", "Net sales (€)", "Orders"], rows: sellers.map((s) => [s.name, s.sales, s.orders]) },
      { title: "Top products", columns: ["Product", "Units", "Net sales (€)"], rows: products.map((p) => [String(p.name), p.units, r2(p.sales)]) },
      { title: "By country", columns: ["Country", "Net sales (€)", "Orders"], rows: countries.map((c) => [c.country, c.sales, c.orders]) },
    ];
    const highlights = [`Net sales ${eur(cur.sales)}${delta(kpis[0])}, ${cur.orders} orders from ${cur.buyers} customers.`];
    if (sellers[0]) highlights.push(`Biggest supplier: ${sellers[0].name} (${eur(sellers[0].sales)}).`);
    if (kind === "SALES") {
      const drops = await openRecs(["SALES_DROP"], 5), surges = await openRecs(["DEMAND_SURGE"], 5);
      if (drops.length) { tables.push(recTable("Sales dropping", drops)); highlights.push(`${drops.length} supplier${drops.length === 1 ? "" : "s"} with sales down by a third or more.`); }
      if (surges.length) tables.push(recTable("Demand rising", surges));
      return { ...base, kpis, highlights, tables };
    }
    // executive: the rest of the business at a glance
    const [recs, recCount, highRisk, held, overdue] = await Promise.all([
      openRecs(undefined, 8), prisma.aiRecommendation.count({ where: { audience: "STAFF", status: "OPEN" } }),
      prisma.aiRecommendation.count({ where: { audience: "STAFF", status: "OPEN", kind: "DELIVERY_RISK" } }),
      prisma.riskAssessment.count({ where: { held: true, review: "OPEN" } }).catch(() => 0),
      (await import("./recs")).overdueByCustomer(now, 0),
    ]);
    const routes = await prisma.aiRecommendation.findMany({ where: { audience: "STAFF", status: "OPEN", kind: { in: ["ROUTE_SAVING", "ROUTE_MERGE"] } }, select: { detail: true } });
    const saved = routes.reduce((a, r) => { const d = r.detail as { savedKm?: number; savedCost?: number; savedCo2Kg?: number }; return { km: a.km + (d.savedKm ?? 0), cost: a.cost + (d.savedCost ?? 0), co2: a.co2 + (d.savedCo2Kg ?? 0) }; }, { km: 0, cost: 0, co2: 0 });
    const overdueTotal = r2(overdue.reduce((a, o) => a + o.open, 0));
    kpis.push({ label: "Open AI suggestions", value: recCount, fmt: "number" }, { label: "Orders at delivery risk", value: highRisk, fmt: "number" }, { label: "Orders held for fraud review", value: held, fmt: "number" }, { label: "Overdue from customers", value: overdueTotal, fmt: "money" });
    tables.unshift(recTable("Most important suggestions", recs));
    if (saved.km > 0) highlights.push(`Route changes waiting could save ${Math.round(saved.km)} km, about ${eur(saved.cost)} in fuel / energy and ${Math.round(saved.co2)} kg CO₂.`);
    if (overdueTotal > 0) highlights.push(`${eur(overdueTotal)} is overdue from ${overdue.length} customer${overdue.length === 1 ? "" : "s"}.`);
    if (highRisk) highlights.push(`${highRisk} order${highRisk === 1 ? "" : "s"} may be delivered late.`);
    if (held) highlights.push(`${held} order${held === 1 ? " is" : "s are"} held for a fraud check.`);
    return { ...base, kpis, highlights, tables };
  }

  if (kind === "SUPPLIER") {
    const { supplierScorecards } = await import("@/server/services/performance");
    const cards = await supplierScorecards(ctx, "ALL", { from, to: now }).catch(() => []);
    const recs = await openRecs(["CHEAPER_SUPPLIER", "SALES_DROP", "COMMISSION_REVIEW"], 12);
    const scored = cards.filter((c) => c.score !== null);
    const weak = scored.filter((c) => (c.score ?? 100) < 60);
    return {
      ...base,
      kpis: [{ label: "Suppliers with orders", value: cards.filter((c) => c.orders > 0).length, fmt: "number" }, { label: "Average score", value: scored.length ? Math.round(scored.reduce((a, c) => a + (c.score ?? 0), 0) / scored.length) : 0, fmt: "number" }, { label: "Below 60", value: weak.length, fmt: "number" }, { label: "Supplier suggestions", value: recs.length, fmt: "number" }],
      highlights: [...(scored[0] ? [`Best supplier: ${scored[0].name} (score ${scored[0].score}).`] : []), ...(weak.length ? [`${weak.length} supplier${weak.length === 1 ? "" : "s"} below 60: ${weak.slice(0, 3).map((w) => w.name).join(", ")}.`] : [])],
      tables: [
        { title: "Supplier scorecards", columns: ["Supplier", "Score", "Orders", "Fill rate %", "On time %", "Declined %"], rows: cards.slice(0, 30).map((c) => [c.name, c.score ?? "—", c.orders, c.fillRate === null ? "—" : Math.round(c.fillRate * 100), c.onTime === null ? "—" : Math.round(c.onTime * 100), c.declineRate === null ? "—" : Math.round(c.declineRate * 100)]) },
        recTable("Supplier suggestions", recs),
      ],
    };
  }

  if (kind === "STOCK") {
    const { stockPredictions } = await import("../insights");
    const rows = (await stockPredictions(ctx, "STAFF", { now, locale: "en" })).filter((r) => r.dailyUnits > 0);
    const out = rows.filter((r) => r.status === "OUT"), crit = rows.filter((r) => r.status === "CRITICAL"), low = rows.filter((r) => r.status === "LOW");
    const risky = [...out, ...crit, ...low];
    return {
      ...base,
      kpis: [{ label: "Products selling", value: rows.length, fmt: "number" }, { label: "Out of stock", value: out.length, fmt: "number" }, { label: "Critical (days)", value: crit.length, fmt: "number" }, { label: "Low cover", value: low.length, fmt: "number" }],
      highlights: [`${out.length} selling product${out.length === 1 ? " is" : "s are"} out of stock and ${crit.length} will run out within days.`],
      tables: [{ title: "Products at risk", columns: ["Product", "Supplier", "Available", "Sells / day", "Days left", "Status"], rows: risky.slice(0, 40).map((r) => [`${r.product} (${r.pack})`, r.vendor, r.available, r.dailyUnits, r.days ?? 0, r.status]) }],
    };
  }

  if (kind === "FINANCE") {
    const { computePnl, cashFlow } = await import("@/server/services/profit");
    const [pnl, cash, overdue, comm] = await Promise.all([computePnl({ months: 3 }), cashFlow(ctx, { months: 3, weeksAhead: 8 }), (await import("./recs")).overdueByCustomer(now, 0), openRecs(["COMMISSION_REVIEW", "MARGIN_GAP"], 10)]);
    const last = pnl.rows[pnl.rows.length - 1], before = pnl.rows[pnl.rows.length - 2];
    const lowest = Math.min(0, ...cash.forecast.map((f) => f.cumulative));
    return {
      ...base, from: pnl.rows[0]?.month ?? base.from,
      kpis: [
        { label: "Revenue (this month)", value: last?.revenue ?? 0, prev: before?.revenue ?? null, fmt: "money" }, { label: "Gross profit (this month)", value: last?.gross ?? 0, prev: before?.gross ?? null, fmt: "money" },
        { label: "Net profit (3 months)", value: pnl.total.net, fmt: "money" }, { label: "Overdue receivable", value: cash.overdueReceivable, fmt: "money" }, { label: "Lowest cash point, next 8 weeks", value: r2(lowest), fmt: "money" },
      ],
      highlights: [`Net profit over 3 months ${eur(pnl.total.net)}; gross margin ${pnl.total.marginPct === null ? "—" : `${Math.round(pnl.total.marginPct * 100)}%`}.`, ...(cash.overdueReceivable > 0 ? [`${eur(cash.overdueReceivable)} overdue from ${overdue.length} customers.`] : []), ...(lowest < 0 ? [`Cash may dip to ${eur(lowest)} in the next 8 weeks.`] : [])],
      tables: [
        { title: "Profit & loss by month", columns: ["Month", "Revenue", "Gross", "Costs", "Net"], rows: pnl.rows.map((m) => [m.month, m.revenue, m.gross, m.costTotal, m.net]) },
        { title: "Cash ahead by week", columns: ["Week", "In", "Out (suppliers)", "Costs", "Running"], rows: cash.forecast.map((f) => [f.week, f.receivable, f.payable, f.costs, f.cumulative]) },
        { title: "Overdue customers", columns: ["Customer", "Open (€)", "Invoices", "Days late"], rows: overdue.sort((a, b) => b.open - a.open).slice(0, 20).map((o) => [o.buyer, o.open, o.invoices, o.daysLate]) },
        recTable("Margin & commission to review", comm),
      ],
    };
  }

  if (kind === "DELIVERY_RISK") {
    const { deliveryRisk } = await import("../insights");
    const risks = await deliveryRisk(ctx, "STAFF", { now, limit: 100 });
    const routes = await openRecs(["ROUTE_SAVING", "ROUTE_MERGE"], 10);
    const high = risks.filter((r) => r.level === "HIGH"), med = risks.filter((r) => r.level === "MEDIUM");
    return {
      ...base,
      kpis: [{ label: "Open orders checked", value: risks.length, fmt: "number" }, { label: "High risk", value: high.length, fmt: "number" }, { label: "Medium risk", value: med.length, fmt: "number" }, { label: "Route savings to act on", value: routes.length, fmt: "number" }],
      highlights: [`${high.length} order${high.length === 1 ? "" : "s"} at high risk of being late${high[0] ? `, e.g. ${high[0].number} (${high[0].reasons.map(reasonText).join("; ")})` : ""}.`],
      tables: [{ title: "Orders at risk", columns: ["Order", "Supplier → customer", "Level", "Why"], rows: [...high, ...med].slice(0, 40).map((r) => [r.number, `${r.seller} → ${r.buyer}`, r.level, r.reasons.map(reasonText).join("; ")]) }, recTable("Route savings", routes)],
    };
  }

  // FRAUD
  const { riskOverview, listAssessments } = await import("@/server/risk/service");
  const [ov, open] = await Promise.all([riskOverview(ctx, days), listAssessments(ctx, { review: "OPEN" })]);
  return {
    ...base,
    kpis: [{ label: "Orders checked", value: ov.checks, fmt: "number" }, { label: "Held", value: ov.held, fmt: "number" }, { label: "Flagged", value: ov.flagged, fmt: "number" }, { label: "Confirmed fraud", value: ov.fraud, fmt: "number" }, { label: "Value held", value: r2(ov.heldValue), fmt: "money" }],
    highlights: [`${ov.open} check${ov.open === 1 ? "" : "s"} waiting for a decision; ${ov.held} order${ov.held === 1 ? "" : "s"} held worth ${eur(ov.heldValue)}.`, ...ov.byRule.filter((r) => r.count).sort((a, b) => b.count - a.count).slice(0, 2).map((r) => `Most common reason: ${r.label} (${r.count}).`)],
    tables: [
      { title: "Waiting for a decision", columns: ["Order", "Customer", "Level", "Score", "Held"], rows: open.slice(0, 40).map((a) => [a.order.number, a.order.buyer.legalName, a.level, a.score, a.held ? "yes" : "no"]) },
      { title: "Riskiest customers", columns: ["Customer", "Checks", "Highest score", "Fraud"], rows: ov.riskiest.map((r) => [r.name, r.count, r.maxScore, r.fraud]) },
    ],
  };
}

// ── summary ─────────────────────────────────────────────────────────────────

/** FIRINGI's own wording from the numbers (no AI needed). */
export function ruleSummary(d: ReportData) {
  const kp = d.kpis.slice(0, 4).map((k) => `${k.label}: ${fmtKpi(k)}${delta(k)}`).join("; ");
  return [`${d.title} for ${d.from} to ${d.to}. ${kp}.`, ...d.highlights].join(" ");
}

async function claudeSummary(ctx: Ctx | null, d: ReportData): Promise<{ text: string; model: string } | null> {
  const { aiTransport, aiSettings } = await import("../assistant");
  const transport = aiTransport();
  if (!transport) return null;
  // Phase 67: AI Governance (master switch, budget) and the model chosen for report summaries
  const { claudeGate, modelFor } = await import("../ops/governance");
  if (!(await claudeGate("reports")).ok) return null;
  const s = { ...(await aiSettings()), model: await modelFor("reports") };
  const compact = { ...d, tables: d.tables.map((t) => ({ ...t, rows: t.rows.slice(0, 12) })) };
  const params: Anthropic.Beta.Messages.MessageCreateParamsNonStreaming = {
    model: s.model, max_tokens: 700,
    system: "You write the summary of a business report for the managers of FIRINGI, a B2B wholesale marketplace (suppliers, customers, deliveries; FIRINGI invoices every customer). Use only the numbers given. Write 4 to 7 short sentences in plain English: what changed, what needs attention first, and one or two concrete next steps. No headings, no lists, no markdown, no invented figures.",
    messages: [{ role: "user", content: JSON.stringify(compact).slice(0, 24_000) }],
  };
  const res = await transport(params);
  if (res.stop_reason === "refusal") return null;
  const text = res.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join(" ").trim().slice(0, 3000);
  if (!text) return null;
  const { logAi } = await import("../feed");
  await logAi({ kind: "REPORT", ctx, summary: `${d.title} summary written`, detail: { kind: d.kind }, model: s.model, tokensIn: res.usage?.input_tokens, tokensOut: res.usage?.output_tokens }).catch(() => null);
  return { text, model: s.model };
}

/** Build the report, write its summary and keep it. `claude`: ask Claude (when connected and allowed). */
export async function generateReport(ctx: Ctx, kind: ReportKind, opts: { days?: number; claude?: boolean; now?: Date } = {}) {
  if (!REPORTS.includes(kind)) throw new ValidationError("Unknown report.");
  const s = await aiCentreSettings();
  if (!s.reports[kind]) throw new ForbiddenError("This report is switched off.");
  const days = Math.min(90, Math.max(1, Math.round(opts.days ?? 7)));
  const d = await buildReport(ctx, kind, days, opts.now);
  const ai = opts.claude && s.claudeSummaries ? await claudeSummary(ctx.user.id === "system" ? null : ctx, d).catch((e) => { console.error("ai report", e); return null; }) : null;
  return prisma.aiReportRun.create({
    data: { kind, periodFrom: new Date(d.from), periodTo: new Date(d.to), data: d as unknown as Prisma.InputJsonValue, summary: ai?.text ?? ruleSummary(d), model: ai?.model ?? null, byClaude: !!ai, createdById: ctx.user.id === "system" ? null : ctx.user.id },
  });
}

export async function latestReport(ctx: Ctx, kind: ReportKind) {
  if (!canReport(ctx, kind)) throw new ForbiddenError();
  return prisma.aiReportRun.findFirst({ where: { kind }, orderBy: { createdAt: "desc" } });
}
export async function reportHistory(ctx: Ctx, kind: ReportKind) {
  if (!canReport(ctx, kind)) throw new ForbiddenError();
  return prisma.aiReportRun.findMany({ where: { kind }, orderBy: { createdAt: "desc" }, take: 12, select: { id: true, createdAt: true, periodFrom: true, periodTo: true, byClaude: true, emailedAt: true } });
}
export async function reportRun(ctx: Ctx, id: string) {
  const r = await prisma.aiReportRun.findUnique({ where: { id } });
  if (!r) throw new NotFoundError("Report");
  if (!canReport(ctx, r.kind as ReportKind)) throw new ForbiddenError();
  return r;
}

export function reportCsv(d: ReportData, summary: string) {
  const q = (v: unknown) => { const s = String(v ?? ""); return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const lines = [[d.title], [`Period`, `${d.from} to ${d.to}`], [], ["Summary"], [summary], [], ["KPI", "Value", "Period before"], ...d.kpis.map((k) => [k.label, k.value, k.prev ?? ""])];
  for (const t of d.tables) lines.push([], [t.title], t.columns, ...t.rows);
  return "﻿" + lines.map((l) => l.map(q).join(",")).join("\n");
}

// ── weekly email ────────────────────────────────────────────────────────────

/** Monday from 07:00 Lisbon: the executive report (Claude's summary when allowed) to FIRINGI's admins, once a week. */
export async function weeklyReportJob(now = new Date()) {
  const s = await aiCentreSettings();
  if (!s.weeklyEmail || !s.reports.EXECUTIVE) return { sent: false, reason: "off" };
  const lisbon = new Date(now.toLocaleString("en-US", { timeZone: "Europe/Lisbon" }));
  if (lisbon.getDay() !== 1 || lisbon.getHours() < 7) return { sent: false, reason: "not Monday morning" };
  const weekStart = new Date(now.getTime() - 6 * DAY);
  if (await prisma.aiReportRun.findFirst({ where: { kind: "EXECUTIVE", emailedAt: { gte: weekStart } } })) return { sent: false, reason: "already sent" };
  const sys = await (await import("../feed")).staffSystemCtx();
  sys.permissions = new Set([...sys.permissions, "admin.ai.view", "admin.finance.view", "admin.risk.view", "admin.dashboard.view", "admin.analytics.view"] as PermissionCode[]);
  const run = await generateReport(sys, "EXECUTIVE", { days: 7, claude: true, now });
  const { notify } = await import("@/server/notify/dispatch");
  const admin = await prisma.company.findFirst({ where: { type: "ADMIN" }, select: { id: true } });
  const n = admin ? await notify("ai.weekly_report", [{ companyId: admin.id, link: `/admin/ai/reports?tab=EXECUTIVE&run=${run.id}` }], { period: `${run.periodFrom.toISOString().slice(0, 10)} – ${run.periodTo.toISOString().slice(0, 10)}`, summary: run.summary.slice(0, 1200) }, { ref: { type: "AiReportRun", id: run.id } }).catch(() => ({ recipients: 0 })) : { recipients: 0 };
  await prisma.aiReportRun.update({ where: { id: run.id }, data: { emailedAt: now, recipients: n.recipients ?? 0 } });
  return { sent: true, recipients: n.recipients ?? 0 };
}
