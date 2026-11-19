import Link from "next/link";
import { ClipboardCheck } from "lucide-react";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { reviewQueue } from "@/server/food/service";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export const metadata = { title: "Food Info Review" };
export const dynamic = "force-dynamic";

const list = (xs: string[]) => xs.map((x) => x.toLowerCase().replace(/_/g, " ")).join(", ");

/** Phase 44: food information waiting for FIRINGI — oldest first; new allergens flagged. */
export default async function FoodReviewQueuePage() {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.catalogue.view", "admin.catalogue.approve"]);
  const rows = await reviewQueue(ctx);
  const day = (d: Date | null) => (d ? new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" }).format(d) : "—");
  return (
    <>
      <PageHeader title="Food Info Review" icon={ClipboardCheck} description="Food information suppliers sent: check it against the label before customers see it. A new allergen on a product already sold may need a recall." />
      <Card>
        <CardContent className="pt-2">
          {!rows.length ? <p className="py-6 text-center text-sm text-muted-foreground">Nothing waiting.</p> : (
            <ul className="divide-y" data-testid="food-queue">
              {rows.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center gap-2 py-3 text-sm" data-testid="food-queue-row" data-product={r.productId}>
                  <Link href={`/admin/catalogue/food-review/${r.id}`} className="min-w-0 flex-1 basis-56 break-words font-medium text-primary hover:underline">{r.product} <span className="text-xs font-normal text-muted-foreground">· v{r.version} · {r.supplier}</span></Link>
                  {r.isNew ? <Badge variant="outline">First version</Badge> : r.diff ? <Badge variant="secondary">Changed</Badge> : <Badge variant="outline">No change</Badge>}
                  {r.allergenAdded && <Badge variant="destructive" data-testid="food-queue-allergen">New allergen: {list([...(r.diff?.allergensAdded ?? []), ...(r.diff?.mayContainAdded ?? [])])}</Badge>}
                  {r.source !== "MANUAL" && <Badge variant="outline">{r.source === "AI" ? "AI draft" : "Imported"}</Badge>}
                  <span className="text-xs text-muted-foreground">{day(r.submittedAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </>
  );
}
