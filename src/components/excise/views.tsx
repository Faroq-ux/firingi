/** Licensed & excise goods (Phase 43) — server-rendered pieces: product badge, cart card, order card, report table. */
import Link from "next/link";
import { FileDown, Wine } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { Ctx } from "@/server/context";
import { formatMoney } from "@/lib/utils";
import { fill } from "./labels";

type L = Record<string, string>;
const money = (n: number, locale: string, dp = 2) => (dp === 2 ? formatMoney(n, locale) : `${n.toFixed(dp).replace(".", ",")} €`);

export type Badge43 = { kind: string; category: string; mode: "PAID" | "ADDED"; dutyUnit: number | null; licence: "OK" | "MISSING_BLOCK" | "MISSING_WARN" | "NOT_NEEDED"; restricted: boolean; maxPerOrder: number | null };

/** Product page / cards: the excise category, the duty FIRINGI adds, licence warning, restriction, cap. */
export function ExciseBadge({ b, l, locale, full = false }: { b: Badge43; l: L; locale: string; full?: boolean }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1" data-testid="excise-badge" data-mode={b.mode} data-licence={b.licence}>
      <Badge variant="outline" className="gap-1"><Wine className="size-3" /> {b.category}</Badge>
      {b.dutyUnit != null && b.dutyUnit > 0 && (b.mode === "ADDED" || full) && <Badge variant={b.mode === "ADDED" ? "warning" : "secondary"} data-testid="excise-duty">{fill(b.mode === "ADDED" ? l.dutyAdded : l.dutyIncluded, { amount: money(b.dutyUnit, locale) })}</Badge>}
      {b.licence === "MISSING_WARN" && <Badge variant="warning" data-testid="excise-licence-warn">{l.licenceWarn}</Badge>}
      {b.restricted && <Badge variant="destructive" data-testid="excise-restricted">{l.restricted}</Badge>}
      {full && b.maxPerOrder && <Badge variant="outline">{fill(l.maxPerOrder, { n: b.maxPerOrder })}</Badge>}
    </span>
  );
}

/** The cart: duty added by FIRINGI (+VAT), duty already in the prices, what stops the checkout. */
export function CartExcise({ l, locale, data }: { l: L; locale: string; data: { lines: { offerId: string; name: string; category: string; mode: string; qty: number; unit: number; total: number }[]; addedNet: number; addedVat: number; includedNet: number; issues: { offerId: string; code: string; category: string; max?: number; block: boolean }[]; show: boolean } }) {
  const added = data.lines.filter((x) => x.mode === "ADDED"), incl = data.lines.filter((x) => x.mode !== "ADDED");
  if (!data.issues.length && !added.length && !(data.show && incl.length)) return null;
  return (
    <div className="space-y-3 text-sm" data-testid="cart-excise">
      {data.issues.length > 0 && (
        <ul className="space-y-1" data-testid="cart-excise-issues">
          {data.issues.map((i) => <li key={`${i.offerId}-${i.code}`} className={i.block ? "text-destructive" : "text-[color:var(--warning,#b45309)]"} data-code={i.code}>{fill(l[`issue.${i.code}`], { category: i.category.toLowerCase(), max: i.max ?? "" })}</li>)}
          {data.issues.some((i) => i.code === "LICENCE") && <li><Link href="/buy/company/licences" className="text-primary hover:underline">{l.addLicence}</Link></li>}
        </ul>
      )}
      {added.length > 0 && (
        <div className="space-y-1" data-testid="cart-excise-added">
          <p className="font-medium">{l.cartAdded}: {money(data.addedNet, locale)} + {money(data.addedVat, locale)}</p>
          <ul className="space-y-0.5 text-xs text-muted-foreground">{added.map((x) => <li key={x.offerId}>{fill(l.cartLine, { name: x.name, category: x.category, qty: x.qty, unit: money(x.unit, locale, 4), total: money(x.total, locale) })}</li>)}</ul>
        </div>
      )}
      {data.show && incl.length > 0 && <p className="text-xs text-muted-foreground" data-testid="cart-excise-included">{l.cartIncluded}: {money(data.includedNet, locale)}</p>}
    </div>
  );
}

