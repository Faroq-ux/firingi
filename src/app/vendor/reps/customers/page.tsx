import { Users } from "lucide-react";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { assignableCustomers, team } from "@/server/salesreps/service";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AssignRep } from "@/components/salesreps/client";
import { srLabels } from "@/components/salesreps/labels";
import { formatDate } from "@/lib/utils";

export const metadata = { title: "Rep customers" };
export const dynamic = "force-dynamic";

export default async function RepCustomersPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const ctx = await pagePortal("vendor");
  pagePermission(ctx, "vendor.reps.manage");
  const { q } = await searchParams;
  const [{ l, locale }, rows, t] = await Promise.all([srLabels(), assignableCustomers(ctx, q), team(ctx)]);
  const reps = t.reps.filter((r) => r.active).map((r) => ({ id: r.id, name: r.name }));
  const repName = new Map(t.reps.map((r) => [r.id, r.name]));
  return (
    <>
      <PageHeader title={l.customersTitle} description={l.customersIntro} icon={Users} />
      <form className="mb-4 flex gap-2" method="get">
        <Input name="q" defaultValue={q ?? ""} placeholder={l.search} aria-label={l.search} className="max-w-sm" data-testid="sr-cust-search" />
        <Button type="submit" variant="outline">{l.show}</Button>
      </form>
      <Card>
        <CardContent className="pt-4">
          {!rows.length ? <p className="text-sm text-muted-foreground">{l.noCustomers}</p> : (
            <ul className="divide-y" data-testid="sr-customers">
              {rows.map((c) => (
                <li key={c.id} className="flex flex-wrap items-center gap-3 py-3 text-sm" data-testid="sr-customer" data-name={c.name}>
                  <div className="min-w-0 flex-1 basis-56">
                    <p className="font-medium break-words">{c.name}</p>
                    <p className="text-xs text-muted-foreground">{[c.city, `${l.orders}: ${c.orders}`, `${l.lastOrder}: ${c.lastOrder ? formatDate(c.lastOrder, locale) : l.never}`].filter(Boolean).join(" · ")}</p>
                  </div>
                  <div className="w-full sm:w-56">
                    {reps.length ? <AssignRep l={l} buyerCompanyId={c.id} repId={c.repId} reps={c.repId && !reps.some((r) => r.id === c.repId) ? [...reps, { id: c.repId, name: repName.get(c.repId) ?? "—" }] : reps} /> : <span className="text-muted-foreground">{l.noReps}</span>}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </>
  );
}
