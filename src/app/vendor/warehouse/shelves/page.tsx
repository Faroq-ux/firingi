import { getLocale, getTranslations } from "next-intl/server";
import { Boxes, LayoutGrid, MapPinOff, PackageOpen } from "lucide-react";
import { can, pagePermission, pagePortal } from "@/server/rbac/guard";
import { listBins, unshelved } from "@/server/warehouse/bins";
import { warehouseOptions } from "@/server/inventory/options";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DataTable } from "@/components/ui/data-table";
import { Tile } from "@/components/motion/dashboard-kit";
import { BinForm, BinRangeForm, PrintLabels, PutAwayForm } from "@/components/warehouse/controls";

export const metadata = { title: "Shelves" };

export default async function Shelves({ searchParams }: { searchParams: Promise<{ wh?: string }> }) {
  const ctx = await pagePortal("vendor");
  pagePermission(ctx, ["vendor.warehouse.pick", "vendor.inventory.manage", "vendor.inventory.view"]);
  const sp = await searchParams;
  const [t, locale] = await Promise.all([getTranslations("warehouse"), getLocale()]);
  const whs = await warehouseOptions(ctx);
  const addressId = whs.find((w) => w.id === sp.wh)?.id ?? whs[0]?.id;
  const [bins, loose] = await Promise.all([listBins(ctx, addressId), addressId ? unshelved(ctx, addressId, locale) : Promise.resolve([])]);
  const active = bins.filter((b) => b.isActive);
  const opts = active.map((b) => ({ id: b.id, label: b.code }));
  const manage = can(ctx, "vendor.inventory.manage"), move = can(ctx, ["vendor.warehouse.pick", "vendor.inventory.manage"]);
  const date = new Intl.DateTimeFormat(locale, { day: "2-digit", month: "short", year: "numeric" });
  return (
    <>
      <PageHeader title={t("shelvesTitle")} description={t("shelvesIntro")} actions={<PrintLabels kind="bins" ids={active.map((b) => b.id)} />} />
      {whs.length > 1 && (
        <nav className="mb-4 flex flex-wrap gap-2 text-sm" aria-label={t("warehouse")}>
          {whs.map((w) => <a key={w.id} href={`?wh=${w.id}`} className={`rounded-full border px-3 py-1 ${w.id === addressId ? "border-primary bg-primary/10 font-medium" : ""}`}>{w.label}</a>)}
        </nav>
      )}
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4" data-testid="shelf-kpis">
        <Tile icon={LayoutGrid} label={t("kpiShelves")} value={active.length} locale={locale} tone="tone-violet" i={0} />
        <Tile icon={Boxes} label={t("kpiUsed")} value={active.filter((b) => b.units > 0).length} locale={locale} tone="tone-blue" i={1} />
        <Tile icon={PackageOpen} label={t("kpiEmpty")} value={active.filter((b) => b.units === 0).length} locale={locale} tone="tone-teal" i={2} />
        <Tile icon={MapPinOff} label={t("kpiUnshelved")} value={loose.length} locale={locale} tone="tone-orange" i={3} />
      </div>
      {manage && (
        <Card className="mb-6">
          <CardHeader><CardTitle>{t("addShelves")}</CardTitle><CardDescription>{t("addShelvesHint")}</CardDescription></CardHeader>
          <CardContent className="space-y-6"><BinRangeForm warehouses={whs.filter((w) => w.id === addressId).concat(whs.filter((w) => w.id !== addressId))} /><BinForm warehouses={whs.filter((w) => w.id === addressId).concat(whs.filter((w) => w.id !== addressId))} /></CardContent>
        </Card>
      )}
      {loose.length > 0 && (
        <Card className="mb-6" data-testid="unshelved">
          <CardHeader><CardTitle>{t("putAwayTitle")}</CardTitle><CardDescription>{t("putAwayHint")}</CardDescription></CardHeader>
          <CardContent>
            <ul className="divide-y rounded-xl border text-sm">
              {loose.map((l) => (
                <li key={l.id} className="flex flex-col gap-2 px-3 py-2.5 md:flex-row md:items-center">
                  <div className="min-w-0 flex-1"><p className="truncate font-medium">{l.product} <span className="text-muted-foreground">· {l.packaging}</span></p><p className="text-xs text-muted-foreground">{t("lot")}: <span className="font-mono">{l.lotCode ?? "—"}</span>{l.expiresOn ? ` · ${t("bestBefore")}: ${date.format(l.expiresOn)}` : ""} · {t("unitsN", { count: l.onHand })}</p></div>
                  {move && opts.length > 0 ? <PutAwayForm batchId={l.id} max={l.onHand} bins={opts} /> : null}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
      <DataTable tableId="vendor.shelves" testId="shelves-table" empty={t("noShelves")} exportName="shelves"
        columns={[{ key: "code", label: t("shelf") }, { key: "zone", label: t("zone"), filter: true }, { key: "units", label: t("units"), type: "number" }, { key: "lots", label: t("lots"), type: "number" }, { key: "next", label: t("nextBestBefore"), type: "date" }, { key: "state", label: t("statusLabel"), type: "badge", filter: true }]}
        rows={bins.map((b) => ({
          id: b.id, href: `/vendor/warehouse/shelves/${b.id}`,
          cells: {
            code: { t: b.code, mono: true, href: `/vendor/warehouse/shelves/${b.id}` }, zone: b.zone ?? "", units: b.units, lots: b.lots,
            next: b.nextExpiry ? { t: date.format(b.nextExpiry), v: b.nextExpiry.toISOString() } : null,
            state: !b.isActive ? { t: t("retired"), tone: "outline" } : b.units ? { t: t("inUse"), tone: "success" } : { t: t("empty"), tone: "secondary" },
          },
        }))} />
    </>
  );
}
