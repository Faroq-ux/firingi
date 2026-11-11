import { getTranslations } from "next-intl/server";
import { CheckCircle2, AlertTriangle, XCircle } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { publicStatus } from "@/server/ops/status";

export const dynamic = "force-dynamic";
export const metadata = { title: "Status" };

const ICON = { ok: CheckCircle2, warning: AlertTriangle, critical: XCircle } as const;
const COLOR = { ok: "text-success", warning: "text-warning", critical: "text-destructive" } as const;
const hhmm = (d: Date | string) => new Date(d).toISOString().slice(0, 16).replace("T", " ");

export default async function StatusPage() {
  const t = await getTranslations("status");
  const s = await publicStatus();
  const Overall = ICON[s.overall];
  return (
    <Card>
      <CardContent className="space-y-5 py-6">
        <div className="text-center">
          <h1 className="text-xl font-semibold">{t("title")}</h1>
          <p className={`mt-2 inline-flex items-center gap-2 font-medium ${COLOR[s.overall]}`} data-testid="status-overall" data-state={s.overall}>
            <Overall className="size-5" aria-hidden />{t(s.overall === "ok" ? "allOk" : s.overall === "warning" ? "degraded" : "outage")}
          </p>
        </div>
        <ul className="divide-y rounded-lg border" data-testid="status-components">
          {s.components.map((c) => {
            const I = ICON[c.state];
            return (
              <li key={c.key} className="flex items-center justify-between px-3 py-2 text-sm" data-component={c.key} data-state={c.state}>
                <span>{t(`components.${c.key}`)}</span>
                <span className={`inline-flex items-center gap-1.5 ${COLOR[c.state]}`}><I className="size-4" aria-hidden />{t(`states.${c.state}`)}</span>
              </li>
            );
          })}
        </ul>
        <div>
          <h2 className="mb-2 text-sm font-semibold">{t("incidents")}</h2>
          {s.incidents.length ? (
            <ul className="space-y-1 text-sm" data-testid="status-incidents">
              {s.incidents.map((i) => (
                <li key={i.id} className="flex justify-between gap-2">
                  <span>{t(`components.${i.component}`)} · {t(`states.${i.severity === "CRITICAL" ? "critical" : "warning"}`)}</span>
                  <span className="text-muted-foreground tabular-nums">{hhmm(i.openedAt)} → {i.resolvedAt ? hhmm(i.resolvedAt) : t("ongoing")}</span>
                </li>
              ))}
            </ul>
          ) : <p className="text-sm text-muted-foreground">{t("noIncidents")}</p>}
        </div>
        <p className="text-center text-xs text-muted-foreground">{t("checked", { time: hhmm(s.at) })}</p>
      </CardContent>
    </Card>
  );
}
