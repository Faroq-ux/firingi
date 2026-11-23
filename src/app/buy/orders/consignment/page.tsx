import { Boxes } from "lucide-react";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { myConsignment } from "@/server/consignment/service";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { SiteStatus, SiteView } from "@/components/consignment/views";
import { csLabels } from "@/components/consignment/labels";

export const metadata = { title: "Consignment stock" };
export const dynamic = "force-dynamic";

export default async function BuyConsignmentPage() {
  const ctx = await pagePortal("buy");
  pagePermission(ctx, ["buyer.orders.place", "buyer.orders.view"]);
  const [{ l, locale }, sites] = await Promise.all([csLabels(), myConsignment(ctx)]);
  return (
    <>
      <PageHeader title={l.buyTitle} description={l.buyIntro} icon={Boxes} />
      {!sites.length ? <Card><CardContent className="pt-6"><p className="text-sm text-muted-foreground" data-testid="cs-none">{l.noSites}</p></CardContent></Card> : (
        <div className="space-y-10">
          {sites.map((s) => (
            <section key={s.id} className="space-y-4" aria-label={`${s.supplier} · ${s.number}`}>
              <h2 className="flex flex-wrap items-center gap-2 text-lg font-semibold"><span className="min-w-0 break-words">{s.supplier}</span> <span className="text-sm font-normal text-muted-foreground">{s.number}</span> <SiteStatus l={l} status={s.status} /></h2>
              <SiteView l={l} locale={locale} s={s} />
            </section>
          ))}
        </div>
      )}
    </>
  );
}
