"use client";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";
import {
  createOfferAction, proposeProductAction, setBasePriceAction, setOfferActiveAction, setStockAction,
} from "@/server/actions/catalogue";

function useRun() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, after?: () => void) =>
    start(async () => { setError(null); const r = await fn(); if (r.ok) { after?.(); router.refresh(); } else setError(r.error ?? "Error"); });
  return { pending, error, run };
}

export function BasePriceCell({ offerId, price, canEdit }: { offerId: string; price: string | null; canEdit: boolean }) {
  const t = useTranslations("catalogue.vendor");
  const { pending, error, run } = useRun();
  const [value, setValue] = useState(price ?? "");
  if (!canEdit) return <span className="tabular-nums">{price ?? "—"}</span>;
  return (
    <div className="flex items-center gap-1">
      <Input aria-label={t("basePrice")} className="h-8 w-24 text-right" type="number" min="0.01" step="0.01" value={value} onChange={(e) => setValue(e.target.value)} />
      {value !== (price ?? "") && value && <Button size="sm" disabled={pending} onClick={() => run(() => setBasePriceAction({ offerId, price: Number(value) }))}>{t("save")}</Button>}
      {!price && !value && <span className="text-xs text-warning">{t("noPrice")}</span>}
      {error && <span className="text-xs text-destructive">{error}</span>}
    </div>
  );
}

export function OfferActiveToggle({ offerId, status }: { offerId: string; status: string }) {
  const t = useTranslations("catalogue.vendor");
  const { pending, error, run } = useRun();
  if (status !== "ACTIVE" && status !== "PAUSED") return null;
  return (
    <>
      <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => setOfferActiveAction({ offerId, active: status === "PAUSED" }))}>
        {status === "ACTIVE" ? t("pause") : t("resume")}
      </Button>
      {error && <div className="text-xs text-destructive">{error}</div>}
    </>
  );
}

export function SellThisForm({ packagingUnitId, canPrice }: { packagingUnitId: string; canPrice: boolean }) {
  const t = useTranslations("catalogue.vendor");
  const { pending, error, run } = useRun();
  const [open, setOpen] = useState(false);
  if (!open) return <Button size="sm" onClick={() => setOpen(true)}>{t("offer")}</Button>;
  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        run(() => createOfferAction({
          packagingUnitId, vendorSku: String(fd.get("vendorSku") || "") || null, minOrderQty: Number(fd.get("minOrderQty")), qtyStep: Number(fd.get("qtyStep")),
          leadTimeDays: Number(fd.get("leadTimeDays")), basePrice: fd.get("basePrice") ? Number(fd.get("basePrice")) : undefined,
        }), () => setOpen(false));
      }}
    >
      <div className="space-y-1"><Label className="text-xs">{t("vendorSku")}</Label><Input name="vendorSku" className="h-8 w-28" /></div>
      <div className="space-y-1"><Label className="text-xs">{t("minOrderQty")}</Label><Input name="minOrderQty" type="number" min={1} defaultValue={1} className="h-8 w-20" /></div>
      <div className="space-y-1"><Label className="text-xs">{t("qtyStep")}</Label><Input name="qtyStep" type="number" min={1} defaultValue={1} className="h-8 w-20" /></div>
      <div className="space-y-1"><Label className="text-xs">{t("leadTimeDays")}</Label><Input name="leadTimeDays" type="number" min={0} defaultValue={1} className="h-8 w-20" /></div>
      {canPrice && <div className="space-y-1"><Label className="text-xs">{t("basePrice")}</Label><Input name="basePrice" type="number" min="0.01" step="0.01" required className="h-8 w-24" /></div>}
      <Button size="sm" type="submit" disabled={pending}>{t("save")}</Button>
      <Button size="sm" type="button" variant="ghost" onClick={() => setOpen(false)}>{t("cancel")}</Button>
      {error && <p className="w-full text-xs text-destructive">{error}</p>}
    </form>
  );
}

