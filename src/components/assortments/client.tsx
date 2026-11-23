"use client";
/** Customer assortments (Phase 64) — forms (texts passed in as `l`; FIRINGI's in English). */
import { useState } from "react";
import Link from "next/link";
import { Ban, Check, ClipboardList, Eye, Plus, Save, Search, ShoppingCart, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Msg, Spin, useRun } from "@/components/shared/run";
import {
  addAssortmentItemsAction, addGapsToCartAction, assortmentTargetsAction, createAssortmentAction, deleteAssortmentAction, previewAssortmentAction,
  removeAssortmentItemAction, saveAssortmentSettingsAction, searchAssortmentVendorsAction, searchOwnProductsAction, setMustStockAction, setVendorAssortmentsAction, updateAssortmentAction,
} from "@/server/actions/assortments";
import { ASSORTMENT_MODES, ASSORTMENT_TARGETS, type AssortmentModeKey, type AssortmentSettings, type AssortmentTargetKey } from "@/lib/assortments";

export type L = Record<string, string>;
const f = (s: string | undefined, v: Record<string, string | number> = {}) => (s ?? "").replace(/\{(\w+)\}/g, (_, k: string) => String(v[k] ?? `{${k}}`));
const sel = "h-9 w-full min-w-0 rounded-md border bg-background px-2 text-sm";
type Opt = { id: string; name: string };
type Targets = { groups: (Opt & { members: number })[]; customers: (Opt & { taxId: string })[] };

/** Who a list is for: all customers, a group, or one customer (search). */
function TargetPicker({ l, groups, value, onChange }: { l: L; groups: Targets["groups"]; value: { target: AssortmentTargetKey; groupId: string; companyId: string; companyName: string }; onChange: (v: { target: AssortmentTargetKey; groupId: string; companyId: string; companyName: string }) => void }) {
  const s = useRun();
  const [q, setQ] = useState("");
  const [found, setFound] = useState<Targets["customers"] | null>(null);
  return (
    <div className="space-y-2">
      <div className="space-y-1">
        <Label htmlFor="as-target">{l.for}</Label>
        <select id="as-target" className={sel} value={value.target} onChange={(e) => onChange({ ...value, target: e.target.value as AssortmentTargetKey })} data-testid="as-target">
          {ASSORTMENT_TARGETS.map((t) => <option key={t} value={t}>{l[`target.${t}`]}</option>)}
        </select>
      </div>
      {value.target === "GROUP" && (groups.length === 0 ? <p className="text-sm text-muted-foreground">{l.noGroups}</p> : (
        <div className="space-y-1">
          <Label htmlFor="as-group">{l.group}</Label>
          <select id="as-group" className={sel} value={value.groupId} onChange={(e) => onChange({ ...value, groupId: e.target.value })} data-testid="as-group">
            <option value="">—</option>
            {groups.map((g) => <option key={g.id} value={g.id}>{g.name} ({g.members})</option>)}
          </select>
        </div>
      ))}
      {value.target === "CUSTOMER" && (
        <div className="space-y-2">
          {value.companyId && <p className="text-sm" data-testid="as-customer-chosen"><Check className="mr-1 inline size-4" />{value.companyName}</p>}
          <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); s.run(() => assortmentTargetsAction({ q }), (d) => setFound((d as Targets).customers)); }}>
            <Input placeholder={l.searchCustomer} aria-label={l.searchCustomer} value={q} onChange={(e) => setQ(e.target.value)} data-testid="as-customer-search" />
            <Button type="submit" variant="outline" disabled={s.pending} aria-label={l.searchCustomer}><Spin on={s.pending} icon={Search} /></Button>
          </form>
          {found && (found.length === 0 ? <p className="text-sm text-muted-foreground">{l.noCustomers}</p> : (
            <ul className="max-h-56 divide-y overflow-y-auto rounded-md border">
              {found.map((c) => <li key={c.id}><button type="button" className={`w-full p-2 text-left text-sm hover:bg-muted ${c.id === value.companyId ? "bg-muted font-medium" : ""}`} onClick={() => onChange({ ...value, companyId: c.id, companyName: c.name })} data-testid="as-pick-customer">{c.name} <span className="text-xs text-muted-foreground">· {c.taxId}</span></button></li>)}
            </ul>
          ))}
          <Msg error={s.error} />
        </div>
      )}
    </div>
  );
}

