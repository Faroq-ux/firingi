"use client";
/**
 * Add a product by barcode with AI (supplier, 25 languages): type or scan a barcode → already in FIRINGI's catalogue
 * (sell it) · found in the open product databases → the proposal form filled in by AI · not found → photos of the
 * package read by AI, or fill in by hand. The supplier checks everything and adds the price; FIRINGI approves.
 */
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Box, Camera, ImagePlus, Package, Pencil, ScanBarcode, Search, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";
import { Spin } from "@/components/shared/run";
import { draftFromPhotosAction, startFromBarcodeAction } from "@/server/actions/barcode-ai";
import { proposeProductAction } from "@/server/actions/catalogue";
import type { ProductDraft } from "@/lib/barcode-ai";
import type { BarcodeResult } from "@/server/catalogue/barcode-ai";
import { ProposeProductForm, type ProposeInitial } from "./offer-controls";

type Opt = { id: string; label: string };
type Lists = { categories: Opt[]; brands: Opt[]; taxCategories: Opt[]; units: Opt[]; canPrice: boolean };

/**
 * The easy way (most suppliers stop here): the product as read, one choice — sold per item (with a minimum) or per
 * case (items in it) — the price, and Add. Everything else is filled in; "Edit all details" opens the full form.
 */
function QuickAdd({ draft, lists, onDone, onEdit }: { draft: ProductDraft; lists: Lists; onDone: () => void; onEdit: () => void }) {
  const t = useTranslations("catalogue.vendor.barcodeAi");
  const [mode, setMode] = useState<"ITEM" | "CASE">(draft.barcodeOn === "PACK" || draft.unitsPerPack > 1 ? "CASE" : "ITEM");
  const [perCase, setPerCase] = useState(draft.unitsPerPack > 1 ? String(draft.unitsPerPack) : "");
  const [minQty, setMinQty] = useState("1");
  const [price, setPrice] = useState("");
  const [categoryId, setCategoryId] = useState(draft.categoryId ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const locale = useLocale();
  const category = lists.categories.find((c) => c.id === categoryId)?.label.replace(/^(—\s*)+/, "");
  const shown = locale.startsWith("pt") && draft.namePt ? draft.namePt : draft.nameEn;
  const hasUnit = (c: string) => lists.units.some((u) => u.id === c);
  const n = Math.max(1, Math.round(Number(perCase) || 0));
  const add = async () => {
    setError(null);
    if (!categoryId) { setError(t("pickCategory")); return; }
    if (mode === "CASE" && n < 2) { setError(t("needCaseSize")); return; }
    setBusy(true);
    const itemCode = draft.unitGtin ?? (draft.barcodeOn === "UNIT" ? draft.gtin : null);
    const caseCode = draft.barcodeOn === "PACK" ? draft.gtin : null;
    const item = mode === "ITEM";
    const r = await proposeProductAction({
      name: { en: draft.nameEn, pt: draft.namePt || null }, categoryId, brandId: draft.brandId, taxCategoryId: draft.taxCategoryId ?? lists.taxCategories[0]?.id ?? "",
      restriction: draft.restriction as "TOBACCO" | null, gtin: item ? itemCode ?? caseCode : itemCode,
      packaging: item
        ? { uomCode: hasUnit(draft.uomCode) && !["CX", "PK", "PAL"].includes(draft.uomCode) ? draft.uomCode : "UN", name: { en: draft.nameEn, pt: draft.namePt || draft.nameEn }, unitsPerPack: 1, gtin: null }
        : { uomCode: hasUnit("CX") ? "CX" : draft.uomCode, name: { en: `Case ${n} × ${draft.nameEn}`, pt: `Caixa ${n} × ${draft.namePt || draft.nameEn}` }, unitsPerPack: n, gtin: caseCode },
      offer: { vendorSku: null, minOrderQty: item ? Math.max(1, Math.round(Number(minQty) || 1)) : 1, qtyStep: 1, leadTimeDays: 1 },
      basePrice: lists.canPrice && Number(price) > 0 ? Number(price) : undefined,
      description: draft.descriptionEn || draft.descriptionPt ? { en: draft.descriptionEn || null, pt: draft.descriptionPt || null } : null,
      brandName: draft.brandId ? null : draft.brandName || null,
      food: draft.contain.length || draft.mayContain.length || draft.diets.length || Object.keys(draft.ingredients).length ? { contain: draft.contain, mayContain: draft.mayContain, diets: draft.diets, ingredients: draft.ingredients } : null,
    });
    setBusy(false);
    if (r.ok) onDone(); else setError(r.error);
  };
  const choice = (m: "ITEM" | "CASE", Icon: typeof Box, label: string) => (
    <button type="button" onClick={() => setMode(m)} aria-pressed={mode === m} data-testid={`ba-mode-${m.toLowerCase()}`}
      className={`flex flex-1 items-center justify-center gap-2 rounded-lg border-2 px-3 py-3 text-sm font-medium transition ${mode === m ? "border-primary bg-primary/10 text-primary" : "border-border hover:bg-accent"}`}>
      <Icon className="size-5" aria-hidden /> {label}
    </button>
  );
  return (
    <div className="space-y-4 rounded-xl border bg-card p-4" data-testid="ba-quick">
      <div>
        <p className="text-base font-semibold" data-testid="ba-name">{shown}</p>
        <p className="text-sm text-muted-foreground">{[draft.brandName, category].filter(Boolean).join(" · ")}</p>
      </div>
      {!draft.categoryId && (
        <div className="max-w-sm space-y-1"><Label htmlFor="ba-cat">{t("pickCategory")}</Label>
          <Select id="ba-cat" value={categoryId} onChange={(e) => setCategoryId(e.target.value)} data-testid="ba-category"><option value="">—</option>{lists.categories.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</Select></div>
      )}
      <div className="space-y-2">
        <p className="text-sm font-medium">{t("howSell")}</p>
        <div className="flex max-w-md gap-2">{choice("ITEM", Package, t("perItem"))}{choice("CASE", Box, t("perCase"))}</div>
      </div>
      <div className="flex flex-wrap gap-3">
        {mode === "ITEM"
          ? <div className="space-y-1"><Label htmlFor="ba-min">{t("minItems")}</Label><Input id="ba-min" type="number" min={1} value={minQty} onChange={(e) => setMinQty(e.target.value)} className="w-32" data-testid="ba-min" /></div>
          : <div className="space-y-1"><Label htmlFor="ba-per-case">{t("itemsPerCase")}</Label><Input id="ba-per-case" type="number" min={2} value={perCase} onChange={(e) => setPerCase(e.target.value)} className="w-32" placeholder="6" data-testid="ba-per-case" /></div>}
        {lists.canPrice && <div className="space-y-1"><Label htmlFor="ba-price">{mode === "ITEM" ? t("pricePerItem") : t("pricePerCase")}</Label><Input id="ba-price" type="number" min="0.01" step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} className="w-32" data-testid="ba-price" /></div>}
      </div>
      {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={() => void add()} disabled={busy} data-testid="ba-add"><Spin on={busy} icon={Sparkles} /> {t("add")}</Button>
        <button type="button" onClick={onEdit} className="inline-flex items-center gap-1 text-sm text-primary hover:underline" data-testid="ba-edit"><Pencil className="size-3.5" /> {t("editAll")}</button>
      </div>
      <p className="text-xs text-muted-foreground">{t("checkNote")}</p>
    </div>
  );
}
type Detector = { detect: (src: HTMLVideoElement) => Promise<{ rawValue: string }[]> };

/** A phone photo shrunk to ≤ 1600 px JPEG (keeps uploads small and fast). */
async function shrink(file: File): Promise<{ mime: string; base64: string }> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((ok, bad) => { const i = new Image(); i.onload = () => ok(i); i.onerror = bad; i.src = url; });
    const k = Math.min(1, 1600 / Math.max(img.width, img.height));
    const c = document.createElement("canvas"); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
    c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
    return { mime: "image/jpeg", base64: c.toDataURL("image/jpeg", 0.85).split(",")[1] };
  } finally { URL.revokeObjectURL(url); }
}

