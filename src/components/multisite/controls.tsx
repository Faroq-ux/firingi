"use client";
/** Shops (branches) of one company, staff, budgets, PO setting, checkout budget preview (Phase 27). Texts: "multisite". */
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Ban, Check, MapPinPlus, Play, Plus, Store, Trash2, UserMinus, UserPlus, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";
import { Msg, Spin, useRun, type Opt } from "@/components/shared/run";
import { BUSINESS_TYPES } from "@/lib/business-types";
import {
  addShopAddressAction, budgetPreviewAction, deleteBranchAction, deleteBudgetAction, saveBranchAction, saveBudgetAction, setAddressBranchAction, setBranchActiveAction, setBranchMemberAction,
  setCompanyFeatureAction, setPoRequiredAction,
} from "@/server/actions/multisite";

type City = { id: string; name: string };
type AddrState = { line1: string; line2: string; postalCode: string; cityId: string; cityName: string; contactName: string; phone: string };
const emptyAddr: AddrState = { line1: "", line2: "", postalCode: "", cityId: "", cityName: "", contactName: "", phone: "" };
const toAddress = (a: AddrState, countryCode: string, cities: City[], label?: string | null) => {
  const city = cities.find((c) => c.id === a.cityId);
  return { line1: a.line1, line2: a.line2 || null, postalCode: a.postalCode, countryCode, cityId: city?.id ?? null, cityName: city?.name ?? a.cityName, contactName: a.contactName || null, phone: a.phone || null, label: label ?? null };
};