export function NewListForm({ l, groups, modes }: { l: L; groups: Targets["groups"]; modes: Record<AssortmentModeKey, boolean> }) {
  const { pending, error, run, router } = useRun();
  const first = ASSORTMENT_MODES.find((m) => modes[m]) ?? "ONLY_LISTED";
  const [v, setV] = useState({ name: "", mode: first as AssortmentModeKey, target: "ALL" as AssortmentTargetKey, groupId: "", companyId: "", companyName: "" });
  const ready = v.name.trim() && modes[v.mode] && (v.target !== "GROUP" || v.groupId) && (v.target !== "CUSTOMER" || v.companyId);
  return (
    <div className="grid gap-4 lg:grid-cols-2" data-testid="as-new">
      <div className="space-y-3">
        <div className="space-y-1"><Label htmlFor="as-name">{l.name}</Label><Input id="as-name" maxLength={120} value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} data-testid="as-name" /></div>
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">{l.kind}</legend>
          {ASSORTMENT_MODES.map((m) => (
            <label key={m} className={`flex items-start gap-2 rounded-md border p-2 text-sm ${v.mode === m ? "border-primary" : ""} ${modes[m] ? "" : "opacity-50"}`}>
              <input type="radio" name="as-mode" className="mt-0.5 size-4" checked={v.mode === m} disabled={!modes[m]} onChange={() => setV({ ...v, mode: m })} data-testid={`as-mode-${m}`} />
              <span className="min-w-0"><span className="font-medium">{l[`mode.${m}`]}</span><span className="block text-xs text-muted-foreground">{modes[m] ? l[`modeHint.${m}`] : l.modeOff}</span></span>
            </label>
          ))}
        </fieldset>
      </div>
      <div className="space-y-3">
        <TargetPicker l={l} groups={groups} value={v} onChange={(x) => setV({ ...v, ...x })} />
        <div className="flex flex-wrap items-center gap-3">
          <Button disabled={pending || !ready} data-testid="as-create"
            onClick={() => run(() => createAssortmentAction({ name: v.name, mode: v.mode, target: v.target, targetGroupId: v.groupId || null, targetCompanyId: v.companyId || null }), (d) => router.push(`/vendor/products/assortments/${(d as { id: string }).id}`))}>
            <Spin on={pending} icon={Plus} /> {l.create}
          </Button>
          <Msg error={error} />
        </div>
      </div>
    </div>
  );
}

