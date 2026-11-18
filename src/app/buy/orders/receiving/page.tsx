import Link from "next/link";
import { ClipboardCheck, FileDown } from "lucide-react";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { coldChainSettings, listClasses, receivingLog } from "@/server/coldchain/service";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ReceivingForm } from "@/components/coldchain/client";
import { ccLabels } from "@/components/coldchain/labels";

export const metadata = { title: "Receiving Log" };
export const dynamic = "force-dynamic";
const TONE = { OK: "success", WARN: "warning", OUT: "destructive" } as const;

export default async function ReceivingLogPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const ctx = await pagePortal("buy");
  pagePermission(ctx, ["buyer.orders.view", "buyer.orders.place"]);
  const { l, locale } = await ccLabels();
  const m = (await searchParams).month;
  const month = m && /^\d{4}-\d{2}$/.test(m) ? m : new Date().toISOString().slice(0, 7);
  const [rows, classes, s] = await Promise.all([receivingLog(ctx, month, locale), listClasses(locale), coldChainSettings()]);
  const time = (d: Date) => new Intl.DateTimeFormat(locale, { dateStyle: "short", timeStyle: "short" }).format(new Date(d));
  const prev = (() => { const d = new Date(`${month}-01T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() - 1); return d.toISOString().slice(0, 7); })();
  return (
    <>
      <PageHeader title={l.receivingTitle} icon={ClipboardCheck} description={l.receivingIntro} />
      {s.records.receivingLog && (
        <Card className="mb-6">
          <CardHeader><CardTitle>{l.addOutside}</CardTitle></CardHeader>
          <CardContent><ReceivingForm l={l} classes={classes.filter((c) => c.coldChain).map((c) => ({ id: c.id, name: c.name }))} /></CardContent>
        </Card>
      )}
      <Card>
        <CardHeader className="flex-row flex-wrap items-center justify-between gap-2">
          <CardTitle>{l.logTitle} · {month}</CardTitle>
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <Link href={`?month=${prev}`} className="text-primary hover:underline">← {prev}</Link>
            {s.records.monthly && <a href={`/api/coldchain/report?month=${month}`} className="inline-flex items-center gap-1 text-primary hover:underline" data-testid="receiving-pdf"><FileDown className="size-4" /> {l.downloadPdf}</a>}
            {s.records.monthly && <a href={`/api/coldchain/report?month=${month}&format=csv`} className="inline-flex items-center gap-1 text-primary hover:underline"><FileDown className="size-4" /> {l.downloadCsv}</a>}
          </div>
        </CardHeader>
        <CardContent>
          {!rows.length ? <p className="py-4 text-center text-sm text-muted-foreground">{l.noLog}</p> : (
            <ul className="divide-y" data-testid="receiving-log">
              {rows.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center gap-2 py-2 text-sm" data-testid="receiving-row" data-status={r.status}>
                  <span className="w-28 shrink-0 text-xs text-muted-foreground">{time(r.at)}</span>
                  <span className="min-w-0 flex-1 basis-48 break-words"><b>{r.supplier}</b>{r.order ? ` · ${r.order}` : ""}{r.product ? ` · ${r.product}` : ""} <span className="text-xs text-muted-foreground">· {r.cls} {r.range} · {l[`stage.${r.stage}`]}</span></span>
                  <span className="font-medium tabular-nums">{r.valueC.toFixed(1).replace(".", ",")} °C</span>
                  <Badge variant={TONE[r.status]}>{l[`status.${r.status}`]}</Badge>
                  {r.accepted === false && <Badge variant="destructive">{l.refused}</Badge>}
                  {r.note && <span className="basis-full text-xs text-muted-foreground">{r.note}</span>}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </>
  );
}