/** Street, postal code, city (from the company's country) — labels from the onboarding texts. */
function AddressFields({ a, set, cities, idp }: { a: AddrState; set: (a: AddrState) => void; cities: City[]; idp: string }) {
  const t = useTranslations("onboarding");
  const other = a.cityId === "__other" || !cities.length;
  return (
    <>
      <div className="space-y-1 sm:col-span-2"><Label htmlFor={`${idp}-l1`}>{t("form.line1")}</Label><Input id={`${idp}-l1`} required maxLength={200} value={a.line1} onChange={(e) => set({ ...a, line1: e.target.value })} /></div>
      <div className="space-y-1"><Label htmlFor={`${idp}-l2`}>{t("form.line2")}</Label><Input id={`${idp}-l2`} maxLength={200} value={a.line2} onChange={(e) => set({ ...a, line2: e.target.value })} /></div>
      <div className="space-y-1"><Label htmlFor={`${idp}-pc`}>{t("form.postalCode")}</Label><Input id={`${idp}-pc`} required maxLength={20} value={a.postalCode} onChange={(e) => set({ ...a, postalCode: e.target.value })} /></div>
      {cities.length > 0 && (
        <div className="space-y-1"><Label htmlFor={`${idp}-ci`}>{t("form.city")}</Label>
          <Select id={`${idp}-ci`} required value={a.cityId} onChange={(e) => set({ ...a, cityId: e.target.value })}>
            <option value="" disabled>{t("form.chooseCity")}</option>
            {cities.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            <option value="__other">{t("form.cityOther")}</option>
          </Select>
        </div>
      )}
      {other && <div className="space-y-1"><Label htmlFor={`${idp}-cn`}>{t("form.cityName")}</Label><Input id={`${idp}-cn`} required maxLength={120} value={a.cityName} onChange={(e) => set({ ...a, cityName: e.target.value })} /></div>}
      <div className="space-y-1"><Label htmlFor={`${idp}-ct`}>{t("addr.contactName")}</Label><Input id={`${idp}-ct`} maxLength={120} value={a.contactName} onChange={(e) => set({ ...a, contactName: e.target.value })} /></div>
    </>
  );
}

export type ShopInitial = { id: string; name: string; code: string | null; category: string | null; costCentre: string | null; phone: string | null; managerMembershipId: string | null };

/** New shop (with its address) or edit a shop's details. */
export function ShopForm({ initial, team, cities, countryCode, onDone }: { initial?: ShopInitial; team: Opt[]; cities: City[]; countryCode: string; onDone?: () => void }) {
  const t = useTranslations("multisite");
  const tb = useTranslations("onboarding");
  const { pending, error, done, run, router } = useRun();
  const [f, setF] = useState({ name: initial?.name ?? "", code: initial?.code ?? "", category: initial?.category ?? "", costCentre: initial?.costCentre ?? "", phone: initial?.phone ?? "", manager: initial?.managerMembershipId ?? "" });
  const [a, setA] = useState<AddrState>(emptyAddr);
  const idp = initial ? `sf-${initial.id}` : "sf-new";
  return (
    <form className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" data-testid="shop-form" onSubmit={(e) => {
      e.preventDefault();
      run(() => saveBranchAction({ id: initial?.id ?? null, name: f.name, code: f.code || null, category: f.category || null, costCentre: f.costCentre || null, phone: f.phone || null, managerMembershipId: f.manager || null, address: initial ? null : toAddress(a, countryCode, cities) }),
        (d) => { onDone?.(); if (!initial) router.push(`/buy/branches/${d as string}`); }, initial ? t("saved") : undefined);
    }}>
      <div className="space-y-1"><Label htmlFor={`${idp}-n`}>{t("shopName")}</Label><Input id={`${idp}-n`} required maxLength={80} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder={t("shopNameHint")} /></div>
      <div className="space-y-1"><Label htmlFor={`${idp}-cat`}>{t("category")}</Label>
        <Select id={`${idp}-cat`} required value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>
          <option value="" disabled>{t("chooseCategory")}</option>
          {BUSINESS_TYPES.map((b) => <option key={b} value={b}>{tb(`businessTypes.${b}`)}</option>)}
        </Select>
      </div>
      <div className="space-y-1"><Label htmlFor={`${idp}-c`}>{t("code")} <span className="text-muted-foreground">({t("optional")})</span></Label><Input id={`${idp}-c`} maxLength={20} value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} placeholder="LX1" /></div>
      <div className="space-y-1"><Label htmlFor={`${idp}-cc`}>{t("costCentre")} <span className="text-muted-foreground">({t("optional")})</span></Label><Input id={`${idp}-cc`} maxLength={40} value={f.costCentre} onChange={(e) => setF({ ...f, costCentre: e.target.value })} placeholder="CC-100" /></div>
      <div className="space-y-1"><Label htmlFor={`${idp}-ph`}>{t("phone")}</Label><Input id={`${idp}-ph`} maxLength={40} value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></div>
      <div className="space-y-1"><Label htmlFor={`${idp}-m`}>{t("manager")}</Label>
        <Select id={`${idp}-m`} value={f.manager} onChange={(e) => setF({ ...f, manager: e.target.value })}>
          <option value="">{t("noManager")}</option>
          {team.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
        </Select>
      </div>
      {!initial && (
        <>
          <p className="pt-2 text-sm font-semibold sm:col-span-2 lg:col-span-3">{t("shopAddress")}</p>
          <AddressFields a={a} set={setA} cities={cities} idp={idp} />
        </>
      )}
      <div className="flex flex-wrap items-center gap-3 sm:col-span-2 lg:col-span-3">
        <Button type="submit" disabled={pending}><Spin on={pending} icon={initial ? Check : Store} />{initial ? t("save") : t("createShop")}</Button>
        <Msg error={error} done={done} />
      </div>
    </form>
  );
}

/** Another delivery address for a shop. */
export function ShopAddressForm({ branchId, cities, countryCode }: { branchId: string; cities: City[]; countryCode: string }) {
  const t = useTranslations("multisite");
  const ta = useTranslations("addressRequests");
  const { pending, error, run } = useRun();
  const [open, setOpen] = useState(false);
  const [sent, setSent] = useState(false);
  const [label, setLabel] = useState("");
  const [a, setA] = useState<AddrState>(emptyAddr);
  if (!open) return <div className="space-y-1">{sent && <p className="text-xs" role="status" data-testid="shop-address-sent">{ta("sentShop")}</p>}<Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)} data-testid="add-shop-address"><MapPinPlus className="size-4" />{t("addAddress")}</Button></div>;
  return (
    <form className="grid gap-3 rounded-xl border p-3 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); run(() => addShopAddressAction({ branchId, address: toAddress(a, countryCode, cities, label || null) }), (d) => { setSent(!d); setOpen(false); setA(emptyAddr); setLabel(""); }); }}>
      <div className="space-y-1 sm:col-span-2"><Label htmlFor="sa-lb">{t("addressLabel")}</Label><Input id="sa-lb" maxLength={80} value={label} onChange={(e) => setLabel(e.target.value)} placeholder={t("addressLabelHint")} /></div>
      <AddressFields a={a} set={setA} cities={cities} idp="sa" />
      <div className="flex flex-wrap items-center gap-2 sm:col-span-2">
        <Button type="submit" size="sm" disabled={pending}><Spin on={pending} icon={Plus} />{t("addAddress")}</Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>{t("cancel")}</Button>
        <Msg error={error} />
      </div>
    </form>
  );
}

