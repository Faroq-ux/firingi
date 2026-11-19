import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ClipboardCheck } from "lucide-react";
import { can, pagePermission, pagePortal } from "@/server/rbac/guard";
import { reviewDetail } from "@/server/food/service";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AllergenRecallForm, FoodReviewActions } from "@/components/food/client";
import { ALLERGENS, ingredientSegments, NUTRIENTS, type FoodData } from "@/lib/food";

export const metadata = { title: "Food Info Review" };
export const dynamic = "force-dynamic";
const word = (x: string) => x.toLowerCase().replace(/_/g, " ");

function Side({ title, d, other }: { title: string; d: FoodData | null; other: FoodData | null }) {
  if (!d) return <div className="min-w-0 flex-1 basis-72"><p className="mb-1 font-medium">{title}</p><p className="text-sm text-muted-foreground">None yet.</p></div>;
  const diff = (a: unknown, b: unknown) => (other ? JSON.stringify(a ?? null) !== JSON.stringify(b ?? null) : false);
  const hi = "rounded bg-amber-500/15 px-1";
  return (
    <div className="min-w-0 flex-1 basis-72 space-y-3 text-sm">
      <p className="font-medium">{title}</p>
      <ul className="grid grid-cols-2 gap-1">{ALLERGENS.map((a) => <li key={a} className={`flex justify-between gap-2 rounded border px-2 py-0.5 text-xs ${diff(d.allergens[a], other?.allergens[a]) ? "border-amber-500 bg-amber-500/10" : ""} ${d.allergens[a] === "CONTAINS" ? "text-destructive" : ""}`}><span>{word(a)}</span><b>{d.allergens[a] ? word(d.allergens[a]!) : "—"}</b></li>)}</ul>
      {Object.entries(d.ingredients).map(([lg, t]) => <p key={lg} className={`break-words ${diff(d.ingredients, other?.ingredients) ? hi : ""}`}><span className="text-xs uppercase text-muted-foreground">{lg} · </span>{ingredientSegments(t).map((s, i) => (s.b ? <b key={i}>{s.t}</b> : <span key={i}>{s.t}</span>))}</p>)}
      {d.nutrition && <p className={`text-xs ${diff(d.nutrition, other?.nutrition) ? hi : ""}`}>per {d.nutrition.basis}: {NUTRIENTS.filter((n) => d.nutrition![n] != null).map((n) => `${n} ${d.nutrition![n]}`).join(" · ")}</p>}
      <p className="text-xs">{[d.diets.length ? `Claims: ${d.diets.map(word).join(", ")}` : null, d.originCountryCode ? `Origin ${d.originCountryCode}` : null, Object.values(d.storage)[0] ? `Storage: ${Object.values(d.storage)[0]}` : null, d.shelfLifeDays ? `${d.shelfLifeDays} days` : null].filter(Boolean).join(" · ")}</p>
    </div>
  );
}

/** Phase 44: one version side by side with the current one; approve / send back; allergen recall. */
export default async function FoodReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.catalogue.view", "admin.catalogue.approve"]);
  const { id } = await params;
  const r = await reviewDetail(ctx, id).catch(() => null);
  if (!r) notFound();
  const canReview = can(ctx, "admin.catalogue.approve") && r.status === "PENDING";
  const added = r.diff ? [...r.diff.allergensAdded, ...r.diff.mayContainAdded] : [];
  return (
    <>
      <Link href="/admin/catalogue/food-review" className="mb-3 inline-flex items-center gap-1 text-sm text-primary hover:underline"><ArrowLeft className="size-4" /> Review queue</Link>
      <PageHeader title={r.product.name} icon={ClipboardCheck} description={`Version ${r.version} from ${r.supplier || "FIRINGI"} · ${r.source === "AI" ? "read by AI" : r.source === "IMPORT" ? "imported" : "typed in"}`} />
      <div className="mb-4 flex flex-wrap gap-2 text-sm">
        <Badge variant={r.status === "PENDING" ? "warning" : r.status === "APPROVED" ? "success" : "outline"} data-testid="food-review-status">{r.status.toLowerCase()}</Badge>
        {r.missing.length > 0 && <Badge variant="destructive">Missing: {r.missing.map(word).join(", ")}</Badge>}
        {r.problems.map((p, i) => <Badge key={i} variant={p.n === "warn" ? "warning" : "destructive"}>{p.text}</Badge>)}
        {added.length > 0 && <Badge variant="destructive" data-testid="food-review-allergen-added">New allergen: {added.map(word).join(", ")}</Badge>}
      </div>
      {r.aiNote && <p className="mb-3 rounded-lg border p-2 text-sm">AI remarks: {r.aiNote}</p>}
      <Card className="mb-6">
        <CardHeader><CardTitle>Label & files</CardTitle></CardHeader>
        <CardContent className="flex flex-wrap items-start gap-4 text-sm">
          {r.files.label && (r.files.labelMime?.startsWith("image/")
            // eslint-disable-next-line @next/next/no-img-element
            ? <a href={`/api/food/files/${r.files.label}?kind=label`} target="_blank" rel="noreferrer"><img src={`/api/food/files/${r.files.label}?kind=label`} alt="Label" className="max-h-72 max-w-full rounded-lg border object-contain" data-testid="food-review-label" /></a>
            : <a href={`/api/food/files/${r.files.label}?kind=label`} target="_blank" rel="noreferrer" className="text-primary hover:underline">{r.files.labelName}</a>)}
          {r.files.spec && <a href={`/api/food/files/${r.files.spec}?kind=spec`} target="_blank" rel="noreferrer" className="text-primary hover:underline">{r.files.specName}</a>}
          {!r.files.label && !r.files.spec && <p className="text-muted-foreground">No label photo or spec sheet.</p>}
          {r.certificates.length > 0 && <ul className="w-full text-xs">{r.certificates.map((c) => <li key={c.id}>{word(c.diet)} · {c.number ?? "—"} · {c.issuer ?? ""} {c.expiresOn ? `· until ${c.expiresOn.toISOString().slice(0, 10)}` : ""}{c.file ? <> · <a className="text-primary hover:underline" href={`/api/food/files/${r.id}?kind=cert&cert=${c.id}`} target="_blank" rel="noreferrer">{c.file}</a></> : null}</li>)}</ul>}
        </CardContent>
      </Card>
      <Card className="mb-6">
        <CardHeader><CardTitle>This version vs. what customers see now</CardTitle></CardHeader>
        <CardContent className="flex flex-wrap gap-6"><Side title={`Version ${r.version}`} d={r.data} other={r.previous} /><Side title="Current (approved)" d={r.previous} other={null} /></CardContent>
      </Card>
      {canReview && <Card className="mb-6"><CardHeader><CardTitle>Decision</CardTitle></CardHeader><CardContent><FoodReviewActions id={r.id} /></CardContent></Card>}
      {r.recallLink && can(ctx, "admin.recalls.manage") && (
        <Card><CardHeader><CardTitle>Undeclared allergen? Recall a lot</CardTitle></CardHeader><CardContent className="space-y-2"><p className="text-sm text-muted-foreground">Starts a class I recall (Inventory › Recalls): the lot is blocked and every buyer down the chain is told.</p><AllergenRecallForm offers={r.offers} /></CardContent></Card>
      )}
    </>
  );
}
