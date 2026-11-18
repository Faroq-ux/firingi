import { Snowflake } from "lucide-react";
import { can, pagePermission, pagePortal } from "@/server/rbac/guard";
import { categoryClasses, listClasses } from "@/server/coldchain/service";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CategoryClassSelect, ClassForm } from "@/components/coldchain/client";

export const metadata = { title: "Temperature Classes" };
export const dynamic = "force-dynamic";

export default async function TemperatureClassesPage() {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.catalogue.view", "admin.catalogue.manage"]);
  const [classes, cats] = await Promise.all([listClasses("en", true), categoryClasses(ctx, "en")]);
  const edit = can(ctx, "admin.catalogue.manage");
  const opts = classes.filter((c) => c.active).map((c) => ({ id: c.id, name: c.name }));
  return (
    <>
      <PageHeader title="Temperature Classes" icon={Snowflake} description="The temperature ranges products are kept at. Readings within the tolerance are a warning; beyond it, out of range. Each category gets a default class (subcategories inherit it); suppliers can choose another class per product." />
      <Card className="mb-6">
        <CardHeader><CardTitle>Classes</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <ul className="divide-y" data-testid="tc-list">
            {classes.map((c) => (
              <li key={c.id} className="space-y-2 py-3" data-testid="tc-row" data-code={c.code}>
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="font-mono text-xs">{c.code}</span><span className="font-medium">{c.name}</span>
                  <span className="text-muted-foreground">{c.range || "no limits"}{c.toleranceC ? ` · tolerance ${c.toleranceC} °C` : ""}</span>
                  {!c.coldChain && <Badge variant="outline">no temperatures recorded</Badge>}{!c.active && <Badge variant="outline">inactive</Badge>}
                </div>
                {edit && <details><summary className="cursor-pointer text-xs text-primary">Edit</summary><div className="pt-2"><ClassForm c={c} /></div></details>}
              </li>
            ))}
          </ul>
          {edit && <div className="rounded-lg border border-dashed p-3"><p className="mb-2 text-sm font-medium">New class</p><ClassForm /></div>}
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Category defaults</CardTitle><CardDescription>Products get the class of their category unless the supplier chooses another.</CardDescription></CardHeader>
        <CardContent>
          <ul className="divide-y" data-testid="tc-categories">
            {cats.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center gap-2 py-1.5 text-sm" style={{ paddingLeft: `${c.depth * 1.25}rem` }}>
                <span className="min-w-0 flex-1 basis-40 break-words">{c.name}</span>
                {edit ? <CategoryClassSelect categoryId={c.id} value={c.tempClassId} inherited={c.inherited} classes={opts} /> : <span className="text-muted-foreground">{classes.find((x) => x.id === (c.tempClassId ?? c.inherited))?.name ?? "—"}</span>}
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </>
  );
}
