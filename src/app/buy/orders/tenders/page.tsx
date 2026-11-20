import Link from "next/link";
import { Gavel, Plus } from "lucide-react";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { myTenders } from "@/server/tenders/service";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { fill, statusTone, tenderLabels } from "@/components/tenders/labels";
import { formatDate } from "@/lib/utils";

export const metadata = { title: "Tenders" };
export const dynamic = "force-dynamic";

export default async function BuyerTendersPage() {
  const ctx = await pagePortal("buy");
  pagePermission(ctx, ["buyer.orders.view", "buyer.orders.place"]);
  const [{ l, locale }, m] = await Promise.all([tenderLabels(), myTenders(ctx)]);
  const canPost = m.access.post && ctx.permissions.has("buyer.orders.place");
  return (
    <>
      <PageHeader title={l.title} icon={Gavel} description={l.intro}
        actions={canPost ? <Link href="/buy/orders/tenders/new" className={buttonVariants()} data-testid="td-new"><Plus className="size-4" /> {l.newTender}</Link> : null} />
      {!m.access.post && <p className="mb-4 rounded-xl border border-dashed p-4 text-sm" data-testid="td-closed">{l[`closed.${m.access.why ?? "TYPE_OFF"}`]}</p>}
      <Card>
        <CardContent className="pt-6">
          {!m.tenders.length ? <p className="py-6 text-center text-sm text-muted-foreground">{l.noTenders}</p> : (
            <ul className="divide-y" data-testid="td-list">
              {m.tenders.map((t) => (
                <li key={t.id} className="flex flex-wrap items-center gap-2 py-3 text-sm" data-testid="td-row" data-status={t.status}>
                  <Link href={`/buy/orders/tenders/${t.id}`} className="min-w-0 break-words font-medium text-primary hover:underline">{t.number} · {t.title}</Link>
                  <Badge variant={statusTone(t.status)}>{l[`status.${t.status}`]}</Badge>
                  <span className="ml-auto text-xs text-muted-foreground">{fill(l.linesBids, { lines: t.lines, bids: t.bids })} · {t.status === "OPEN" ? fill(l.closesOn, { date: formatDate(t.closesAt, locale, true) }) : formatDate(t.createdAt, locale)}</span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </>
  );
}
