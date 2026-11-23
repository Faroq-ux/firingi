import { ListChecks } from "lucide-react";
import { pagePermission, pagePortal, can } from "@/server/rbac/guard";
import { myMustStock } from "@/server/assortments/service";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AddGaps } from "@/components/assortments/client";
import { asLabels, fill } from "@/components/assortments/labels";
import { formatDate, formatMoney } from "@/lib/utils";

export const metadata = { title: "Must-stock list" };
export const dynamic = "force-dynamic";

export default async function MustStockPage() {
  const ctx = await pagePortal("buy");
  pagePermission(ctx, ["buyer.orders.place", "buyer.orders.view"]);
  const place = can(ctx, "buyer.orders.place");
  const [{ l, locale }, m] = await Promise.all([asLabels(), myMustStock(ctx)]);
  const gaps = m.suppliers.reduce((a, s) => a + s.gaps, 0);
  return (
    <>
      <PageHeader title={l.mustTitle} description={fill(l.mustIntro, { days: m.gapDays })} icon={ListChecks}
        actions={place && gaps > 0 ? <AddGaps l={l} label={l.addAllMissing} /> : undefined} />
      {!m.suppliers.length ? <Card><CardContent className="pt-6"><p className="text-sm text-muted-foreground" data-testid="ms-none">{l.noneMust}</p></CardContent></Card> : (
        <div className="space-y-6" data-testid="ms-suppliers">
          {m.suppliers.map((s) => (
            <Card key={s.vendorId} data-testid="ms-supplier" data-gaps={s.gaps}>
              <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
                <CardTitle className="min-w-0 break-words">{s.supplier}</CardTitle>
                {place && s.gaps > 0 && <AddGaps l={l} vendorId={s.vendorId} label={l.addMissing} />}
              </CardHeader>
              <CardContent>
                <ul className="divide-y">
                  {s.items.map((i) => (
                    <li key={i.offerId} className="flex flex-wrap items-center gap-2 py-2 text-sm" data-testid="ms-item" data-gap={i.gap} data-offer={i.offerId}>
                      <span className="min-w-0 flex-1 basis-48 break-words">{i.name} <span className="text-xs text-muted-foreground">· {i.packaging}</span></span>
                      {i.unitNet != null && <span className="tabular-nums">{formatMoney(i.unitNet, locale)}</span>}
                      <span className="text-xs text-muted-foreground">{l.lastOrdered}: {i.lastOrdered ? formatDate(i.lastOrdered, locale) : l.never}</span>
                      {!i.available ? <Badge variant="secondary">{l.unavailable}</Badge> : i.gap ? <Badge variant="warning">{l.gap}</Badge> : <Badge variant="success">{l.ok}</Badge>}
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
