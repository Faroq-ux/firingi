/** Cold chain (Phase 42): the fleet / warehouse page — incidents, equipment (checks, cleaning, calibration), loggers, monthly report. Supplier (translated) and FIRINGI (English). */
import Link from "next/link";
import { FileDown, Snowflake, Thermometer } from "lucide-react";
import type { Ctx } from "@/server/context";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EquipmentForm, EquipmentLogForm, LoggerForm, LoggerToggle } from "./client";
import { fill } from "./labels";

type L = Record<string, string>;
const TONE = { OK: "success", WARN: "warning", OUT: "destructive" } as const;
const DEC_TONE = { NOTED: "secondary", ACCEPTED: "warning", REFUSED: "destructive", BLOCKED: "destructive" } as const;
const c1 = (n: number) => `${n.toFixed(1).replace(".", ",")} °C`;

export async function ColdFleetOverview({ ctx, l, locale, orderBase }: { ctx: Ctx; l: L; locale: string; orderBase: "/vendor/orders" | "/admin/orders" }) {
  const { coldOverview, listEquipment, listClasses } = await import("@/server/coldchain/service");
  const [ov, eq, classes] = await Promise.all([coldOverview(ctx, locale), listEquipment(ctx, locale), listClasses(locale)]);
  const day = (d: Date) => new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(new Date(d));
  const time = (d: Date) => new Intl.DateTimeFormat(locale, { dateStyle: "short", timeStyle: "short" }).format(new Date(d));
  const ym = new Date().toISOString().slice(0, 7);
  const months = [0, 1, 2].map((k) => { const d = new Date(); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() - k); return d.toISOString().slice(0, 7); });
  const coldClasses = classes.filter((c) => c.coldChain).map((c) => ({ id: c.id, label: `${c.name}` }));
  const tiles = [
    { label: l.readingsTotal, value: String(ov.totals.readings) },
    { label: l.outOfRange, value: String(ov.totals.out) },
    { label: l.refusedCount, value: String(ov.totals.refused) },
    { label: l.equipmentOverdue, value: String(ov.totals.equipmentOverdue) },
  ];
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" data-testid="cc-tiles">
        {tiles.map((t) => <Card key={t.label}><CardContent className="pt-5"><p className="text-xs text-muted-foreground">{t.label}</p><p className="text-xl font-semibold tabular-nums">{t.value}</p></CardContent></Card>)}
      </div>
      <Card>
        <CardHeader><CardTitle>{l.incidentsTitle}</CardTitle></CardHeader>
        <CardContent>
          {!ov.incidents.length ? <p className="py-4 text-center text-sm text-muted-foreground">{l.noIncidents}</p> : (
            <ul className="divide-y" data-testid="cc-incidents">
              {ov.incidents.map((i) => (
                <li key={i.id} className="flex flex-wrap items-center gap-2 py-2 text-sm" data-testid="cc-incident" data-decision={i.decision}>
                  <span className="font-mono text-xs">{i.number}</span>
                  <Badge variant={DEC_TONE[i.decision as keyof typeof DEC_TONE]}>{l[`decision.${i.decision}`]}</Badge>
                  <Link href={`${orderBase}/${i.orderId}#cold-chain`} className="font-mono text-xs text-primary hover:underline">{i.order}</Link>
                  <span className="min-w-0 flex-1 basis-56 break-words">{i.cls} ({i.range}) · {l[`stage.${i.stage}`]} · <b>{c1(i.valueC)}</b> · {orderBase === "/admin/orders" ? `${i.supplier} → ${i.customer}` : i.customer}{i.fault ? ` · ${l[`fault.${i.fault}`] ?? i.fault}` : ""}</span>
                  <span className="text-xs text-muted-foreground">{time(i.at)}</span>
                </li>
              ))}
            </ul>
          )}
          {orderBase === "/admin/orders" && (ov.suppliers.length > 0 || ov.drivers.length > 0) && (
            <div className="mt-4 grid gap-4 sm:grid-cols-2 text-sm" data-testid="cc-scores">
              <div><p className="mb-1 font-medium">Per supplier</p><ul className="space-y-1">{ov.suppliers.map((s) => <li key={s.id} className="flex justify-between gap-2"><span className="min-w-0 break-words">{s.name}</span><span className="tabular-nums">{s.incidents} · {s.refused} refused</span></li>)}</ul></div>
              <div><p className="mb-1 font-medium">Per FIRINGI driver (driver&apos;s fault)</p><ul className="space-y-1">{ov.drivers.map((d) => <li key={d.id} className="flex justify-between gap-2"><span>{d.name}</span><span className="tabular-nums">{d.incidents}</span></li>)}</ul></div>
            </div>
          )}
        </CardContent>
      </Card>
      {eq.settings.equipment && (
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><Snowflake className="size-5" /> {l.equipmentTitle}</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            {!eq.equipment.length ? <p className="text-sm text-muted-foreground">{l.noEquipment}</p> : (
              <ul className="divide-y" data-testid="cc-equipment">
                {eq.equipment.map((e) => (
                  <li key={e.id} className="space-y-2 py-3 text-sm" data-testid="cc-equipment-row">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="min-w-0 flex-1 basis-48 break-words font-medium">{e.name} <span className="text-xs font-normal text-muted-foreground">· {l[`kind.${e.kind}`]}{e.vehicle ? ` · ${e.vehicle}` : ""}{e.cls ? ` · ${e.cls}` : ""}{e.serial ? ` · ${e.serial}` : ""}</span></span>
                      {e.due.map((d) => <Badge key={d.kind} variant={d.overdue ? "destructive" : "secondary"} data-testid="cc-due" data-overdue={d.overdue ? "1" : "0"}>{fill(d.overdue ? l.overdue : l.due, { task: l[`task.${d.kind}`], date: day(d.due!) })}</Badge>)}
                    </div>
                    {e.logs.length > 0 && <p className="text-xs text-muted-foreground">{l.lastLogs}: {e.logs.slice(0, 3).map((g) => `${l[`task.${g.kind}`]} ${g.ok ? "✓" : "✗"}${g.valueC != null ? ` ${c1(g.valueC)}` : ""} · ${day(g.doneAt)}${g.by ? ` · ${g.by}` : ""}`).join(" — ")}</p>}
                    <EquipmentLogForm l={l} equipmentId={e.id} />
                  </li>
                ))}
              </ul>
            )}
            <EquipmentForm l={l} vehicles={eq.vehicles.map((v) => ({ id: v.id, label: v.label }))} classes={coldClasses} />
          </CardContent>
        </Card>
      )}
      {eq.settings.loggers && (
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><Thermometer className="size-5" /> {l.loggersTitle}</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            {!eq.loggers.length ? <p className="text-sm text-muted-foreground">{l.noLoggers}</p> : (
              <ul className="divide-y" data-testid="cc-loggers">
                {eq.loggers.map((g) => (
                  <li key={g.id} className="flex flex-wrap items-center gap-2 py-2 text-sm" data-testid="cc-logger">
                    <span className="min-w-0 flex-1 basis-48 break-words font-medium">{g.name} <span className="text-xs font-normal text-muted-foreground">· …{g.hint}{g.vehicle ? ` · ${g.vehicle}` : ""}{g.cls ? ` · ${g.cls}` : ""}</span></span>
                    <span className="text-xs text-muted-foreground">{g.lastSeenAt && g.lastValueC != null ? fill(l.lastSeen, { temp: c1(g.lastValueC), date: time(g.lastSeenAt) }) : l.neverSeen}</span>
                    {g.status && <Badge variant={TONE[g.status]}>{l[`status.${g.status}`]}</Badge>}
                    {!g.active && <Badge variant="outline">{l.deactivate}</Badge>}
                    <LoggerToggle l={l} id={g.id} active={g.active} />
                  </li>
                ))}
              </ul>
            )}
            <LoggerForm l={l} vehicles={eq.vehicles.map((v) => ({ id: v.id, label: v.label }))} classes={coldClasses} />
          </CardContent>
        </Card>
      )}
      {ov.settings.records.monthly && (
        <Card>
          <CardHeader><CardTitle>{l.reportTitle}</CardTitle><CardDescription>{ym}</CardDescription></CardHeader>
          <CardContent>
            <ul className="space-y-2 text-sm" data-testid="cc-reports">
              {months.map((m) => (
                <li key={m} className="flex flex-wrap items-center gap-3">
                  <span className="w-20 font-mono">{m}</span>
                  <a className="inline-flex items-center gap-1 text-primary hover:underline" href={`/api/coldchain/report?month=${m}`}><FileDown className="size-4" /> {l.downloadPdf}</a>
                  <a className="inline-flex items-center gap-1 text-primary hover:underline" href={`/api/coldchain/report?month=${m}&format=csv`}><FileDown className="size-4" /> {l.downloadCsv}</a>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
