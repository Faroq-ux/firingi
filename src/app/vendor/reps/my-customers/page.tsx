import Link from "next/link";
import { Contact, Phone } from "lucide-react";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { myDay, myRep } from "@/server/salesreps/service";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { fill, srLabels } from "@/components/salesreps/labels";

export const metadata = { title: "My customers" };
export const dynamic = "force-dynamic";

export default async function MyCustomersPage() {
  const ctx = await pagePortal("vendor");
  pagePermission(ctx, "vendor.reps.field");
  const { l } = await srLabels();
  if (!(await myRep(ctx))?.active) return <><PageHeader title={l.myCustomersTitle} icon={Contact} /><p className="rounded-md bg-muted p-3 text-sm" data-testid="sr-not-rep">{l.noMyCustomers}</p></>;
  const d = await myDay(ctx);
  return (
    <>
      <PageHeader title={l.myCustomersTitle} description={l.myCustomersIntro} icon={Contact} />
      {!d.customers.length ? <p className="rounded-md bg-muted p-3 text-sm">{l.noMyCustomers}</p> : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" data-testid="mc-list">
          {d.customers.map((c) => (
            <Card key={c.id} data-testid="mc-customer" data-name={c.name}>
              <CardContent className="space-y-2 pt-5">
                <Link href={`/vendor/reps/my-customers/${c.id}`} className="block font-medium break-words hover:underline">{c.name}</Link>
                <p className="text-sm text-muted-foreground break-words">{c.address ?? c.city ?? ""}</p>
                <p className="text-sm">
                  <span className={c.days != null && c.days > 21 ? "font-medium text-[color:var(--warning,#b45309)]" : ""}>{c.days == null ? l.noOrdersYet : fill(l.daysSince, { n: c.days })}</span>
                  <span className="text-muted-foreground"> · {fill(l.orders90, { n: c.orders90 })}{c.openOrders ? ` · ${fill(l.openOrders, { n: c.openOrders })}` : ""}</span>
                </p>
                <div className="flex flex-wrap gap-2">
                  <Link href={`/vendor/reps/my-customers/${c.id}`} className={buttonVariants({ size: "sm" })} data-testid="mc-open">{l.openCard}</Link>
                  {c.phone && <a href={`tel:${c.phone}`} className={buttonVariants({ variant: "ghost", size: "sm" })}><Phone className="size-4" /> {l.call}</a>}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
