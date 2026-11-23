import { notFound } from "next/navigation";
import { FileText, NotebookTabs } from "lucide-react";
import { pagePermission, pagePortal, can } from "@/server/rbac/guard";
import { haccpAccess, history, reportData } from "@/server/haccp/service";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";
import { haccpLabels } from "@/components/haccp/labels";
import { dayText, fill, temp, when } from "@/components/haccp/text";
import { DeleteEntry } from "@/components/haccp/client";

export const metadata = { title: "Logbook & Reports" };
export const dynamic = "force-dynamic";
const DAY = 86400_000;
const parse = (s: string | undefined, d: Date) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(`${s}T00:00:00Z`) : d);
const iso = (d: Date) => d.toISOString().slice(0, 10);

/** Phase 69: every record with its corrective action, completion and missed checks, and the report for an inspector. */
export default async function FoodSafetyLog({ searchParams }: { searchParams: Promise<{ from?: string; to?: string; kind?: string; issues?: string }> }) {
  const ctx = await pagePortal("buy");
  pagePermission(ctx, ["buyer.haccp.manage", "buyer.haccp.log"]);
  const a = await haccpAccess(ctx.company);
  if (!a.on) notFound();
  const sp = await searchParams;
  const to = parse(sp.to, new Date()), from = parse(sp.from, new Date(to.getTime() - 6 * DAY));
  const kind = ["TEMP", "TASK", "DELIVERY", "COOLING"].includes(sp.kind ?? "") ? sp.kind! : null;
  const [{ l, locale }, rows, r] = await Promise.all([haccpLabels(), history(ctx, { from, to, kind, issues: sp.issues === "1" }), a.s.parts.reports ? reportData(ctx, from, to) : null]);
  const manager = can(ctx, "buyer.haccp.manage");
  const todayKey = iso(new Date());
  const missed = r ? r.days.flatMap((d) => d.missed.map((m) => ({ day: d.day, ...m }))) : [];
  return (
    <>
      <PageHeader title={l.logTitle} description={l.logIntro} icon={NotebookTabs} />
      <div className="space-y-6">
        <Card>
          <CardContent className="pt-6">
            <form className="flex flex-wrap items-end gap-3" method="get" data-testid="hc-log-filter">
              <div className="space-y-1"><Label htmlFor="hc-f">{l.from}</Label><Input id="hc-f" type="date" name="from" defaultValue={iso(from)} className="w-40" /></div>
              <div className="space-y-1"><Label htmlFor="hc-t">{l.to}</Label><Input id="hc-t" type="date" name="to" defaultValue={iso(to)} className="w-40" /></div>
              <div className="space-y-1"><Label htmlFor="hc-k">{l.kindLabel}</Label><Select id="hc-k" name="kind" defaultValue={kind ?? ""} className="w-40"><option value="">{l.all}</option>{["TEMP", "TASK", "DELIVERY", "COOLING"].map((k) => <option key={k} value={k}>{l[`kind.${k}`]}</option>)}</Select></div>
              <label className="flex items-center gap-2 pb-2 text-sm"><input type="checkbox" name="issues" value="1" defaultChecked={sp.issues === "1"} /> {l.onlyIssues}</label>
              <button type="submit" className={buttonVariants({ size: "sm", variant: "outline" })}>{l.show}</button>
              {a.s.parts.reports && <a className={buttonVariants({ size: "sm" })} href={`/api/haccp/report?from=${iso(from)}&to=${iso(to)}`} target="_blank" rel="noreferrer" data-testid="hc-report"><FileText className="size-4" /> {l.report}</a>}
            </form>
            {a.s.parts.reports && <p className="mt-2 text-xs text-muted-foreground">{l.reportHint}</p>}
          </CardContent>
        </Card>

        {r && (
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
            <Card>
              <CardHeader><CardTitle>{l.completion}</CardTitle><CardDescription>{fill(l.doneOf, { done: r.done, due: r.due })}</CardDescription></CardHeader>
              <CardContent>
                <p className="text-3xl font-semibold tabular-nums" data-testid="hc-log-pct">{r.pct}%</p>
                <ul className="mt-3 space-y-1 text-xs">{r.days.filter((d) => d.due > 0 || d.done > 0).map((d) => <li key={d.day} className="flex justify-between gap-2"><span>{dayText(locale, d.day)}</span><span className={d.late ? "text-destructive" : "text-muted-foreground"}>{fill(l.doneOf, { done: d.done, due: d.due })}</span></li>)}</ul>
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle>{l.missed}</CardTitle></CardHeader>
              <CardContent>
                {!missed.length ? <p className="text-sm text-muted-foreground">{l.noMissed}</p> : <ul className="space-y-1 text-sm" data-testid="hc-missed">{missed.slice(0, 40).map((m, i) => <li key={i}>{dayText(locale, m.day)} · {m.what}{m.at ? ` · ${m.at}` : ""}</li>)}</ul>}
              </CardContent>
            </Card>
          </div>
        )}

        <Card>
          <CardContent className="pt-6">
            {!rows.length ? <p className="text-sm text-muted-foreground" data-testid="hc-log-empty">{l.noEntries}</p> : (
              <ul className="divide-y" data-testid="hc-log">
                {rows.map((e) => (
                  <li key={e.id} className="flex flex-wrap items-start gap-2 py-2 text-sm" data-testid="hc-log-row" data-kind={e.kind} data-ok={e.ok ? "1" : "0"}>
                    <span className="w-32 shrink-0 tabular-nums text-muted-foreground">{when(locale, e.at)}</span>
                    <span className="min-w-0 flex-1 basis-56 break-words">
                      <span className="font-medium">{e.what}</span> <span className="text-xs text-muted-foreground">· {l[`kind.${e.kind}`]}{e.slot ? ` · ${e.slot}` : ""}{e.limit ? ` · ${e.limit}` : ""}{e.byName ? ` · ${e.byName}` : ""}</span>
                      {e.kind === "TEMP" && <span className="block">{temp(locale, e.valueC)}</span>}
                      {e.kind === "COOLING" && <span className="block">{temp(locale, e.startC)} → {temp(locale, e.valueC)} · {e.minutes} min</span>}
                      {e.kind === "DELIVERY" && <span className="block">{e.product ?? ""}{e.valueC != null ? ` · ${temp(locale, e.valueC)}` : ""}</span>}
                      {e.kind === "TASK" && e.results && !e.ok && <span className="block text-xs">{Object.entries(e.results).filter(([, v]) => !v).map(([k]) => `✗ ${k}`).join(" · ")}</span>}
                      {e.corrective && <span className="block text-xs">→ {e.corrective}</span>}
                      {e.note && <span className="block text-xs text-muted-foreground">{e.note}</span>}
                    </span>
                    <Badge variant={e.ok ? "success" : "destructive"}>{e.ok ? l.ok : l.notOk}</Badge>
                    {(manager || (e.byUserId === ctx.user.id && iso(e.at) === todayKey)) && <DeleteEntry l={l} id={e.id} />}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
