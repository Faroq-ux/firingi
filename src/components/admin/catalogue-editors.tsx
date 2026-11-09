"use client";
/** Admin catalogue editors (category tree, brands, product with variants/packaging/images, approvals). */
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ArrowDown, ArrowUp, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input, Label, Select } from "@/components/ui/input";
import {
  moveCategoryAction, reviewOfferAction, reviewProductAction, saveBrandAction, saveCategoryAction, savePackagingAction, saveProductAction,
  saveVariantAction, uploadProductImageAction,
} from "@/server/actions/catalogue";

function useRun() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const run = (fn: () => Promise<{ ok: boolean; error?: string; data?: unknown }>, after?: (d: unknown) => void) =>
    start(async () => { setError(null); const r = await fn(); if (r.ok) { after?.(r.data); router.refresh(); } else setError(r.error ?? "Error"); });
  return { pending, error, run };
}
type Opt = { id: string; label: string };
type L10n = { en: string; pt?: string; es?: string };

// ── Categories ──
export type CatRow = { id: string; parentId: string | null; depth: number; name: L10n; restriction: string | null; ownRestriction: string | null; isActive: boolean; products: number; children: number; taxCode: string | null; defaultTaxCategoryId: string | null };

function CategoryForm({ initial, parentId, taxes, parents, onDone }: { initial?: CatRow; parentId?: string | null; taxes: Opt[]; parents: Opt[]; onDone: () => void }) {
  const { pending, error, run } = useRun();
  return (
    <form
      className="grid gap-2 rounded-lg border bg-muted/30 p-3 sm:grid-cols-3 lg:grid-cols-6"
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        const s = (k: string) => String(fd.get(k) ?? "").trim();
        run(() => saveCategoryAction({
          id: initial?.id, name: { en: s("en"), pt: s("pt") || null, es: s("es") || null }, parentId: s("parentId") || null,
          restriction: (s("restriction") || null) as "TOBACCO" | null, defaultTaxCategoryId: s("tax") || null, isActive: fd.get("isActive") === "on",
        }), onDone);
      }}
    >
      <Input name="en" placeholder="Name (EN)" defaultValue={initial?.name.en} required />
      <Input name="pt" placeholder="Nome (PT)" defaultValue={initial?.name.pt} />
      <Input name="es" placeholder="Nombre (ES)" defaultValue={initial?.name.es} />
      <Select name="parentId" defaultValue={initial ? initial.parentId ?? "" : parentId ?? ""}>
        <option value="">— top level —</option>
        {parents.filter((p) => p.id !== initial?.id).map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
      </Select>
      <Select name="restriction" defaultValue={initial?.ownRestriction ?? ""}>
        <option value="">Restriction: inherit / none</option><option value="TOBACCO">Tobacco</option><option value="ALCOHOL">Alcohol</option>
      </Select>
      <Select name="tax" defaultValue={initial?.defaultTaxCategoryId ?? ""}>
        <option value="">Default VAT: —</option>{taxes.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
      </Select>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="isActive" defaultChecked={initial?.isActive ?? true} /> Active</label>
      <div className="flex gap-2 sm:col-span-2"><Button size="sm" type="submit" disabled={pending}>Save</Button><Button size="sm" type="button" variant="ghost" onClick={onDone}>Cancel</Button></div>
      {error && <p className="text-sm text-destructive sm:col-span-6">{error}</p>}
    </form>
  );
}