/** Order pages: excise per line, totals, the driver's licence check, the accompanying document (form for supplier / FIRINGI). */
export async function OrderExciseCard({ ctx, orderId, as, english }: { ctx: Ctx; orderId: string; as: "BUYER" | "SUPPLIER" | "ADMIN"; english?: boolean }) {
  const { orderExcise } = await import("@/server/excise/service");
  const { exLabels, enLabels } = await import("./labels");
  const { Card, CardContent, CardHeader, CardTitle } = await import("@/components/ui/card");
  const { ExciseDocForm } = await import("./client");
  const { l, locale } = english ? { l: enLabels(), locale: "en" } : await exLabels();
  const v = await orderExcise(ctx, orderId, as, locale).catch(() => null);
  if (!v) return null;
  const time = (d: Date) => new Intl.DateTimeFormat(locale, { dateStyle: "short", timeStyle: "short" }).format(new Date(d));
  return (
    <Card className="mt-6" id="excise" data-testid="order-excise">
      <CardHeader><CardTitle className="flex items-center gap-2"><Wine className="size-5" /> {l.orderTitle}</CardTitle></CardHeader>
      <CardContent className="space-y-3 text-sm">
        <ul className="divide-y">
          {v.lines.map((x) => (
            <li key={x.id} className="flex flex-wrap items-center gap-2 py-2" data-testid="order-excise-line" data-mode={x.mode}>
              <span className="min-w-0 flex-1 basis-56 break-words">{x.name} <span className="text-xs text-muted-foreground">· {x.category}{x.abv != null ? ` · ${String(x.abv).replace(".", ",")} % vol` : ""}{x.lpa ? ` · ${(x.lpa * x.qty).toFixed(3).replace(".", ",")} l a.p.` : ""}{x.units ? ` · ${x.units * x.qty}` : ""}</span></span>
              <Badge variant={x.mode === "ADDED" ? "warning" : "secondary"}>{l[`mode.${x.mode}`]}</Badge>
              {(v.show || x.mode === "ADDED") && x.unit != null && <span className="tabular-nums">{x.qty} × {money(x.unit, locale, 4)} = <b>{money(x.total, locale)}</b></span>}
            </li>
          ))}
        </ul>
        {v.addedNet > 0 && <p data-testid="order-excise-added">{l.cartAdded}: <b>{money(v.addedNet, locale)}</b> + {money(v.addedVat, locale)}</p>}
        {v.show && v.includedNet > 0 && <p className="text-muted-foreground">{l.cartIncluded}: {money(v.includedNet, locale)}</p>}
        {v.licensed && v.check.required && <p data-testid="order-excise-check" className={v.check.at ? "" : "text-muted-foreground"}>{v.check.at ? fill(l.checked, { by: v.check.by ?? "", date: time(v.check.at) }) : l.notChecked}</p>}
        {v.doc && (
          <div className="space-y-2 rounded-lg border p-3" data-testid="order-excise-doc">
            <p className="font-medium">{l.docTitle}</p>
            {v.doc.ref ? <p className="font-mono text-xs">{l[`doc.${v.doc.type}`] ?? v.doc.type} · {v.doc.ref}</p> : <p className="text-muted-foreground">{l.noDoc}</p>}
            {v.doc.canEdit && <ExciseDocForm l={l} orderId={orderId} type={v.doc.type} docRef={v.doc.ref} />}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

type Report = Awaited<ReturnType<typeof import("@/server/excise/service").exciseReport>>;

/** The monthly report table (supplier translated, FIRINGI English) with downloads. */
export function ExciseReportView({ r, l, locale, months, base }: { r: Report; l: L; locale: string; months: string[]; base: string }) {
  const n = (x: number, dp = 0) => (x ? x.toFixed(dp).replace(".", ",") : "—");
  return (
    <div className="space-y-4" data-testid="excise-report">
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <span className="text-muted-foreground">{l.month}:</span>
        {months.map((m) => <Link key={m} href={`${base}?month=${m}`} className={m === r.month ? "font-semibold underline" : "text-primary hover:underline"}>{m}</Link>)}
        <a className="inline-flex items-center gap-1 text-primary hover:underline" href={`/api/excise/report?month=${r.month}`} data-testid="excise-pdf"><FileDown className="size-4" /> {l.downloadPdf}</a>
        <a className="inline-flex items-center gap-1 text-primary hover:underline" href={`/api/excise/report?month=${r.month}&format=csv`} data-testid="excise-csv"><FileDown className="size-4" /> {l.downloadCsv}</a>
      </div>
      {!r.rows.length ? <p className="py-4 text-center text-sm text-muted-foreground">{l.noRows}</p> : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm" data-testid="excise-report-table">
            <thead><tr className="border-b text-left text-xs text-muted-foreground">
              <th className="py-2 pr-2">{l.colCategory}</th><th className="pr-2">{l.colCountry}</th><th className="pr-2">{l.dutyMode}</th><th className="pr-2 text-right">{l.colUnits}</th><th className="pr-2 text-right">{l.colLitres}</th>
              <th className="pr-2 text-right">{l.colLpa}</th><th className="pr-2 text-right">{l.colPieces}</th><th className="pr-2 text-right">{l.colKg}</th><th className="pr-2 text-right">{l.colDutyAdded}</th><th className="pr-2 text-right">{l.colDutyIncluded}</th><th className="text-right">{l.colOrders}</th>
            </tr></thead>
            <tbody>
              {r.rows.map((x) => (
                <tr key={`${x.code}-${x.country}-${x.mode}`} className="border-b" data-testid="excise-report-row" data-code={x.code}>
                  <td className="py-2 pr-2">{x.category}</td><td className="pr-2">{x.country}</td><td className="pr-2">{l[`mode.${x.mode}`]}</td><td className="pr-2 text-right tabular-nums">{x.units}</td>
                  <td className="pr-2 text-right tabular-nums">{n(x.litres, 2)}</td><td className="pr-2 text-right tabular-nums">{n(x.lpa, 3)}</td><td className="pr-2 text-right tabular-nums">{n(x.sticks)}</td><td className="pr-2 text-right tabular-nums">{n(x.kg, 3)}</td>
                  <td className="pr-2 text-right tabular-nums">{money(x.dutyAdded, locale)}</td><td className="pr-2 text-right tabular-nums">{money(x.dutyIncluded, locale)}</td><td className="text-right tabular-nums">{x.orders}</td>
                </tr>
              ))}
              <tr className="font-medium"><td className="py-2" colSpan={4}>{l.total}</td><td className="pr-2 text-right tabular-nums">{n(r.totals.litres, 2)}</td><td className="pr-2 text-right tabular-nums">{n(r.totals.lpa, 3)}</td><td className="pr-2 text-right tabular-nums">{n(r.totals.sticks)}</td><td /><td className="pr-2 text-right tabular-nums">{money(r.totals.dutyAdded, locale)}</td><td className="pr-2 text-right tabular-nums">{money(r.totals.dutyIncluded, locale)}</td><td /></tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
