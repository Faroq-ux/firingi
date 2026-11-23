import { Activity, AlertTriangle, Building2, GraduationCap, ShieldCheck, Thermometer } from "lucide-react";
import { pagePermission, pagePortal, can } from "@/server/rbac/guard";
import { adminBusinesses, adminOverview } from "@/server/haccp/service";
import { haccpOverrides, haccpSettings } from "@/server/haccp/settings";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tile } from "@/components/motion/dashboard-kit";
import { TabLinks } from "@/app/admin/ai/_kit";
import { TEMPLATES } from "@/lib/haccp";
import { CompanyHaccpSwitch, FindHaccpBusiness, HaccpSettingsForm } from "@/components/haccp/admin";

export const metadata = { title: "Food Safety (HACCP)" };
export const dynamic = "force-dynamic";
const TABS = ["OVERVIEW", "BUSINESSES", "SETTINGS"] as const;
type Tab = (typeof TABS)[number];
const TPL_LABEL: Record<string, string> = { RESTAURANT: "Restaurant", CAFE: "Café / bakery", SHOP: "Shop / butcher" };
const ago = (d: Date | null) => (d ? `${Math.max(0, Math.round((Date.now() - d.getTime()) / 3600_000))} h ago` : "never");

/** Phase 69: FIRINGI's view of the food safety logbook (English) — who uses it, completion, switches. */
export default async function AdminFoodSafety({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.haccp.view", "admin.haccp.manage"]);
  const sp = await searchParams;
  const tab: Tab = TABS.includes(sp.tab as Tab) ? (sp.tab as Tab) : "OVERVIEW";
  const s = await haccpSettings();
  const manage = can(ctx, ["admin.haccp.manage", "admin.settings.manage"]);
  return (
    <>
      <PageHeader title="Food Safety (HACCP)" icon={ShieldCheck}
        description="The food safety logbook customers and wholesalers keep on FIRINGI: temperatures, checklists, cleaning, delivery checks, cooling and training, with the inspector-ready report. FIRINGI switches it and each part on or off, chooses the templates and rules, and can override it per business." />
      {!s.enabled && <p className="mb-4 rounded-lg border border-dashed p-3 text-sm text-muted-foreground" data-testid="hcs-off">The logbook is switched off (Settings).</p>}
      <TabLinks testid="hc-tabs" active={tab} href={(x) => `/admin/food-safety?tab=${x}`} tabs={[{ key: "OVERVIEW", label: "Overview" }, { key: "BUSINESSES", label: "Businesses" }, { key: "SETTINGS", label: "Settings" }]} />
      {tab === "OVERVIEW" && <Overview />}
      {tab === "BUSINESSES" && <Businesses />}
      {tab === "SETTINGS" && <Settings />}
    </>
  );

  async function Overview() {
    const o = await adminOverview(ctx);
    return (
      <div className="space-y-6">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Tile icon={Building2} label="Businesses set up" value={o.businesses} locale="en" tone="tone-teal" hint={`${o.active} recorded this week`} testId="hca-businesses" />
          <Tile icon={Activity} label="Average completion (7 days)" value={o.avgPct / 100} fmt="percent" locale="en" tone="tone-blue" i={1} />
          <Tile icon={Thermometer} label="Records (7 days)" value={o.entries7} locale="en" tone="tone-violet" i={2} hint={`${o.units} pieces of equipment`} />
          <Tile icon={AlertTriangle} label="Out of range (7 days)" value={o.out7} locale="en" tone="tone-orange" i={3} hint={<span className="inline-flex items-center gap-1"><GraduationCap className="size-3" /> {o.expiredTraining} training records expired</span>} />
        </div>
        <Card>
          <CardHeader><CardTitle>Below 80 % complete</CardTitle><CardDescription>Businesses that may need help with their logbook.</CardDescription></CardHeader>
          <CardContent>
            {!o.low.length ? <p className="text-sm text-muted-foreground">None.</p> : <ul className="divide-y">{o.low.map((b) => <li key={b.id} className="flex flex-wrap items-center gap-2 py-2 text-sm"><span className="min-w-0 flex-1 break-words font-medium">{b.name}</span><Badge variant="warning">{b.pct7}%</Badge><span className="text-xs text-muted-foreground">last record {ago(b.last)}</span></li>)}</ul>}
          </CardContent>
        </Card>
      </div>
    );
  }

  async function Businesses() {
    const rows = await adminBusinesses(ctx);
    return (
      <Card>
        <CardContent className="pt-6">
          {!rows.length ? <p className="text-sm text-muted-foreground">No business has set up a logbook yet.</p> : (
            <ul className="divide-y" data-testid="hca-rows">
              {rows.map((b) => (
                <li key={b.id} className="flex flex-wrap items-center gap-2 py-2 text-sm" data-testid="hca-row" data-name={b.name}>
                  <span className="min-w-0 flex-1 basis-48 break-words"><span className="font-medium">{b.name}</span> <span className="text-xs text-muted-foreground">· {b.type.toLowerCase()} · {b.units} equipment · {b.tasks} checklists · {b.entries7} records / 7 days · last {ago(b.last)}</span></span>
                  <Badge variant={b.pct7 >= 90 ? "success" : b.pct7 >= 70 ? "warning" : "destructive"}>{b.pct7}%</Badge>
                  {b.out7 > 0 && <Badge variant="destructive">{b.out7} out of range</Badge>}
                  {!b.on && <Badge variant="secondary">off</Badge>}
                  {manage && <CompanyHaccpSwitch companyId={b.id} state={b.override ?? "DEFAULT"} />}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    );
  }

  async function Settings() {
    const overrides = await haccpOverrides(ctx);
    const { companies: _c, ...form } = s;
    void _c;
    return (
      <div className="space-y-6">
        <Card><CardHeader><CardTitle>Switches</CardTitle></CardHeader><CardContent>{manage ? <HaccpSettingsForm initial={form} templates={TEMPLATES.map((t) => ({ key: t.key, label: TPL_LABEL[t.key] ?? t.key }))} /> : <p className="text-sm text-muted-foreground">Your role can&apos;t change these.</p>}</CardContent></Card>
        <Card>
          <CardHeader><CardTitle>Per business</CardTitle><CardDescription>Switch the logbook on or off for one business, whatever its type.</CardDescription></CardHeader>
          <CardContent className="space-y-4">
            {!!overrides.length && <ul className="divide-y rounded-lg border">{overrides.map((c) => <li key={c.id} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm"><span className="min-w-0 flex-1 break-words">{c.name} <span className="text-xs text-muted-foreground">· {c.type.toLowerCase()}</span></span>{manage ? <CompanyHaccpSwitch companyId={c.id} state={c.state} /> : <Badge>{c.state}</Badge>}</li>)}</ul>}
            {manage && <FindHaccpBusiness />}
          </CardContent>
        </Card>
      </div>
    );
  }
}
