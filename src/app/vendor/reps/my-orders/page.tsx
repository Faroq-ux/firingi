import Link from "next/link";
import { ClipboardList } from "lucide-react";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { myRep, myRepOrders } from "@/server/salesreps/service";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CancelRepOrder } from "@/components/salesreps/client";
import { RepOrderBadge } from "@/components/salesreps/views";
import { fill, srLabels } from "@/components/salesreps/labels";
import { formatDate, formatMoney } from "@/lib/utils";

export const metadata = { title: "Orders I took" };
export const dynamic = "force-dynamic";

export default async function MyRepOrdersPage() {
  const ctx = await pagePortal("vendor");
  pagePermission(ctx, "vendor.reps.field");
  const { l, locale } = await srLabels();
  if (!(await myRep(ctx))?.active) return <><PageHeader title={l.myOrdersTitle} icon={ClipboardList} /><p className="rounded-md bg-muted p-3 text-sm" data-testid="sr-not-rep">{l.noMyCustomers}</p></>;
  const rows = await myRepOrders(ctx);
  return (
    <>
      <PageHeader title={l.myOrdersTitle} description={l.myOrdersIntro} icon={ClipboardList} />
      <Card>
        <CardContent className="pt-4">
          {!rows.length ? <p className="text-sm text-muted-foreground">{l.noRepOrders}</p> : (
            <ul className="divide-y" data-testid="mo-list">
              {rows.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center gap-2 py-3 text-sm" data-testid="mo-row" data-status={r.status}>
                  <div className="min-w-0 flex-1 basis-56">
                    <Link href={`/vendor/reps/my-customers/${r.buyerCompanyId}`} className="font-medium break-words hover:underline">{r.customer}</Link>
                    <p className="text-xs text-muted-foreground">{formatDate(r.createdAt, locale, true)} · {fill(l.lines, { n: r.lines })}{r.orderNumbers.length ? ` · ${fill(l.orderNumbers, { numbers: r.orderNumbers.join(", ") })}` : ""}{r.status === "PENDING" ? ` · ${fill(l.expires, { date: formatDate(r.expiresAt, locale, true) })}` : ""}</p>
                    {r.error && <p className="text-xs text-destructive break-words">{r.error}</p>}
                  </div>
                  <span className="tabular-nums">{formatMoney(r.totalNet, locale)}</span>
                  {r.auto && <Badge variant="secondary">{l.auto}</Badge>}
                  <RepOrderBadge l={l} status={r.status} />
                  {r.status === "PENDING" && <CancelRepOrder l={l} id={r.id} />}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </>
  );
}
