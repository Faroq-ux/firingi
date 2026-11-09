/**
 * CSV / Excel export of any report the caller may see:
 *   /api/analytics/export?audience=ADMIN|VENDOR|BUYER&dims=a,b&metrics=x,y&format=csv|xlsx&period=…
 * The caller's scope (regions, own company) is always applied on top of the filters.
 */
import ExcelJS from "exceljs";
import { getLocale, getTranslations } from "next-intl/server";
import { getContext } from "@/server/context";
import { AppError } from "@/server/errors";
import { assertAllowed, report, type Audience, type Dim, type Metric } from "@/server/analytics/engine";
import { readQuery } from "@/server/analytics/params";
import { DIM_LABEL, METRIC_FMT, METRIC_LABEL, labelRows } from "@/server/analytics/labels";

export async function GET(req: Request) {
  const ctx = await getContext();
  if (!ctx) return new Response("Unauthorized", { status: 401 });
  const url = new URL(req.url);
  const sp = Object.fromEntries(url.searchParams);
  const audience = (["ADMIN", "VENDOR", "BUYER"].includes(sp.audience) ? sp.audience : "ADMIN") as Audience;
  const dims = (sp.dims ?? "").split(",").filter(Boolean) as Dim[];
  const metrics = (sp.metrics ?? "").split(",").filter(Boolean) as Metric[];
  const format = sp.format === "xlsx" ? "xlsx" : "csv";
  try {
    assertAllowed(audience, dims, metrics);
    const q = await readQuery(ctx, audience, sp);
    const rows = await report(q.filters, dims, metrics, { limit: 50_000 });
    const locale = await getLocale();
    const label = await labelRows(rows, dims, locale);
    let dimName = (d: Dim) => DIM_LABEL[d];
    let metricName = (m: Metric) => METRIC_LABEL[m];
    if (audience !== "ADMIN") {
      const t = await getTranslations("reports");
      dimName = (d) => t(`dims.${d}`);
      metricName = (m) => t(`metrics.${m}`);
    }
    const timeKey = (d: Dim, k: string | null) => (k && (d === "day" || d === "week" || d === "month") ? k.slice(0, d === "month" ? 7 : 10) : null);
    const head = [...dims.map(dimName), ...metrics.map(metricName)];
    const body = rows.map((r) => [
      ...dims.map((d) => timeKey(d, r.keys[d]) ?? label(d, r.keys[d])),
      ...metrics.map((m) => Math.round(r.values[m] * 100) / 100),
    ]);
    const from = q.filters.from.toISOString().slice(0, 10);
    const to = new Date(q.filters.to.getTime() - 86400_000).toISOString().slice(0, 10);
    const name = `firingi-${[...dims].join("-") || "total"}-${from}_${to}`;

    if (format === "csv") {
      const cell = (v: string | number) => (typeof v === "number" ? String(v) : /[",\n;]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
      const csv = "﻿" + [head, ...body].map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";
      return new Response(csv, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${name}.csv"`, "cache-control": "private, no-store" } });
    }
    const wb = new ExcelJS.Workbook();
    wb.creator = "FIRINGI";
    const ws = wb.addWorksheet("Report");
    ws.addRow(head).font = { bold: true };
    for (const r of body) ws.addRow(r);
    ws.views = [{ state: "frozen", ySplit: 1 }];
    head.forEach((h, i) => {
      const col = ws.getColumn(i + 1);
      col.width = Math.max(12, Math.min(40, h.length + 4, ...body.slice(0, 200).map((r) => String(r[i]).length + 2)));
      const m = metrics[i - dims.length];
      if (m) col.numFmt = METRIC_FMT[m] === "money" ? '#,##0.00 "€"' : "#,##0";
    });
    const buf = await wb.xlsx.writeBuffer();
    return new Response(buf as ArrayBuffer, { headers: { "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "content-disposition": `attachment; filename="${name}.xlsx"`, "cache-control": "private, no-store" } });
  } catch (e) {
    if (e instanceof AppError) return new Response(e.message, { status: e.status ?? 400 });
    throw e;
  }
}
