import Link from "next/link";
import { notFound } from "next/navigation";
import { Apple, ArrowLeft } from "lucide-react";
import { can, pagePermission, pagePortal } from "@/server/rbac/guard";
import { foodEditor } from "@/server/food/service";
import { aiLabelStatus } from "@/server/food/label-ai";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { FoodCertificates, FoodEditor, FoodFileUpload } from "@/components/food/client";
import { foodLabels, fill } from "@/components/food/labels";

export const metadata = { title: "Food Information" };
export const dynamic = "force-dynamic";

/** Phase 44: fill in / send a product's food information. */
export default async function VendorFoodEditPage({ params }: { params: Promise<{ productId: string }> }) {
  const ctx = await pagePortal("vendor");
  pagePermission(ctx, ["vendor.products.manage", "vendor.products.view"]);
  const { productId } = await params;
  const { l, locale } = await foodLabels();
  const e = await foodEditor(ctx, productId, locale).catch(() => null);
  if (!e) notFound();
  const ai = await aiLabelStatus();
  const edit = can(ctx, "vendor.products.manage") && e.editable && e.settings.enabled;
  const pending = e.working?.status === "PENDING";
  const fields = (fs: string[]) => fs.map((x) => l[`field.${x}`] ?? x).join(", ");
  return (
    <>
      <Link href="/vendor/products/food" className="mb-3 inline-flex items-center gap-1 text-sm text-primary hover:underline"><ArrowLeft className="size-4" /> {l.back}</Link>
      <PageHeader title={e.product.name} icon={Apple} description={e.food ? (e.required.length ? fill(l.requiredFor, { fields: fields(e.required) }) : "") : l.notFood} />
      <div className="mb-4 flex flex-wrap items-center gap-2 text-sm">
        {e.current && <Badge variant="success" data-testid="food-current">{fill(l.approvedVersion, { v: e.current.version })}</Badge>}
        {e.working && <Badge variant={e.working.status === "REJECTED" ? "destructive" : e.working.status === "PENDING" ? "warning" : "outline"} data-testid="food-working" data-status={e.working.status}>{fill(l.yourVersion, { v: e.working.version })} · {l[`status.${e.working.status}`]}</Badge>}
        {e.working?.source && e.working.source !== "MANUAL" && <Badge variant="outline">{e.working.source === "AI" ? l.readAi : l.importLink}</Badge>}
      </div>
      {e.working?.reviewNote && e.working.status !== "APPROVED" && <p className="mb-3 rounded-lg border border-destructive/40 bg-destructive/10 p-2 text-sm" data-testid="food-review-note">{fill(l.firingiNote, { note: e.working.reviewNote })}</p>}
      {e.working?.aiNote && <p className="mb-3 rounded-lg border p-2 text-sm text-muted-foreground" data-testid="food-ai-remark">{fill(l.aiNote, { note: e.working.aiNote })}</p>}
      <Card className="mb-6">
        <CardHeader><CardTitle>{l.labelPhoto}</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <FoodFileUpload l={l} productId={productId} kind="LABEL" current={e.files.label} href={e.files.labelId ? `/api/food/files/${e.files.labelId}?kind=label` : null} disabled={!edit || pending} />
          <FoodFileUpload l={l} productId={productId} kind="SPEC" current={e.files.spec} href={e.files.specId ? `/api/food/files/${e.files.specId}?kind=spec` : null} disabled={!edit || pending} />
        </CardContent>
      </Card>
      <Card className="mb-6">
        <CardHeader><CardTitle>{l.panelTitle}</CardTitle></CardHeader>
        <CardContent>
          <FoodEditor key={`${e.working?.id ?? e.current?.id ?? "new"}-${e.working?.updatedAt.getTime() ?? 0}`} l={l} productId={productId} data={e.data} required={e.required} parts={e.settings.parts} editable={edit} pending={pending} aiOn={ai.on && ai.configured} />
        </CardContent>
      </Card>
      {e.settings.parts.diets && (
        <Card>
          <CardHeader><CardTitle>{l.certificates}</CardTitle></CardHeader>
          <CardContent><FoodCertificates l={l} productId={productId} rows={e.certificates} disabled={!edit || pending} /></CardContent>
        </Card>
      )}
    </>
  );
}
