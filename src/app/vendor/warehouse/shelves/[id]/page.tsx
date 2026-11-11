import { getLocale, getTranslations } from "next-intl/server";
import { can, pagePermission, pagePortal } from "@/server/rbac/guard";
import { binDetail, listBins } from "@/server/warehouse/bins";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { BinToggle, PrintLabels, PutAwayForm } from "@/components/warehouse/controls";

export const metadata = { title: "Shelf" };

export default async function ShelfPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await pagePortal("vendor");
  pagePermission(ctx, ["vendor.warehouse.pick", "vendor.inventory.manage", "vendor.inventory.view"]);
  const [t, locale] = await Promise.all([getTranslations("warehouse"), getLocale()]);
  const { bin, lots } = await binDetail(ctx, (await params).id, locale);
  const others = (await listBins(ctx, bin.addressId)).filter((b) => b.isActive).map((b) => ({ id: b.id, label: b.code }));
  const date = new Intl.DateTimeFormat(locale, { day: "2-digit", month: "short", year: "numeric" });
  const move = can(ctx, ["vendor.warehouse.pick", "vendor.inventory.manage"]);
  return (
    <>
      <PageHeader title={`${t("shelf")} ${bin.code}`} description={[bin.warehouse, bin.zone].filter(Boolean).join(" · ")}
        actions={<div className="flex flex-wrap gap-2"><PrintLabels kind="bins" ids={[bin.id]} label={t("printShelfLabel")} />{lots.length > 0 && <PrintLabels kind="lots" ids={lots.map((l) => l.id)} />}{can(ctx, "vendor.inventory.manage") && <BinToggle id={bin.id} active={bin.isActive} />}</div>} />
      {!bin.isActive && <Badge variant="outline" className="mb-4">{t("retired")}</Badge>}
      <Card>
        <CardContent className="pt-6">
          {lots.length === 0 ? <p className="text-sm text-muted-foreground">{t("shelfEmpty")}</p> : (
            <ul className="divide-y rounded-xl border text-sm" data-testid="shelf-lots">
              {lots.map((l) => (
                <li key={l.id} className="flex flex-col gap-2 px-3 py-2.5 md:flex-row md:items-center">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{l.product} <span className="text-muted-foreground">· {l.packaging}</span></p>
                    <p className="text-xs text-muted-foreground">{t("lot")}: <span className="font-mono">{l.lotCode ?? "—"}</span>{l.expiresOn ? ` · ${t("bestBefore")}: ${date.format(l.expiresOn)}` : ""} · {t("unitsN", { count: l.onHand })}{l.reserved ? ` · ${t("reservedN", { count: l.reserved })}` : ""}</p>
                  </div>
                  {move && <PutAwayForm batchId={l.id} max={l.onHand} bins={others} current={bin.id} />}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </>
  );
}