export function CategoryTree({ rows, taxes, canEdit }: { rows: CatRow[]; taxes: Opt[]; canEdit: boolean }) {
  const { pending, run } = useRun();
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState<string | "root" | null>(null);
  const parents = rows.map((r) => ({ id: r.id, label: `${"— ".repeat(r.depth)}${r.name.en}` }));
  return (
    <div className="space-y-2">
      {canEdit && (adding === "root" ? <CategoryForm taxes={taxes} parents={parents} parentId={null} onDone={() => setAdding(null)} /> : <Button onClick={() => setAdding("root")}><Plus /> New top-level category</Button>)}
      <ul className="divide-y rounded-xl border bg-card">
        {rows.map((r) => (
          <li key={r.id} className="p-2">
            <div className="flex flex-wrap items-center gap-2" style={{ paddingLeft: r.depth * 22 }}>
              <span className={`font-medium ${r.isActive ? "" : "text-muted-foreground line-through"}`}>{r.name.en}</span>
              {r.name.pt && <span className="text-xs text-muted-foreground">{r.name.pt}</span>}
              {r.restriction && <Badge variant="warning">{r.restriction}{r.ownRestriction ? "" : " (inherited)"}</Badge>}
              {r.taxCode && <Badge variant="secondary">VAT {r.taxCode}</Badge>}
              <span className="text-xs text-muted-foreground">{r.products} products</span>
              {canEdit && (
                <span className="ml-auto flex gap-1">
                  <Button size="icon" variant="ghost" className="size-7" aria-label="Move up" disabled={pending} onClick={() => run(() => moveCategoryAction({ id: r.id, direction: "up" }))}><ArrowUp /></Button>
                  <Button size="icon" variant="ghost" className="size-7" aria-label="Move down" disabled={pending} onClick={() => run(() => moveCategoryAction({ id: r.id, direction: "down" }))}><ArrowDown /></Button>
                  <Button size="sm" variant="ghost" onClick={() => { setAdding(r.id); setEditing(null); }}>+ Sub-category</Button>
                  <Button size="sm" variant="outline" onClick={() => { setEditing(r.id); setAdding(null); }}>Edit</Button>
                </span>
              )}
            </div>
            {editing === r.id && <div className="mt-2"><CategoryForm initial={r} taxes={taxes} parents={parents} onDone={() => setEditing(null)} /></div>}
            {adding === r.id && <div className="mt-2"><CategoryForm parentId={r.id} taxes={taxes} parents={parents} onDone={() => setAdding(null)} /></div>}
          </li>
        ))}
      </ul>
    </div>
  );
}

// ── Brands ──
export function BrandRow({ id, name, isActive }: { id?: string; name?: string; isActive?: boolean }) {
  const { pending, error, run } = useRun();
  const [value, setValue] = useState(name ?? "");
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Input className="h-8 w-56" value={value} onChange={(e) => setValue(e.target.value)} placeholder="New brand" />
      {id && <label className="flex items-center gap-1 text-xs"><input type="checkbox" defaultChecked={isActive} onChange={(e) => run(() => saveBrandAction({ id, name: value, isActive: e.target.checked }))} /> active</label>}
      {(value !== (name ?? "") && value.trim()) && <Button size="sm" disabled={pending} onClick={() => run(() => saveBrandAction({ id, name: value }), () => !id && setValue(""))}>{id ? "Rename" : "Add"}</Button>}
      {error && <span className="text-xs text-destructive">{error}</span>}
    </div>
  );
}

// ── Product ──
export type ProductData = {
  id?: string; name: L10n; description: L10n | null; categoryId: string; brandId: string | null; taxCategoryId: string; restriction: string | null;
  hsCode: string | null; originCountryCode: string | null;
};