/** Put one of the company's existing delivery addresses in this shop. */
export function AssignAddress({ branchId, addresses }: { branchId: string; addresses: Opt[] }) {
  const t = useTranslations("multisite");
  const { pending, error, run } = useRun();
  const [v, setV] = useState("");
  if (!addresses.length) return null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select aria-label={t("existingAddress")} value={v} onChange={(e) => setV(e.target.value)} className="h-9 w-full sm:w-72">
        <option value="">{t("existingAddress")}</option>
        {addresses.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
      </Select>
      <Button type="button" size="sm" variant="outline" disabled={!v || pending} onClick={() => run(() => setAddressBranchAction({ addressId: v, branchId }), () => setV(""))}><Spin on={pending} icon={Plus} />{t("moveHere")}</Button>
      <Msg error={error} />
    </div>
  );
}

export function RemoveAddress({ addressId }: { addressId: string }) {
  const t = useTranslations("multisite");
  const { pending, run } = useRun();
  return <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={() => run(() => setAddressBranchAction({ addressId, branchId: null }))}>{t("takeOut")}</Button>;
}

/** Staff of a shop: add a team member, remove one. */
export function ShopStaff({ branchId, members, team }: { branchId: string; members: { membershipId: string; name: string; email: string }[]; team: Opt[] }) {
  const t = useTranslations("multisite");
  const { pending, error, run } = useRun();
  const [v, setV] = useState("");
  const free = team.filter((m) => !members.some((x) => x.membershipId === m.id));
  return (
    <div className="space-y-3" data-testid="shop-staff">
      {members.length === 0 ? <p className="text-sm text-muted-foreground">{t("noStaff")}</p> : (
        <ul className="divide-y rounded-xl border">
          {members.map((m) => (
            <li key={m.membershipId} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
              <span className="min-w-0"><span className="font-medium">{m.name}</span> <span className="text-muted-foreground">· {m.email}</span></span>
              <Button type="button" size="sm" variant="ghost" disabled={pending} aria-label={`${t("removeStaff")} ${m.name}`} onClick={() => run(() => setBranchMemberAction({ branchId, membershipId: m.membershipId, on: false }))}><UserMinus className="size-4" /></Button>
            </li>
          ))}
        </ul>
      )}
      {free.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <Select aria-label={t("addStaff")} value={v} onChange={(e) => setV(e.target.value)} className="h-9 w-full sm:w-72" data-testid="staff-select">
            <option value="">{t("addStaff")}</option>
            {free.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
          </Select>
          <Button type="button" size="sm" variant="outline" disabled={!v || pending} onClick={() => run(() => setBranchMemberAction({ branchId, membershipId: v, on: true }), () => setV(""))} data-testid="add-staff"><Spin on={pending} icon={UserPlus} />{t("add")}</Button>
        </div>
      )}
      <p className="text-xs text-muted-foreground">{t("staffHint")}</p>
      <Msg error={error} />
    </div>
  );
}

export function ShopActions({ id, isActive }: { id: string; isActive: boolean }) {
  const t = useTranslations("multisite");
  const { pending, error, run, router } = useRun();
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => run(() => setBranchActiveAction({ id, active: !isActive }))}>{isActive ? <><Ban className="size-4" />{t("deactivate")}</> : <><Play className="size-4" />{t("reactivate")}</>}</Button>
      <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={() => { if (confirm(t("deleteConfirm"))) run(() => deleteBranchAction({ id }), () => router.push("/buy/branches")); }}><Trash2 className="size-4" />{t("delete")}</Button>
      <Msg error={error} />
    </div>
  );
}

