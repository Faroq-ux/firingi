import { Smartphone } from "lucide-react";
import { pagePermission, pagePortal, can } from "@/server/rbac/guard";
import { appSettings, appStats } from "@/server/app/service";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AppSettingsForm } from "@/components/app/admin";

export const metadata = { title: "Phone App" };
export const dynamic = "force-dynamic";

const PORTAL: Record<string, string> = { buy: "Buyers", vendor: "Suppliers", driver: "Drivers", admin: "FIRINGI" };
const KIND: Record<string, string> = { "order.place": "Offline order", "delivery.step": "Delivery step", "delivery.complete": "Delivered (proof)", "delivery.fail": "Delivery failed", "pick.scan": "Pick scan", "pick.confirm": "Pick confirmed", "pick.short": "Short pick" };

export default async function Page() {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.settings.view", "admin.settings.manage"]);
  const [s, st] = await Promise.all([appSettings(), appStats(ctx)]);
  const kinds = [...new Set(st.ops.map((o) => o.kind))];
  const n = (kind: string, status: string) => st.ops.find((o) => o.kind === kind && o.status === status)?.n ?? 0;
  const when = (d: Date) => new Intl.DateTimeFormat("en-GB", { dateStyle: "short", timeStyle: "short" }).format(d);
  return (
    <>
      <PageHeader title="Phone App" icon={Smartphone} description="FIRINGI installs on phones and computers like an app. Buyers can order, drivers deliver and suppliers pick without signal — it all syncs when the signal returns." />
      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4" data-testid="app-kpis">
        {["buy", "vendor", "driver", "admin"].map((p) => (
          <Card key={p}><CardContent className="pt-5"><p className="text-sm text-muted-foreground">{PORTAL[p]} — installed</p><p className="text-2xl font-semibold tabular-nums">{st.installs[p] ?? 0}</p><p className="text-xs text-muted-foreground">{st.active[p] ?? 0} opened from the home screen this week</p></CardContent></Card>
        ))}
      </div>
      <div className="grid gap-4 xl:grid-cols-[1fr_1fr]">
        <Card>
          <CardHeader><CardTitle>Offline actions (30 days)</CardTitle></CardHeader>
          <CardContent>
            {!kinds.length ? <p className="text-sm text-muted-foreground">None yet.</p> : (
              <table className="w-full text-sm" data-testid="app-ops">
                <thead><tr className="text-left text-muted-foreground"><th className="py-1 font-medium">Action</th><th className="py-1 text-right font-medium">Done</th><th className="py-1 text-right font-medium">Buyer to confirm</th><th className="py-1 text-right font-medium">Failed</th></tr></thead>
                <tbody>{kinds.map((k) => <tr key={k} className="border-t"><td className="py-1.5">{KIND[k] ?? k}</td><td className="text-right tabular-nums">{n(k, "DONE")}</td><td className="text-right tabular-nums">{n(k, "NEEDS_CONFIRM")}</td><td className="text-right tabular-nums">{n(k, "FAILED")}</td></tr>)}</tbody>
              </table>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Needed attention</CardTitle></CardHeader>
          <CardContent>
            {!st.attention.length ? <p className="text-sm text-muted-foreground">Nothing — every offline action went through.</p> : (
              <ul className="divide-y text-sm" data-testid="app-attention">
                {st.attention.map((a) => (
                  <li key={a.id} className="space-y-0.5 py-2">
                    <div className="flex flex-wrap items-center gap-2"><Badge variant={a.status === "FAILED" ? "destructive" : "warning"}>{a.status === "FAILED" ? "failed" : "buyer to confirm"}</Badge><span className="font-medium">{KIND[a.kind] ?? a.kind}</span><span className="text-muted-foreground">· {a.company} · {a.person}</span></div>
                    <p className="text-xs text-muted-foreground">{a.clientAt ? `done offline ${when(a.clientAt)} · ` : ""}sent {when(a.at)}{a.attempts > 1 ? ` · ${a.attempts} tries` : ""}{a.error ? ` — ${a.error}` : ""}</p>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
      <Card className="mt-4"><CardHeader><CardTitle>Settings</CardTitle></CardHeader><CardContent><AppSettingsForm initial={s} canEdit={can(ctx, "admin.settings.manage")} /></CardContent></Card>
    </>
  );
}