export function EditListForm({ l, list, groups, modes }: { l: L; groups: Targets["groups"]; modes: Record<AssortmentModeKey, boolean>; list: { id: string; name: string; mode: AssortmentModeKey; target: AssortmentTargetKey; targetGroupId: string | null; targetCompanyId: string | null; targetName: string | null; active: boolean; note: string | null } }) {
  const { pending, error, done, run, router } = useRun();
  const del = useRun();
  const [confirm, setConfirm] = useState(false);
  const [v, setV] = useState({ name: list.name, active: list.active, note: list.note ?? "", target: list.target, groupId: list.targetGroupId ?? "", companyId: list.targetCompanyId ?? "", companyName: list.target === "CUSTOMER" ? list.targetName ?? "" : "" });
  return (
    <div className="space-y-3" data-testid="as-edit">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1"><Label htmlFor="as-ename">{l.name}</Label><Input id="as-ename" maxLength={120} value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} /></div>
        <label className="flex items-center gap-2 self-end pb-2 text-sm"><input type="checkbox" className="size-4" checked={v.active} onChange={(e) => setV({ ...v, active: e.target.checked })} data-testid="as-active" /> {l.active}</label>
      </div>
      <TargetPicker l={l} groups={groups} value={v} onChange={(x) => setV({ ...v, ...x })} />
      <div className="flex flex-wrap items-center gap-3">
        <Button disabled={pending || !v.name.trim() || !modes[list.mode]} data-testid="as-save"
          onClick={() => run(() => updateAssortmentAction({ id: list.id, name: v.name, mode: list.mode, target: v.target, targetGroupId: v.groupId || null, targetCompanyId: v.companyId || null, active: v.active, note: v.note || null }), undefined, l.saved)}>
          <Spin on={pending} icon={Save} /> {l.save}
        </Button>
        {confirm
          ? <><span className="text-sm">{l.deleteConfirm}</span><Button variant="destructive" disabled={del.pending} onClick={() => del.run(() => deleteAssortmentAction({ id: list.id }), () => router.push("/vendor/products/assortments"))} data-testid="as-delete-yes"><Trash2 className="size-4" /> {l.delete}</Button><Button variant="ghost" onClick={() => setConfirm(false)}>{l.cancel}</Button></>
          : <Button variant="outline" onClick={() => setConfirm(true)} data-testid="as-delete"><Trash2 className="size-4" /> {l.delete}</Button>}
        <Msg error={error ?? del.error} done={done} />
      </div>
    </div>
  );
}

type Found = { offerId: string; name: string; packaging: string; sku: string; listed: boolean };