export function PoRequiredToggle({ required }: { required: boolean }) {
  const t = useTranslations("multisite");
  const { pending, error, run } = useRun();
  return (
    <div className="space-y-1">
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="size-4" checked={required} disabled={pending} onChange={(e) => run(() => setPoRequiredAction({ required: e.target.checked }))} data-testid="po-required" />{t("poRequired")}</label>
      <p className="text-xs text-muted-foreground">{t("poRequiredHint")}</p>
      <Msg error={error} />
    </div>
  );
}

// ───────────────────────────── budgets ─────────────────────────────

export type BudgetInitial = { id: string; name: string; branchId: string | null; period: "WEEKLY" | "MONTHLY"; amount: string; categoryIds: string[]; action: "APPROVAL" | "BLOCK" | "WARN"; isActive: boolean };

export function BudgetForm({ initial, shops, categories }: { initial?: BudgetInitial; shops: Opt[]; categories: Opt[] }) {
  const t = useTranslations("multisite");
  const { pending, error, done, run } = useRun();
  const blank = { name: "", branchId: "", period: "MONTHLY", amount: "", cats: [] as string[], action: "APPROVAL", isActive: true };
  const [f, setF] = useState(initial ? { name: initial.name, branchId: initial.branchId ?? "", period: initial.period, amount: String(Number(initial.amount)), cats: initial.categoryIds, action: initial.action, isActive: initial.isActive } : blank);
  const idp = initial ? `bf-${initial.id}` : "bf-new";
  return (
    <form className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" data-testid="budget-form" onSubmit={(e) => {
      e.preventDefault();
      run(() => saveBudgetAction({ id: initial?.id ?? null, name: f.name, branchId: f.branchId || null, period: f.period as "MONTHLY", amount: Number(f.amount), categoryIds: f.cats, action: f.action as "APPROVAL", isActive: f.isActive }), () => { if (!initial) setF(blank); }, t("saved"));
    }}>
      <div className="space-y-1"><Label htmlFor={`${idp}-n`}>{t("budgetName")}</Label><Input id={`${idp}-n`} required maxLength={80} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder={t("budgetNameHint")} /></div>
      <div className="space-y-1"><Label htmlFor={`${idp}-s`}>{t("shop")}</Label>
        <Select id={`${idp}-s`} value={f.branchId} onChange={(e) => setF({ ...f, branchId: e.target.value })}>
          <option value="">{t("wholeCompany")}</option>
          {shops.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
        </Select>
      </div>
      <div className="space-y-1"><Label htmlFor={`${idp}-p`}>{t("period")}</Label>
        <Select id={`${idp}-p`} value={f.period} onChange={(e) => setF({ ...f, period: e.target.value })}><option value="MONTHLY">{t("per.MONTHLY")}</option><option value="WEEKLY">{t("per.WEEKLY")}</option></Select>
      </div>
      <div className="space-y-1"><Label htmlFor={`${idp}-a`}>{t("amountInclVat")}</Label><Input id={`${idp}-a`} type="number" min={1} step="0.01" required value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} placeholder="2000" /></div>
      <div className="space-y-1 sm:col-span-2"><Label htmlFor={`${idp}-o`}>{t("overBudget")}</Label>
        <Select id={`${idp}-o`} value={f.action} onChange={(e) => setF({ ...f, action: e.target.value })}>
          {(["APPROVAL", "BLOCK", "WARN"] as const).map((x) => <option key={x} value={x}>{t(`act.${x}`)}</option>)}
        </Select>
      </div>
      <div className="space-y-1 sm:col-span-2"><Label htmlFor={`${idp}-c`}>{t("onlyCategories")} <span className="text-muted-foreground">({t("optional")})</span></Label>
        <Select id={`${idp}-c`} multiple value={f.cats} onChange={(e) => setF({ ...f, cats: Array.from(e.target.selectedOptions).map((o) => o.value) })} className="h-20">{categories.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</Select>
      </div>
      <div className="flex flex-wrap items-center gap-3 sm:col-span-2 lg:col-span-4">
        {initial && <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="size-4" checked={f.isActive} onChange={(e) => setF({ ...f, isActive: e.target.checked })} />{t("active")}</label>}
        <Button type="submit" size="sm" disabled={pending}><Spin on={pending} icon={initial ? Check : Wallet} />{initial ? t("save") : t("addBudget")}</Button>
        {initial && <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={() => { if (confirm(t("deleteBudgetConfirm"))) run(() => deleteBudgetAction({ id: initial.id })); }}><Trash2 className="size-4" />{t("delete")}</Button>}
        <Msg error={error} done={done} />
      </div>
    </form>
  );
}