export function ProductForm({ data, categories, brands, taxes }: { data: ProductData; categories: Opt[]; brands: Opt[]; taxes: Opt[] }) {
  const router = useRouter();
  const { pending, error, run } = useRun();
  const [saved, setSaved] = useState(false);
  return (
    <form
      className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        const s = (k: string) => String(fd.get(k) ?? "").trim();
        setSaved(false);
        run(() => saveProductAction({
          id: data.id, name: { en: s("nameEn"), pt: s("namePt") || null, es: s("nameEs") || null },
          description: s("descEn") ? { en: s("descEn"), pt: s("descPt") || null } : null, categoryId: s("categoryId"), brandId: s("brandId") || null,
          taxCategoryId: s("taxCategoryId"), restriction: (s("restriction") || null) as "TOBACCO" | null, hsCode: s("hsCode") || null, originCountryCode: s("origin") || null,
        }), (d) => { setSaved(true); if (!data.id) router.push(`/admin/catalogue/products/${(d as { id: string }).id}`); });
      }}
    >
      <div className="space-y-1"><Label htmlFor="nameEn">Name (EN)</Label><Input id="nameEn" name="nameEn" defaultValue={data.name.en} required /></div>
      <div className="space-y-1"><Label htmlFor="namePt">Nome (PT)</Label><Input id="namePt" name="namePt" defaultValue={data.name.pt} /></div>
      <div className="space-y-1"><Label htmlFor="nameEs">Nombre (ES)</Label><Input id="nameEs" name="nameEs" defaultValue={data.name.es} /></div>
      <div className="space-y-1"><Label htmlFor="categoryId">Category</Label>
        <Select id="categoryId" name="categoryId" defaultValue={data.categoryId} required><option value="" disabled>—</option>{categories.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</Select></div>
      <div className="space-y-1"><Label htmlFor="brandId">Brand</Label>
        <Select id="brandId" name="brandId" defaultValue={data.brandId ?? ""}><option value="">—</option>{brands.map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}</Select></div>
      <div className="space-y-1"><Label htmlFor="taxCategoryId">VAT category</Label>
        <Select id="taxCategoryId" name="taxCategoryId" defaultValue={data.taxCategoryId} required>{taxes.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}</Select></div>
      <div className="space-y-1"><Label htmlFor="restriction">Extra restriction (adds to category)</Label>
        <Select id="restriction" name="restriction" defaultValue={data.restriction ?? ""}><option value="">— inherit from category —</option><option value="TOBACCO">Tobacco</option><option value="ALCOHOL">Alcohol</option></Select></div>
      <div className="space-y-1"><Label htmlFor="hsCode">HS / CN code (Intrastat)</Label><Input id="hsCode" name="hsCode" defaultValue={data.hsCode ?? ""} /></div>
      <div className="space-y-1"><Label htmlFor="origin">Country of origin</Label><Input id="origin" name="origin" maxLength={2} defaultValue={data.originCountryCode ?? ""} placeholder="PT" /></div>
      <div className="space-y-1 sm:col-span-2 lg:col-span-3"><Label htmlFor="descEn">Description (EN)</Label><textarea id="descEn" name="descEn" className="min-h-20 w-full rounded-md border bg-card p-2 text-sm" defaultValue={data.description?.en ?? ""} /></div>
      <div className="space-y-1 sm:col-span-2 lg:col-span-3"><Label htmlFor="descPt">Descrição (PT)</Label><textarea id="descPt" name="descPt" className="min-h-20 w-full rounded-md border bg-card p-2 text-sm" defaultValue={data.description?.pt ?? ""} /></div>
      <div className="flex items-center gap-3 sm:col-span-2 lg:col-span-3">
        <Button type="submit" disabled={pending}>{data.id ? "Save product" : "Create product"}</Button>
        {saved && <span className="text-sm text-success">Saved.</span>}
        {error && <span className="text-sm text-destructive">{error}</span>}
      </div>
    </form>
  );
}

export function AddVariantForm({ productId }: { productId: string }) {
  const { pending, error, run } = useRun();
  return (
    <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => {
      e.preventDefault();
      const fd = new FormData(e.currentTarget); const f = e.currentTarget;
      const attrs = Object.fromEntries(String(fd.get("attributes") ?? "").split(";").map((p) => p.split("=").map((x) => x.trim())).filter((p) => p.length === 2 && p[0]));
      run(() => saveVariantAction({ productId, sku: String(fd.get("sku") || "") || null, gtin: String(fd.get("gtin") || "") || null, attributes: Object.keys(attrs).length ? attrs : null }), () => f.reset());
    }}>
      <div className="space-y-1"><Label className="text-xs">SKU (auto if empty)</Label><Input name="sku" className="h-8 w-40" /></div>
      <div className="space-y-1"><Label className="text-xs">EAN / GTIN</Label><Input name="gtin" className="h-8 w-40" /></div>
      <div className="space-y-1"><Label className="text-xs">Attributes (size=330ml; flavour=lemon)</Label><Input name="attributes" className="h-8 w-72" /></div>
      <Button size="sm" disabled={pending}>Add variant</Button>
      {error && <span className="text-xs text-destructive">{error}</span>}
    </form>
  );
}

export function VariantActiveToggle({ id, productId, isActive }: { id: string; productId: string; isActive: boolean }) {
  const { pending, run } = useRun();
  return <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => saveVariantAction({ id, productId, isActive: !isActive }))}>{isActive ? "Deactivate" : "Activate"}</Button>;
}