export function BarcodeAdd({ lists }: { photosOn?: boolean; lists: Lists }) {
  const t = useTranslations("catalogue.vendor.barcodeAi");
  const tf = useTranslations("food");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState<"find" | "photos" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [res, setRes] = useState<BarcodeResult | null>(null);
  const [byHand, setByHand] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [done, setDone] = useState(false);
  const [full, setFull] = useState(false);
  const [scanning, setScanning] = useState(false);
  const video = useRef<HTMLVideoElement>(null);

  const find = async (value = code) => {
    setBusy("find"); setError(null); setRes(null); setByHand(false); setDone(false); setFull(false); setFiles([]);
    const r = await startFromBarcodeAction({ code: value.trim() });
    setBusy(null);
    if (r.ok) setRes(r.data as BarcodeResult); else setError(r.error);
  };
  const readPhotos = async () => {
    if (!res) return;
    setBusy("photos"); setError(null);
    try {
      const photos = await Promise.all(files.slice(0, 3).map(shrink));
      const r = await draftFromPhotosAction({ code: res.code, photos });
      if (r.ok) setRes(r.data as BarcodeResult); else setError(r.error);
    } catch { setError(t("photoError")); }
    setBusy(null);
  };

  // Camera scan where the browser can (Chrome on Android / desktop); USB scanners simply type into the box.
  useEffect(() => {
    if (!scanning) return;
    let stream: MediaStream | null = null, stop = false;
    (async () => {
      const BD = (window as unknown as { BarcodeDetector?: new (o: { formats: string[] }) => Detector }).BarcodeDetector;
      if (!BD || !navigator.mediaDevices?.getUserMedia) { setError(t("scanUnsupported")); setScanning(false); return; }
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
        if (video.current) { video.current.srcObject = stream; await video.current.play(); }
        const det = new BD({ formats: ["ean_13", "ean_8", "upc_a", "upc_e", "itf"] });
        while (!stop && video.current) {
          const found = await det.detect(video.current).catch(() => []);
          if (found[0]?.rawValue) { setCode(found[0].rawValue); setScanning(false); void find(found[0].rawValue); break; }
          await new Promise((r) => setTimeout(r, 250));
        }
      } catch { setError(t("scanUnsupported")); setScanning(false); }
    })();
    return () => { stop = true; stream?.getTracks().forEach((x) => x.stop()); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scanning]);

  const draft = res?.kind === "draft" ? res.draft : null;
  const initial: ProposeInitial | undefined = draft ? {
    gtin: draft.gtin, unitGtin: draft.unitGtin, barcodeOn: draft.barcodeOn, nameEn: draft.nameEn, namePt: draft.namePt, brandId: draft.brandId, brandName: draft.brandName,
    categoryId: draft.categoryId, taxCategoryId: draft.taxCategoryId, restriction: draft.restriction, uomCode: draft.uomCode, unitsPerPack: draft.unitsPerPack,
    packName: draft.packName, descriptionEn: draft.descriptionEn, descriptionPt: draft.descriptionPt,
    food: draft.contain.length || draft.mayContain.length || draft.diets.length || Object.keys(draft.ingredients).length ? { contain: draft.contain, mayContain: draft.mayContain, diets: draft.diets, ingredients: draft.ingredients } : null,
  } : byHand && res ? { gtin: res.code } : undefined;
  const names = (xs: string[]) => xs.map((a) => tf(`a.${a}`)).join(", ");

  return (
    <div className="space-y-4" data-testid="barcode-add">
      <div>
        <h3 className="flex items-center gap-2 text-lg font-semibold"><Sparkles className="size-5 text-primary" aria-hidden /> {t("title")}</h3>
        <p className="text-sm text-muted-foreground">{t("hint")}</p>
      </div>
      <form className="flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); void find(); }}>
        <Input value={code} onChange={(e) => setCode(e.target.value.replace(/[^\d]/g, ""))} inputMode="numeric" placeholder={t("placeholder")} className="max-w-xs" aria-label={t("placeholder")} data-testid="ba-code" />
        <Button type="submit" disabled={!!busy || code.length < 8} data-testid="ba-find"><Spin on={busy === "find"} icon={Search} /> {t("find")}</Button>
        <Button type="button" variant="outline" onClick={() => setScanning((v) => !v)} data-testid="ba-scan"><ScanBarcode className="size-4" /> {t("scan")}</Button>
      </form>
      {scanning && <video ref={video} className="w-full max-w-sm rounded-lg border" muted playsInline />}
      {busy === "find" && <p className="text-sm text-muted-foreground">{t("looking")}</p>}
      {error && <p className="text-sm text-destructive" role="alert" data-testid="ba-error">{error}</p>}

      {res?.kind === "catalogue" && (
        <div className="rounded-lg border p-3 text-sm" data-testid="ba-catalogue">
          <p className="font-medium">{t("inCatalogue")}</p>
          <ul className="list-inside list-disc text-muted-foreground">{res.products.map((p) => <li key={p.id}>{p.name}</li>)}</ul>
          <Link href={`/vendor/products/catalogue?find=${res.code}`} className="mt-2 inline-block text-primary hover:underline" data-testid="ba-sell">{t("sellIt")}</Link>
        </div>
      )}

      {res?.kind === "notFound" && !byHand && (
        <div className="space-y-3 rounded-lg border p-3 text-sm" data-testid="ba-notfound">
          <p>{t("notFound")}</p>
          {res.photos && (
            <div className="space-y-2">
              <p className="text-muted-foreground">{t("photosHint")}</p>
              <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 hover:bg-accent">
                <ImagePlus className="size-4" /> {t("addPhotos")}
                <input type="file" accept="image/jpeg,image/png,image/webp" capture="environment" multiple className="sr-only" onChange={(e) => setFiles([...(e.target.files ?? [])].slice(0, 3))} data-testid="ba-photos" />
              </label>
              {files.length > 0 && <span className="ml-2 text-muted-foreground">{t("photosChosen", { count: files.length })}</span>}
              <div><Button disabled={!files.length || !!busy} onClick={() => void readPhotos()} data-testid="ba-read"><Spin on={busy === "photos"} icon={Camera} /> {t("readPhotos")}</Button></div>
            </div>
          )}
          <Button variant="outline" onClick={() => setByHand(true)} data-testid="ba-byhand">{t("byHand")}</Button>
        </div>
      )}

      {draft && (
        <div className="space-y-1 rounded-lg border border-primary/30 bg-primary/5 p-3 text-sm" data-testid="ba-draft">
          <p className="font-medium">
            {draft.source === "OFF" ? t("fromDb", { source: res?.kind === "draft" ? res.source ?? "" : "" }) : draft.source === "PHOTOS_AI" ? t("fromPhotos") : t("fromDbAi", { source: res?.kind === "draft" ? res.source ?? "" : "" })}
            {draft.simulated && <span className="ml-1 text-muted-foreground">({t("simulated")})</span>}
          </p>
          {draft.unitGtin && draft.unitGtin !== draft.gtin && <p data-testid="ba-case">{t("caseCode", { item: draft.unitGtin })}</p>}
          {full && draft.unitsPerPack <= 1 && <p className="font-medium" data-testid="ba-case-size">{t("setCase")}</p>}
          {draft.contain.length > 0 && <p data-testid="ba-contains">{t("contains", { list: names(draft.contain) })}</p>}
          {draft.mayContain.length > 0 && <p>{t("mayContain", { list: names(draft.mayContain) })}</p>}
          {draft.notes && <p className="text-muted-foreground">{t("aiNote", { note: draft.notes })}</p>}
          {initial?.food && <p className="text-muted-foreground">{t("foodDraft")}</p>}
        </div>
      )}

      {draft && !full && !done && <QuickAdd key={`${res?.code}-${draft.source}`} draft={draft} lists={lists} onEdit={() => setFull(true)} onDone={() => { setDone(true); setRes(null); setCode(""); }} />}
      {((draft && full) || byHand) && !done && (
        <ProposeProductForm key={`${res?.code}-${draft?.source ?? "hand"}`} {...lists} initial={initial} defaultOpen onProposed={() => { setDone(true); setRes(null); setCode(""); }} />
      )}
      {done && <p className="text-sm text-[color:var(--success,#16a34a)]" data-testid="ba-done">{t("proposed")}</p>}
    </div>
  );
}
