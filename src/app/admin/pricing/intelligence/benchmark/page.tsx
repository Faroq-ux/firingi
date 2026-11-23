import { Boxes, Coins, Layers, Scale, Users } from "lucide-react";
import { pagePermission, pagePortal, can } from "@/server/rbac/guard";
import { adminOverview, benchOverrideList } from "@/server/benchmark/service";
import { benchSettings } from "@/server/benchmark/settings";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tile } from "@/components/motion/dashboard-kit";
import { TabLinks } from "@/app/admin/ai/_kit";
import { BUSINESS_TYPES } from "@/lib/business-types";
import { BenchSettingsForm, CompanyBenchSwitch, FindBenchBusiness, RebuildNow } from "@/components/benchmark/client";

export const metadata = { title: "Price Benchmark" };
export const dynamic = "force-dynamic";
const eur = (n: number) => new Intl.NumberFormat("en", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(n);

/** Phase 70: FIRINGI's view of the price benchmark (English) — coverage, customers paying above the market, switches. */
export default async function AdminBenchmark({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.pricing.view", "admin.pricing.manage"]);
  const tab = (await searchParams).tab === "SETTINGS" ? "SETTINGS" : "OVERVIEW";
  const manage = can(ctx, ["admin.pricing.manage", "admin.settings.manage"]);
  const [o, s, overrides] = await Promise.all([adminOverview(ctx), benchSettings(), benchOverrideList(ctx)]);
  const { companies: _c, ...form } = s;
  void _c;
  return (
    <>
      <PageHeader title="Price Benchmark" icon={Scale} actions={manage ? <RebuildNow /> : undefined}
        description={`What similar buyers pay for the same product (per unit), by country, region and kind of business — groups only with ${s.minBuyers}+ buyers, nobody named. Customers see where they could save; suppliers see their price position.`} />
      <TabLinks testid="bm-tabs" active={tab} href={(x) => `/admin/pricing/intelligence/benchmark?tab=${x}`} tabs={[{ key: "OVERVIEW", label: "Overview" }, { key: "SETTINGS", label: "Settings" }]} />
      {tab === "OVERVIEW" ? (
        <div className="space-y-6">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Tile icon={Layers} label="Benchmark groups" value={o.run?.groups ?? 0} locale="en" tone="tone-blue" testId="bma-groups" hint={o.run ? `rebuilt ${new Date(o.run.at).toISOString().slice(0, 16).replace("T", " ")} UTC` : "not built yet"} />
            <Tile icon={Boxes} label="Products covered" value={o.run?.variants ?? 0} locale="en" tone="tone-teal" i={1} />
            <Tile icon={Users} label="Buyers in the data" value={o.run?.buyers ?? 0} locale="en" tone="tone-violet" i={2} />
            <Tile icon={Coins} label="Customers could save (a year)" value={o.run?.totalSaving ?? 0} fmt="money" locale="en" tone="tone-orange" i={3} />
          </div>
          <Card>
            <CardHeader><CardTitle>Groups by level</CardTitle></CardHeader>
            <CardContent className="grid gap-2 text-sm sm:grid-cols-4">{(["COUNTRY", "REGION", "TYPE", "REGION_TYPE"] as const).map((k) => <p key={k}><span className="text-muted-foreground">{{ COUNTRY: "Country", REGION: "Region", TYPE: "Kind of business", REGION_TYPE: "Region + kind" }[k]}:</span> <span className="font-semibold tabular-nums">{o.levels[k]}</span></p>)}</CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Customers paying most above the market</CardTitle><CardDescription>Yearly amount above the median of similar businesses — a churn risk (also an AI Centre suggestion).</CardDescription></CardHeader>
            <CardContent>
              {!o.top.length ? <p className="text-sm text-muted-foreground">Nobody yet.</p> : (
                <ul className="divide-y" data-testid="bma-top">{o.top.map((x) => <li key={x.companyId} className="flex flex-wrap items-center gap-2 py-2 text-sm"><span className="min-w-0 flex-1 break-words font-medium">{x.name}</span><span className="text-xs text-muted-foreground">{x.type.toLowerCase()} · {x.products} products</span><span className="font-semibold tabular-nums">{eur(x.saving)}</span>{manage && <CompanyBenchSwitch companyId={x.companyId} state={s.companies[x.companyId] ?? "DEFAULT"} />}</li>)}</ul>
              )}
            </CardContent>
          </Card>
        </div>
      ) : (
        <div className="space-y-6">
          <Card><CardContent className="pt-6">{manage ? <BenchSettingsForm initial={form} types={[...BUSINESS_TYPES]} /> : <p className="text-sm text-muted-foreground">Your role can&apos;t change these.</p>}</CardContent></Card>
          <Card>
            <CardHeader><CardTitle>Single businesses</CardTitle><CardDescription>Switch the benchmark on or off for one business, whatever the settings above say.</CardDescription></CardHeader>
            <CardContent className="space-y-4">
              {!overrides.length ? <p className="text-sm text-muted-foreground">None — every business follows the settings.</p> : (
                <ul className="divide-y" data-testid="bms-overrides">{overrides.map((c) => <li key={c.id} className="flex flex-wrap items-center gap-2 py-2 text-sm"><span className="min-w-0 flex-1 break-words font-medium">{c.name} <span className="text-xs font-normal text-muted-foreground">· {c.type.toLowerCase()}</span></span>{manage ? <CompanyBenchSwitch companyId={c.id} state={c.state} /> : <span>{c.state === "ON" ? "Always on" : "Off"}</span>}</li>)}</ul>
              )}
              {manage && <FindBenchBusiness />}
            </CardContent>
          </Card>
        </div>
      )}
    </>
  );
}