export function AddPackagingForm({ variantId, units }: { variantId: string; units: Opt[] }) {
  const { pending, error, run } = useRun();
  return (
    <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => {
      e.preventDefault();
      const fd = new FormData(e.currentTarget); const f = e.currentTarget;
      run(() => savePackagingAction({
        variantId, uomCode: String(fd.get("uom")), name: { en: String(fd.get("nameEn")), pt: String(fd.get("namePt") || "") || null },
        unitsPerPack: Number(fd.get("units")), gtin: String(fd.get("gtin") || "") || null, netWeightKg: fd.get("kg") ? Number(fd.get("kg")) : null,
      }), () => f.reset());
    }}>
      <Select name="uom" className="h-8 w-28">{units.map((u) => <option key={u.id} value={u.id}>{u.label}</option>)}</Select>
      <Input name="nameEn" placeholder="Name (EN) e.g. Case 24" className="h-8 w-44" required />
      <Input name="namePt" placeholder="Nome (PT)" className="h-8 w-40" />
      <Input name="units" type="number" min={1} defaultValue={1} className="h-8 w-20" aria-label="Units per pack" />
      <Input name="gtin" placeholder="GTIN" className="h-8 w-36" />
      <Input name="kg" type="number" step="0.001" min={0} placeholder="Net kg" className="h-8 w-24" />
      <Button size="sm" disabled={pending}>Add packaging</Button>
      {error && <span className="text-xs text-destructive">{error}</span>}
    </form>
  );
}

export function PackagingActiveToggle({ id, variantId, uomCode, name, unitsPerPack, isActive }: { id: string; variantId: string; uomCode: string; name: L10n; unitsPerPack: number; isActive: boolean }) {
  const { pending, run } = useRun();
  return <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => savePackagingAction({ id, variantId, uomCode, name, unitsPerPack, isActive: !isActive }))}>{isActive ? "Deactivate" : "Activate"}</Button>;
}

export function ImageUpload({ productId }: { productId: string }) {
  const { pending, error, run } = useRun();
  return (
    <form className="flex items-center gap-2" onSubmit={(e) => { e.preventDefault(); const fd = new FormData(e.currentTarget); fd.set("productId", productId); const f = e.currentTarget; run(() => uploadProductImageAction(fd), () => f.reset()); }}>
      <Input name="file" type="file" accept="image/jpeg,image/png,image/webp" required className="h-9 w-72" />
      <Button size="sm" disabled={pending}>Upload image</Button>
      {error && <span className="text-xs text-destructive">{error}</span>}
    </form>
  );
}

export function ProductDecision({ productId }: { productId: string }) {
  const { pending, error, run } = useRun();
  const [note, setNote] = useState("");
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Input className="h-8 w-64" placeholder="Reason (required to reject)" value={note} onChange={(e) => setNote(e.target.value)} />
      <Button size="sm" disabled={pending} onClick={() => run(() => reviewProductAction({ productId, decision: "APPROVED" }))}>Approve</Button>
      <Button size="sm" variant="destructive" disabled={pending || !note.trim()} onClick={() => run(() => reviewProductAction({ productId, decision: "REJECTED", note }))}>Reject</Button>
      {error && <span className="w-full text-xs text-destructive">{error}</span>}
    </div>
  );
}

export function OfferDecision({ offerId, status }: { offerId: string; status: string }) {
  const { pending, error, run } = useRun();
  const [note, setNote] = useState("");
  return (
    <div className="flex flex-wrap items-center justify-end gap-1.5">
      <Input className="h-8 w-48" placeholder="Reason" value={note} onChange={(e) => setNote(e.target.value)} />
      {status !== "ACTIVE" && <Button size="sm" disabled={pending} onClick={() => run(() => reviewOfferAction({ offerId, to: "ACTIVE" }))}>Activate</Button>}
      {status === "PENDING_APPROVAL" && <Button size="sm" variant="destructive" disabled={pending || !note.trim()} onClick={() => run(() => reviewOfferAction({ offerId, to: "REJECTED", note }))}>Reject</Button>}
      {status === "ACTIVE" && <Button size="sm" variant="destructive" disabled={pending || !note.trim()} onClick={() => run(() => reviewOfferAction({ offerId, to: "PAUSED", note }))}>Suspend</Button>}
      {error && <span className="w-full text-right text-xs text-destructive">{error}</span>}
    </div>
  );
}
