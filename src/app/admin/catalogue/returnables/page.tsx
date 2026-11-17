import { Recycle } from "lucide-react";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { can } from "@/server/rbac/guard";
import { listTypes } from "@/server/returnables/service";
import { RETURNABLE_CATEGORIES } from "@/lib/returnables";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { TypeForm } from "@/components/returnables/client";
import { enLabels } from "@/components/returnables/labels";

export const metadata = { title: "Returnable Items" };
export const dynamic = "force-dynamic";

export default async function AdminReturnableTypesPage() {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.catalogue.view", "admin.catalogue.manage", "admin.settings.manage"]);
  const l = enLabels();
  const types = await listTypes(ctx, "en");
  const money = (n: number) => new Intl.NumberFormat("en", { style: "currency", currency: "EUR" }).format(n);
  return (
    <>
      <PageHeader title="Returnable Items" icon={Recycle} description="FIRINGI's shared list (any supplier can link its products to these) and the items suppliers added for themselves. Deposit = the item's own deposit; refill items are swapped full-for-empty." />
      <Card className="mb-6">
        <CardHeader><CardTitle>All items</CardTitle></CardHeader>
        <CardContent>
          <div className="overflow-x-auto"><table className="w-full min-w-[36rem] text-sm" data-testid="admin-types"><thead><tr className="border-b text-left text-xs text-muted-foreground"><th className="py-2">Item</th><th>Code</th><th>Kind</th><th className="text-right">Deposit</th><th>Owner</th><th className="text-right">Products</th></tr></thead>
            <tbody>{types.map((t) => <tr key={t.id} className="border-b last:border-0" data-testid="admin-type" data-code={t.code}><td className="py-2">{t.name}</td><td className="font-mono text-xs">{t.code}</td><td><Badge variant={t.kind === "EXCHANGE" ? "secondary" : "outline"}>{t.kind === "EXCHANGE" ? "Refill / swap" : "Deposit"}</Badge></td><td className="text-right tabular-nums">{money(t.depositNet)}</td><td>{t.owner}</td><td className="text-right tabular-nums">{t.products}</td></tr>)}</tbody></table></div>
        </CardContent>
      </Card>
      {can(ctx, ["admin.catalogue.manage", "admin.settings.manage"]) && (
        <Card><CardHeader><CardTitle>Add to the shared list</CardTitle><CardDescription>Every supplier can use it.</CardDescription></CardHeader><CardContent><TypeForm l={l} categories={RETURNABLE_CATEGORIES} admin /></CardContent></Card>
      )}
    </>
  );
}
