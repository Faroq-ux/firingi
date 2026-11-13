import { can, pagePermission, pagePortal } from "@/server/rbac/guard";
import { kpiBoard } from "@/server/services/performance";
import { PageHeader } from "@/components/layout/page-header";
import { ProgressRing } from "@/components/motion/shapes";
import { CountUp } from "@/components/motion/count-up";
import { KpiTargetForm } from "@/components/profit/forms";
import { toneFor } from "@/components/analytics/kit";
import { fmtValue } from "@/lib/analytics-format";

export const metadata = { title: "KPI & Performance" };
export const dynamic = "force-dynamic";

export default async function Page() {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.dashboard.view", "admin.finance.view", "admin.analytics.view"]);
  const b = await kpiBoard(ctx);
  const edit = can(ctx, ["admin.finance.manage", "admin.settings.manage"]);
  const month = new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${b.month}-01T00:00:00Z`));
  return (
    <>
      <PageHeader title="KPI & Performance" description={`${month} so far against the targets you set, and against last month. Revenue and profit by invoice date.`} />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" data-testid="kpi-board">
        {b.rows.map((r, i) => {
          const fmt = r.fmt as "money" | "percent" | "number";
          const vs = r.current !== null && r.previous !== null && r.previous !== 0 ? (r.current - r.previous) / Math.abs(r.previous) : null;
          return (
            <div key={r.key} className={`tile gloss motion-rise motion-lift rounded-xl border p-4 ${toneFor(r.label)}`} style={{ ["--i" as string]: i }} data-testid={`kpi-${r.key}`}>
              <div className="flex items-center gap-4 [&>[role=img]]:shrink-0">
                <ProgressRing value={r.progress ?? 0} size={86} stroke={9} label={`${r.label}: ${r.progress === null ? "no target" : `${Math.round((r.progress ?? 0) * 100)} % of target`}`}>
                  <b className="text-sm">{r.progress === null ? "—" : `${Math.round(r.progress * 100)}%`}</b>
                </ProgressRing>
                <div className="min-w-0 flex-1">
                  <div className="kpi-label text-xs font-semibold uppercase tracking-wide text-[color:color-mix(in_oklch,var(--tone)_70%,var(--foreground))]">{r.label}</div>
                  <div className="kpi-value">{r.current === null ? "—" : <CountUp value={r.key === "rating" ? Math.round(r.current * 10) / 10 : r.current} fmt={fmt} locale="pt-PT" />}</div>
                  <div className="text-xs text-muted-foreground">
                    last month {r.previous === null ? "—" : fmtValue(r.previous, fmt, "pt-PT")}
                    {vs !== null && <span className={vs >= 0 ? "ml-1 text-success" : "ml-1 text-destructive"}>{vs >= 0 ? "▲" : "▼"} {Math.abs(Math.round(vs * 100))}%</span>}
                  </div>
                  <div className="mt-1 text-xs">target {r.target === null ? "—" : fmtValue(r.target, fmt, "pt-PT")}</div>
                </div>
              </div>
              {edit && <div className="mt-2"><KpiTargetForm month={`${b.month}-01`} metric={r.key} target={r.target} step={fmt === "percent" ? "0.01" : fmt === "money" ? "100" : "1"} /></div>}
            </div>
          );
        })}
      </div>
      {edit && <p className="mt-3 text-xs text-muted-foreground">Percentages are entered as fractions (0.12 = 12 %).</p>}
    </>
  );
}