export function AddItems({ l, id }: { l: L; id: string }) {
  const s = useRun();
  const add = useRun();
  const [q, setQ] = useState("");
  const [found, setFound] = useState<Found[] | null>(null);
  const [skus, setSkus] = useState("");
  const [res, setRes] = useState<{ added: number; notFound: string[] } | null>(null);
  const find = () => s.run(() => searchOwnProductsAction({ id, q }), (d) => setFound(d as Found[]));
  return (
    <div className="grid gap-4 lg:grid-cols-2" data-testid="as-add">
      <div className="space-y-2">
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); find(); }}>
          <Input placeholder={l.searchProducts} aria-label={l.searchProducts} value={q} onChange={(e) => setQ(e.target.value)} data-testid="as-product-search" />
          <Button type="submit" variant="outline" disabled={s.pending} aria-label={l.searchProducts}><Spin on={s.pending} icon={Search} /></Button>
        </form>
        <Msg error={s.error} />
        {found && (
          <ul className="max-h-80 divide-y overflow-y-auto rounded-md border" data-testid="as-found">
            {found.map((p) => (
              <li key={p.offerId} className="flex flex-wrap items-center gap-2 p-2 text-sm" data-testid="as-found-row" data-offer={p.offerId}>
                <span className="min-w-0 flex-1 basis-40 break-words">{p.name} <span className="text-xs text-muted-foreground">· {p.packaging} · {p.sku}</span></span>
                {p.listed ? <span className="text-xs text-muted-foreground">{l.added}</span>
                  : <Button size="sm" variant="outline" disabled={add.pending} onClick={() => add.run(() => addAssortmentItemsAction({ id, offerIds: [p.offerId] }), () => setFound((xs) => xs?.map((x) => (x.offerId === p.offerId ? { ...x, listed: true } : x)) ?? null))} data-testid="as-add-one"><Plus className="size-4" /> {l.add}</Button>}
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="space-y-2">
        <Label htmlFor="as-skus">{l.pasteSkus}</Label>
        <textarea id="as-skus" rows={4} className="w-full rounded-md border bg-background p-2 text-sm" value={skus} onChange={(e) => setSkus(e.target.value)} data-testid="as-skus" />
        <p className="text-xs text-muted-foreground">{l.pasteHint}</p>
        <Button variant="outline" disabled={add.pending || !skus.trim()} onClick={() => add.run(() => addAssortmentItemsAction({ id, skus }), (d) => { setRes(d as { added: number; notFound: string[] }); setSkus(""); })} data-testid="as-add-skus"><ClipboardList className="size-4" /> {l.addSkus}</Button>
        {res && <p className="text-sm" role="status" data-testid="as-skus-result">{f(l.addedN, { n: res.added })}{res.notFound.length > 0 && <span className="block text-destructive">{f(l.notFound, { skus: res.notFound.join(", ") })}</span>}</p>}
        <Msg error={add.error} />
      </div>
    </div>
  );
}

export function ItemRow({ l, id, offerId, mustStock, canMark }: { l: L; id: string; offerId: string; mustStock: boolean; canMark: boolean }) {
  const { pending, error, run } = useRun();
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      {canMark && <label className="flex items-center gap-1 text-xs"><input type="checkbox" className="size-4" checked={mustStock} disabled={pending} onChange={(e) => run(() => setMustStockAction({ id, offerId, on: e.target.checked }))} data-testid="as-must" /> {l.mustStock}</label>}
      <Button size="sm" variant="ghost" disabled={pending} aria-label={l.remove} onClick={() => run(() => removeAssortmentItemAction({ id, offerId }))} data-testid="as-remove"><Spin on={pending} icon={Trash2} /></Button>
      <Msg error={error} />
    </span>
  );
}

export function PreviewBox({ l }: { l: L }) {
  const s = useRun();
  const p = useRun();
  const [q, setQ] = useState("");
  const [found, setFound] = useState<Targets["customers"] | null>(null);
  const [res, setRes] = useState<{ customer: string; total: number; visible: number; hidden: number; mustStock: number } | null>(null);
  return (
    <div className="space-y-2" data-testid="as-preview">
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); s.run(() => assortmentTargetsAction({ q }), (d) => setFound((d as Targets).customers)); }}>
        <Input placeholder={l.searchCustomer} aria-label={l.searchCustomer} value={q} onChange={(e) => setQ(e.target.value)} data-testid="as-preview-search" />
        <Button type="submit" variant="outline" disabled={s.pending} aria-label={l.searchCustomer}><Spin on={s.pending} icon={Search} /></Button>
      </form>
      {found && (found.length === 0 ? <p className="text-sm text-muted-foreground">{l.noCustomers}</p> : (
        <ul className="max-h-48 divide-y overflow-y-auto rounded-md border">
          {found.map((c) => <li key={c.id} className="flex items-center justify-between gap-2 p-2 text-sm"><span className="min-w-0 break-words">{c.name}</span><Button size="sm" variant="outline" disabled={p.pending} onClick={() => p.run(() => previewAssortmentAction({ buyerCompanyId: c.id }), (d) => setRes(d as typeof res))} data-testid="as-preview-show"><Eye className="size-4" /> {l.preview}</Button></li>)}
        </ul>
      ))}
      {res && <p className="rounded-md bg-muted p-2 text-sm" role="status" data-testid="as-preview-result" data-visible={res.visible} data-hidden={res.hidden}>{f(l.previewResult, { customer: res.customer, visible: res.visible, total: res.total, hidden: res.hidden, must: res.mustStock })}</p>}
      <Msg error={s.error ?? p.error} />
    </div>
  );
}

// ── the customer ────────────────────────────────────────────────────────────

export function AddGaps({ l, vendorId, label }: { l: L; vendorId?: string; label: string }) {
  const { pending, error, run } = useRun();
  const [n, setN] = useState<number | null>(null);
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <Button size="sm" disabled={pending} onClick={() => run(() => addGapsToCartAction({ vendorId: vendorId ?? null }), (d) => setN((d as { added: number }).added))} data-testid={vendorId ? "ms-add-supplier" : "ms-add-all"}>
        <Spin on={pending} icon={ShoppingCart} /> {label}
      </Button>
      {n != null && <span className="text-sm" role="status" data-testid="ms-added" data-n={n}>{f(l.addedToCart, { n })} <Link href="/buy/cart" className="underline underline-offset-2">{l.goToCart}</Link></span>}
      <Msg error={error} />
    </span>
  );
}

