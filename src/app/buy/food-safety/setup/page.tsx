import { notFound } from "next/navigation";
import { Settings2 } from "lucide-react";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { haccpAccess, setup } from "@/server/haccp/service";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { haccpLabels } from "@/components/haccp/labels";
import { TaskForm, TemplateButton, UnitForm } from "@/components/haccp/client";

export const metadata = { title: "Logbook Setup" };
export const dynamic = "force-dynamic";

/** Phase 69: equipment (limits, check times), checklists and cleaning tasks, and a ready-made template to start. */
export default async function FoodSafetySetup() {
  const ctx = await pagePortal("buy");
  pagePermission(ctx, "buyer.haccp.manage");
  if (!(await haccpAccess(ctx.company)).on) notFound();
  const [{ l }, d] = await Promise.all([haccpLabels(), setup(ctx)]);
  const p = d.settings.parts;
  return (
    <>
      <PageHeader title={l.setupTitle} description={l.setupIntro} icon={Settings2} />
      <div className="space-y-6">
        {d.templates.length > 0 && (
          <Card>
            <CardHeader><CardTitle>{l.templates}</CardTitle><CardDescription>{l.templateHint}</CardDescription></CardHeader>
            <CardContent className="flex flex-wrap gap-3">{d.templates.map((k) => <TemplateButton key={k} l={l} k={k} />)}</CardContent>
          </Card>
        )}
        {p.temperatures && (
          <Card>
            <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2"><CardTitle>{l.equipment}</CardTitle><UnitForm l={l} /></CardHeader>
            <CardContent>
              {!d.units.length ? <p className="text-sm text-muted-foreground" data-testid="hc-no-units">{l.noUnits}</p> : (
                <ul className="divide-y" data-testid="hc-units">
                  {d.units.map((u) => (
                    <li key={u.id} className="space-y-1 py-3" data-testid="hc-setup-unit" data-name={u.name}>
                      <div className="flex flex-wrap items-center gap-2 text-sm"><span className="min-w-0 break-words font-medium">{u.name}</span><Badge variant="secondary">{l[`unitKind.${u.kind}`]}</Badge><span className="text-muted-foreground">{u.limit}</span>{!u.active && <Badge variant="outline">{l.inactive}</Badge>}</div>
                      <p className="text-xs text-muted-foreground">{l.times}: {u.times.join(", ") || "—"}</p>
                      <UnitForm l={l} unit={{ id: u.id, name: u.name, kind: u.kind, minC: u.minC, maxC: u.maxC, times: u.times, active: u.active }} />
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        )}
        {(p.checklists || p.cleaning) && (
          <Card>
            <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2"><CardTitle>{l.checklists}</CardTitle><TaskForm l={l} photos={p.photos} /></CardHeader>
            <CardContent>
              {!d.tasks.length ? <p className="text-sm text-muted-foreground" data-testid="hc-no-tasks">{l.noTasks}</p> : (
                <ul className="divide-y" data-testid="hc-tasks">
                  {d.tasks.map((t) => (
                    <li key={t.id} className="space-y-1 py-3" data-testid="hc-setup-task" data-name={t.name}>
                      <div className="flex flex-wrap items-center gap-2 text-sm"><span className="min-w-0 break-words font-medium">{t.name}</span><Badge variant="secondary">{l[`taskKind.${t.kind}`]} · {l[`freq.${t.frequency}`]}{t.frequency === "WEEKLY" && t.weekday ? ` · ${l[`weekdays.d${t.weekday}`]}` : ""}{t.frequency === "MONTHLY" && t.dayOfMonth ? ` · ${t.dayOfMonth}` : ""}</Badge>{!t.active && <Badge variant="outline">{l.inactive}</Badge>}</div>
                      <p className="text-xs text-muted-foreground">{t.items.join(" · ")}</p>
                      <TaskForm l={l} photos={p.photos} task={{ id: t.id, name: t.name, kind: t.kind, frequency: t.frequency, weekday: t.weekday, dayOfMonth: t.dayOfMonth, items: t.items, needsPhoto: t.needsPhoto, active: t.active }} />
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </>
  );
}
