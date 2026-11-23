import Link from "next/link";
import { ListChecks } from "lucide-react";
import { pagePermission, pagePortal, can } from "@/server/rbac/guard";
import { targetOptions, vendorAssortments } from "@/server/assortments/service";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { NewListForm, PreviewBox } from "@/components/assortments/client";
import { asLabels } from "@/components/assortments/labels";

export const metadata = { title: "Customer assortments" };
export const dynamic = "force-dynamic";

const TONE = { ONLY_LISTED: "success", HIDE_LISTED: "destructive", MUST_STOCK: "warning" } as const;

export default async function AssortmentsPage() {
  const ctx = await pagePortal("vendor");
  pagePermission(ctx, ["vendor.pricing.manage", "vendor.products.view"]);
  const manage = can(ctx, "vendor.pricing.manage");
  const [{ l }, o, t] = await Promise.all([asLabels(), vendorAssortments(ctx), targetOptions(ctx)]);
  return (
    <>
      <PageHeader title={l.title} description={l.intro} icon={ListChecks} />
      {!o.on && <p className="mb-4 rounded-md bg-muted p-3 text-sm" data-testid="as-off">{l.off}</p>}
      <div className="mb-6 grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        {o.on && manage ? (
          <Card>
            <CardHeader><CardTitle>{l.newList}</CardTitle></CardHeader>
            <CardContent><NewListForm l={l} groups={t.groups} modes={o.modes} /></CardContent>
          </Card>
        ) : <div />}
        <Card>
          <CardHeader><CardTitle>{l.rulesTitle}</CardTitle></CardHeader>
          <CardContent>
            <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">{[l.rule1, l.rule2, l.rule3, l.rule4, l.inactiveNote].map((r) => <li key={r}>{r}</li>)}</ul>
          </CardContent>
        </Card>
      </div>
      <Card className="mb-6">
        <CardHeader><CardTitle>{l.lists}</CardTitle></CardHeader>
        <CardContent>
          {!o.lists.length ? <p className="text-sm text-muted-foreground" data-testid="as-none">{l.noLists}</p> : (
            <ul className="divide-y" data-testid="as-lists">
              {o.lists.map((x) => (
                <li key={x.id} className="flex flex-wrap items-center gap-2 py-3 text-sm" data-testid="as-list" data-name={x.name}>
                  <Link href={`/vendor/products/assortments/${x.id}`} className="min-w-0 flex-1 basis-48 font-medium break-words underline-offset-2 hover:underline" data-testid="as-open">{x.name}</Link>
                  <Badge variant={TONE[x.mode]} data-testid="as-list-mode" data-mode={x.mode}>{l[`mode.${x.mode}`]}</Badge>
                  {!x.active && <Badge variant="secondary">{l.inactive}</Badge>}
                  {!x.modeAllowed && <Badge variant="secondary">{l.modeOff}</Badge>}
                  <span className="text-muted-foreground">{l.for}: {x.targetName ?? l[`target.${x.target}`]}{x.customers != null && x.target === "GROUP" ? ` (${x.customers})` : ""}</span>
                  <span className="tabular-nums">{x.items} {l.products.toLowerCase()}</span>
                  {x.mustStock > 0 && <span className="tabular-nums text-muted-foreground">· {x.mustStock} {l.mustStock.toLowerCase()}</span>}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>{l.previewTitle}</CardTitle><CardDescription>{l.previewHint}</CardDescription></CardHeader>
        <CardContent><PreviewBox l={l} /></CardContent>
      </Card>
    </>
  );
}