// ── FIRINGI ─────────────────────────────────────────────────────────────────

export function AdminAssortmentSettings({ settings }: { settings: AssortmentSettings }) {
  const { pending, error, done, run } = useRun();
  const [v, setV] = useState(settings);
  const NAMES: Record<AssortmentModeKey, string> = { ONLY_LISTED: "Approved lists (only listed products)", HIDE_LISTED: "Hidden items", MUST_STOCK: "Must-stock lists" };
  return (
    <div className="space-y-4" data-testid="as-settings">
      <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-0.5 size-4" checked={v.enabled} onChange={(e) => setV({ ...v, enabled: e.target.checked })} data-testid="ass-enabled" /> <span>Customer assortments are on (suppliers&apos; lists apply in every channel)</span></label>
      <div className="space-y-1">
        <p className="text-sm font-medium">Kinds of list suppliers may use</p>
        <div className="flex flex-wrap gap-4">{ASSORTMENT_MODES.map((m) => <label key={m} className="flex items-center gap-2 text-sm"><input type="checkbox" className="size-4" checked={v.modes[m]} onChange={(e) => setV({ ...v, modes: { ...v.modes, [m]: e.target.checked } })} data-testid={`ass-m-${m}`} /> {NAMES[m]}</label>)}</div>
      </div>
      <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-0.5 size-4" checked={v.reminders} onChange={(e) => setV({ ...v, reminders: e.target.checked })} /> <span>Remind customers weekly of must-stock products they haven&apos;t ordered lately</span></label>
      <div className="w-56 space-y-1"><Label htmlFor="ass-gap">Not ordered for (days) = a gap</Label><Input id="ass-gap" type="number" min={7} max={365} value={v.gapDays} onChange={(e) => setV({ ...v, gapDays: Number(e.target.value) })} /></div>
      <div className="flex flex-wrap items-center gap-3">
        <Button disabled={pending} onClick={() => run(() => saveAssortmentSettingsAction({ enabled: v.enabled, modes: v.modes, gapDays: v.gapDays, reminders: v.reminders }), undefined, "Saved")} data-testid="ass-save"><Spin on={pending} icon={Save} /> Save</Button>
        <Msg error={error} done={done} />
      </div>
    </div>
  );
}

export function VendorSwitch({ vendorId, on }: { vendorId: string; on: boolean }) {
  const { pending, error, run } = useRun();
  return (
    <span className="inline-flex items-center gap-2">
      <Button size="sm" variant={on ? "outline" : "default"} disabled={pending} onClick={() => run(() => setVendorAssortmentsAction({ vendorId, on: !on }))} data-testid="as-vendor-switch" data-on={on}><Spin on={pending} icon={on ? Ban : Check} /> {on ? "Switch off" : "Switch on"}</Button>
      <Msg error={error} />
    </span>
  );
}

export function SwitchOffVendor() {
  const s = useRun();
  const [q, setQ] = useState("");
  const [found, setFound] = useState<Opt[] | null>(null);
  return (
    <div className="space-y-2">
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); s.run(() => searchAssortmentVendorsAction({ q }), (d) => setFound(d as Opt[])); }}>
        <Input placeholder="Search a supplier" aria-label="Search a supplier" value={q} onChange={(e) => setQ(e.target.value)} />
        <Button type="submit" variant="outline" disabled={s.pending} aria-label="Search"><Spin on={s.pending} icon={Search} /></Button>
      </form>
      {found && (found.length === 0 ? <p className="text-sm text-muted-foreground">No suppliers found.</p> : <ul className="divide-y rounded-md border">{found.map((v) => <li key={v.id} className="flex flex-wrap items-center justify-between gap-2 p-2 text-sm"><span className="min-w-0 break-words">{v.name}</span><VendorSwitch vendorId={v.id} on /></li>)}</ul>)}
      <Msg error={s.error} />
    </div>
  );
}