type Opt = { id: string; label: string };
export function ProposeProductForm({ categories, brands, taxCategories, units, canPrice }: { categories: Opt[]; brands: Opt[]; taxCategories: Opt[]; units: Opt[]; canPrice: boolean }) {
  const t = useTranslations("catalogue.vendor");
  const { pending, error, run } = useRun();
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState(false);
  if (!open) return (
    <div className="space-y-1">
      <Button variant="outline" onClick={() => { setOpen(true); setDone(false); }}>{t("proposeNew")}</Button>
      {done && <p className="text-sm text-success">{t("proposalNote")}</p>}
    </div>
  );
  const s = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
  return (
    <form
      className="space-y-4 rounded-xl border bg-card p-4"
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        run(() => proposeProductAction({
          name: { en: s(fd, "nameEn"), pt: s(fd, "namePt") || null }, categoryId: s(fd, "categoryId"), brandId: s(fd, "brandId") || null,
          taxCategoryId: s(fd, "taxCategoryId"), restriction: (s(fd, "restriction") || null) as "TOBACCO" | null, gtin: s(fd, "gtin") || null,
          packaging: { uomCode: s(fd, "uomCode"), name: { en: s(fd, "packName"), pt: s(fd, "packName") }, unitsPerPack: Number(fd.get("unitsPerPack")), gtin: null },
          offer: { vendorSku: s(fd, "vendorSku") || null, minOrderQty: Number(fd.get("minOrderQty")), qtyStep: 1, leadTimeDays: Number(fd.get("leadTimeDays")) },
          basePrice: fd.get("basePrice") ? Number(fd.get("basePrice")) : undefined,
        }), () => { setOpen(false); setDone(true); });
      }}
    >
      <h3 className="font-semibold">{t("proposeNew")}</h3>
      <p className="text-sm text-muted-foreground">{t("proposalNote")}</p>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <div className="space-y-1"><Label htmlFor="nameEn">{t("name")} (EN)</Label><Input id="nameEn" name="nameEn" required /></div>
        <div className="space-y-1"><Label htmlFor="namePt">{t("namePt")}</Label><Input id="namePt" name="namePt" /></div>
        <div className="space-y-1"><Label htmlFor="categoryId">{t("category")}</Label>
          <Select id="categoryId" name="categoryId" required defaultValue=""><option value="" disabled>—</option>{categories.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</Select></div>
        <div className="space-y-1"><Label htmlFor="brandId">{t("brand")}</Label>
          <Select id="brandId" name="brandId" defaultValue=""><option value="">—</option>{brands.map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}</Select></div>
        <div className="space-y-1"><Label htmlFor="taxCategoryId">{t("taxCategory")}</Label>
          <Select id="taxCategoryId" name="taxCategoryId" required>{taxCategories.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}</Select></div>
        <div className="space-y-1"><Label htmlFor="restriction">{t("restriction")}</Label>
          <Select id="restriction" name="restriction" defaultValue=""><option value="">{t("none")}</option><option value="TOBACCO">Tobacco</option><option value="ALCOHOL">Alcohol</option></Select></div>
        <div className="space-y-1"><Label htmlFor="gtin">{t("gtin")}</Label><Input id="gtin" name="gtin" /></div>
        <div className="space-y-1"><Label htmlFor="packName">{t("packagingName")}</Label><Input id="packName" name="packName" required placeholder="Case 12 × 1L" /></div>
        <div className="space-y-1"><Label htmlFor="uomCode">{t("unit")}</Label>
          <Select id="uomCode" name="uomCode">{units.map((u) => <option key={u.id} value={u.id}>{u.label}</option>)}</Select></div>
        <div className="space-y-1"><Label htmlFor="unitsPerPack">{t("unitsPerPack")}</Label><Input id="unitsPerPack" name="unitsPerPack" type="number" min={1} defaultValue={1} /></div>
        <div className="space-y-1"><Label htmlFor="minOrderQty">{t("minOrderQty")}</Label><Input id="minOrderQty" name="minOrderQty" type="number" min={1} defaultValue={1} /></div>
        <div className="space-y-1"><Label htmlFor="leadTimeDays">{t("leadTimeDays")}</Label><Input id="leadTimeDays" name="leadTimeDays" type="number" min={0} defaultValue={1} /></div>
        <div className="space-y-1"><Label htmlFor="vendorSku">{t("vendorSku")}</Label><Input id="vendorSku" name="vendorSku" /></div>
        {canPrice && <div className="space-y-1"><Label htmlFor="basePrice">{t("basePrice")}</Label><Input id="basePrice" name="basePrice" type="number" min="0.01" step="0.01" /></div>}
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <div className="flex gap-2">
        <Button type="submit" disabled={pending}>{t("submitProposal")}</Button>
        <Button type="button" variant="outline" onClick={() => setOpen(false)}>{t("cancel")}</Button>
      </div>
    </form>
  );
}

export function StockCell({ offerId, addressId, onHand, reserved }: { offerId: string; addressId: string; onHand: number; reserved: number }) {
  const t = useTranslations("catalogue.vendor");
  const { pending, error, run } = useRun();
  const [value, setValue] = useState(String(onHand));
  return (
    <div className="flex items-center justify-end gap-1">
      <Input aria-label={t("stock")} className="h-8 w-20 text-right" type="number" min={reserved} step={1} value={value} onChange={(e) => setValue(e.target.value)} />
      {value !== String(onHand) && value !== "" && <Button size="sm" disabled={pending} onClick={() => run(() => setStockAction({ offerId, addressId, onHand: Number(value) }))}>{t("save")}</Button>}
      {reserved > 0 && <span className="text-[10px] text-muted-foreground">({reserved} res.)</span>}
      {error && <span className="text-xs text-destructive">{error}</span>}
    </div>
  );
}
