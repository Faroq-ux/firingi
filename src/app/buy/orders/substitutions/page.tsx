import { Repeat } from "lucide-react";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { myPreferences } from "@/server/substitutions/service";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PreferencesForm, ProductRules } from "@/components/substitutions/client";
import { RecentSubstitutions } from "@/components/substitutions/views";
import { fill, subLabels } from "@/components/substitutions/labels";

export const metadata = { title: "Replacements" };
export const dynamic = "force-dynamic";

export default async function BuyerSubstitutionsPage() {
  const ctx = await pagePortal("buy");
  pagePermission(ctx, ["buyer.orders.place", "buyer.orders.view"]);
  const [{ l }, p] = await Promise.all([subLabels(), myPreferences(ctx)]);
  const canEdit = ctx.permissions.has("buyer.orders.place");
  return (
    <>
      <PageHeader title={l.title} description={l.pageIntroBuyer} icon={Repeat} />
      {!p.settings.enabled && <p className="mb-4 rounded-md bg-muted p-3 text-sm" data-testid="sub-off">{l.off}</p>}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>{l.rulesTitle}</CardTitle><CardDescription>{fill(l.timeoutHint, { minutes: p.settings.responseMinutes })}</CardDescription></CardHeader>
          <CardContent>{canEdit ? <PreferencesForm l={l} rule={p.rule} allowAuto={p.settings.allowAuto} /> : <p className="text-sm">{l[`mode.${p.rule.mode}`]}</p>}</CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>{l.productsTitle}</CardTitle><CardDescription>{l.productsHint}</CardDescription></CardHeader>
          <CardContent>{canEdit ? <ProductRules l={l} rows={p.products} /> : <ul className="text-sm">{p.products.map((r) => <li key={r.id}>{r.name} · {l[`mode.${r.mode}`]}</li>)}</ul>}</CardContent>
        </Card>
      </div>
      <RecentSubstitutions ctx={ctx} portal="buy" />
    </>
  );
}