/** A budget's use as a bar (green → amber at 80 % → red over 100 %). */
export function BudgetBar({ pct, label }: { pct: number; label: string }) {
  const w = Math.min(100, Math.max(0, pct));
  const tone = pct > 100 ? "var(--destructive)" : pct >= 80 ? "var(--vivid-amber, #f59e0b)" : "var(--vivid-teal, #14b8a6)";
  return (
    <div className="space-y-1" title={label}>
      <div className="h-2.5 w-full overflow-hidden rounded-full bg-[color-mix(in_oklch,var(--vivid-blue)_8%,transparent)]" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)} aria-label={label}>
        <div className="motion-grow-x h-2.5 rounded-full" style={{ width: `${w}%`, background: tone }} />
      </div>
    </div>
  );
}

type Check = { id: string; name: string; period: "WEEKLY" | "MONTHLY"; action: "APPROVAL" | "BLOCK" | "WARN"; amount: string; spent: string; adding: string; projected: string; pct: number; exceeded: boolean };

/** In the checkout: what this order does to the budgets of the shop of the chosen address. */
export function CheckoutBudgets({ addressId, locale }: { addressId: string; locale: string }) {
  const t = useTranslations("multisite");
  const [rows, setRows] = useState<Check[]>([]);
  useEffect(() => {
    let live = true;
    if (!addressId) { setRows([]); return; }
    budgetPreviewAction({ addressId }).then((r) => { if (live && r.ok) setRows(r.data as Check[]); });
    return () => { live = false; };
  }, [addressId]);
  if (!rows.length) return null;
  const money = new Intl.NumberFormat(locale, { style: "currency", currency: "EUR" });
  return (
    <div className="space-y-2 rounded-xl border p-3" data-testid="checkout-budgets">
      {rows.map((b) => (
        <div key={b.id} className="space-y-1 text-sm">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="font-medium">{b.name} <span className="text-xs font-normal text-muted-foreground">· {t(`per.${b.period}`)}</span></span>
            <span className="tabular-nums text-xs">{money.format(Number(b.projected))} / {money.format(Number(b.amount))}</span>
          </div>
          <BudgetBar pct={b.pct} label={`${b.name}: ${b.pct}%`} />
          {b.exceeded && <p className={`text-xs ${b.action === "BLOCK" ? "text-destructive" : "text-[color:var(--vivid-amber,#b45309)]"}`} role="status">{t(`over.${b.action}`)}</p>}
        </div>
      ))}
    </div>
  );
}

// ───────────────────────────── FIRINGI ─────────────────────────────

/** FIRINGI back office (English): a company's optional feature on / off. */
export function FeatureSwitch({ companyId, enabled, label, feature = "ACCOUNTING" }: { companyId: string; enabled: boolean; label: string; feature?: "ACCOUNTING" | "ASSISTANT" | "ASSISTANT_PHOTOS" | "LOYALTY" | "ADS" | "CHAT" | "CHAT_MASK" }) {
  const { pending, error, run } = useRun();
  return (
    <span className="inline-flex items-center gap-2">
      <button type="button" role="switch" aria-checked={enabled} aria-label={label} disabled={pending} data-testid={feature === "ACCOUNTING" ? "feature-switch" : feature === "ASSISTANT" ? "assistant-switch" : feature === "LOYALTY" ? "loyalty-switch" : feature === "ADS" ? "ads-switch" : feature === "CHAT" ? "chat-switch" : feature === "CHAT_MASK" ? "chat-mask-switch" : "photos-switch"}
        onClick={() => run(() => setCompanyFeatureAction({ companyId, key: feature, enabled: !enabled }))}
        className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-60 ${enabled ? "bg-[linear-gradient(90deg,var(--vivid-teal),var(--vivid-blue))]" : "bg-muted-foreground/30"}`}>
        <span className={`inline-block size-5 rounded-full bg-white shadow transition-transform ${enabled ? "translate-x-5" : "translate-x-0.5"}`} />
      </button>
      {error && <span className="text-xs text-destructive">{error}</span>}
    </span>
  );
}
