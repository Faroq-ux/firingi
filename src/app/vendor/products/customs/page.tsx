import { Barcode } from "lucide-react";
import { can, pagePermission, pagePortal } from "@/server/rbac/guard";
import { supplierCustoms } from "@/server/trade/service";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CustomsProposalForm } from "@/components/trade/supplier";
import { fill, tradeLabels } from "@/components/trade/labels";

export const metadata = { title: "Customs Codes" };
export const dynamic = "force-dynamic";

export default async function VendorCustomsPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const ctx = await pagePortal("vendor");
  pagePermission(ctx, ["vendor.products.view", "vendor.products.manage"]);
  const { l, locale } = await tradeLabels();
  const { q } = await searchParams;
  const d = await supplierCustoms(ctx, locale, q);
  const edit = d.enabled && can(ctx, "vendor.products.manage");
  return (
    <>
      <PageHeader title={l.customsTitle} icon={Barcode} description={l.customsIntro} />
      {!d.enabled && <p className="mb-4 rounded-lg border bg-muted/40 p-3 text-sm">{l.customsOff}</p>}
      <Card>
        <CardContent className="space-y-3 pt-5">
          <form><input name="q" defaultValue={q ?? ""} placeholder={l.search} aria-label={l.search} className="w-full max-w-sm rounded-md border bg-background px-3 py-1.5 text-sm" /></form>
          {!d.rows.length ? <p className="text-sm text-muted-foreground">{l.none}</p> : (
            <ul className="divide-y" data-testid="customs-rows">
              {d.rows.map((r) => (
                <li key={r.packagingUnitId} className="space-y-2 py-3" data-testid={`customs-row-${r.packagingUnitId}`}>
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="min-w-0 break-words font-medium">{r.name}</span><span className="text-muted-foreground">{r.pack} · {r.sku}</span>
                    {r.missing && <Badge variant="warning">{l.missing}</Badge>}
                    {r.proposal && <Badge variant={r.proposal.status === "ACCEPTED" ? "success" : r.proposal.status === "REJECTED" ? "destructive" : "secondary"}>{l[`status.${r.proposal.status}`]}</Badge>}
                  </div>
                  <p className="text-xs text-muted-foreground">{l.onFile}: {l.cn} {r.cn ?? "—"}{r.categoryCn ? ` (${fill(l.categoryDefault, { code: r.categoryCn })})` : ""} · {l.netKg} {r.netKg ?? "—"} · {l.supp} {r.supp ?? "—"} · {l.origin} {r.origin ?? "—"}</p>
                  {r.proposal?.status === "REJECTED" && r.proposal.reviewNote && <p className="text-xs text-destructive">{r.proposal.reviewNote}</p>}
                  {edit && <CustomsProposalForm l={l} row={r} />}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </>
  );
}
