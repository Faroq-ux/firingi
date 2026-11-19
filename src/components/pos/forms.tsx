"use client";
/** Phase 47 — the till's set-up forms: items and recipes, tills, receipts and loyalty, the certified provider, PINs, guests, refunds. */
import { useState } from "react";
import { useTranslations } from "next-intl";
import { Download, Plug, Plus, RefreshCw, RotateCcw, Save, ShoppingCart, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";
import { Msg, Spin, useRun } from "@/components/shared/run";
import { ALLERGENS } from "@/lib/food";
import { newClientId } from "@/lib/offline/store";
import { checkTaxId } from "@/lib/tax-id";
import {
  importCatalogueAction, posRefundAction, reorderAction, retryPosFiscalAction, saveFiscalConnectionAction, saveItemAction, saveMemberAction, savePosCompanyAction,
  saveRecipeAction, saveRegisterAction, setPinAction, setRegisterUsersAction, setSaleTaxIdAction, testFiscalAction,
} from "@/server/actions/pos";

const num = (v: string) => Number(String(v).replace(",", ".")) || 0;

export type ItemRow = {
  id: string; name: string; category: string | null; barcode: string | null; plu: string | null; price: string | number; vatRate: string | number; byWeight: boolean;
  offerId: string | null; stockPerUnit: string | number; restriction: string | null; allergens: string[]; color: string | null; quick: boolean; kitchen: boolean; active: boolean;
  recipe: { offerId: string; qty: string | number; unit: string }[]; stock: number | null; registerIds: string[];
};

export function ItemForm({ item, offers, customer, tills = [], onDone }: { item?: ItemRow | null; offers: { id: string; name: string }[]; customer: boolean; tills?: { id: string; label: string }[]; onDone?: () => void }) {
  const t = useTranslations("pos");
  const tf = useTranslations("food");
  const { pending, error, done, run } = useRun();
  const [x, setX] = useState({
    name: item?.name ?? "", category: item?.category ?? "", barcode: item?.barcode ?? "", plu: item?.plu ?? "", price: String(item?.price ?? ""), vatRate: String(item?.vatRate ?? (customer ? "13" : "23")),
    byWeight: item?.byWeight ?? false, offerId: item?.offerId ?? "", stockPerUnit: String(item?.stockPerUnit ?? "1"), restriction: item?.restriction ?? "", allergens: item?.allergens ?? [],
    color: item?.color ?? "", quick: item?.quick ?? true, kitchen: item?.kitchen ?? false, active: item?.active ?? true, registerIds: item?.registerIds ?? [],
  });
  const f = (k: keyof typeof x, label: string, extra: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <div className="min-w-0 space-y-1"><Label htmlFor={`pi-${k}`}>{label}</Label><Input id={`pi-${k}`} value={String(x[k])} onChange={(e) => setX({ ...x, [k]: e.target.value })} data-testid={`pi-${k}`} {...extra} /></div>
  );
  const box = (k: "byWeight" | "quick" | "kitchen" | "active", label: string) => (
    <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={x[k]} onChange={(e) => setX({ ...x, [k]: e.target.checked })} data-testid={`pi-${k}`} /> {label}</label>
  );
  return (
    <form className="space-y-3" data-testid="pos-item-form" onSubmit={(e) => { e.preventDefault(); run(() => saveItemAction({ id: item?.id ?? null, name: x.name, category: x.category || null, barcode: x.barcode || null, plu: x.plu || null, price: num(x.price), vatRate: num(x.vatRate), byWeight: x.byWeight, offerId: x.offerId || null, stockPerUnit: num(x.stockPerUnit) || 1, restriction: (x.restriction || null) as "ALCOHOL" | "TOBACCO" | null, allergens: x.allergens, color: x.color || null, quick: x.quick, kitchen: x.kitchen, active: x.active, registerIds: x.registerIds }), () => onDone?.(), t("saved")); }}>
      <div className="grid gap-3 sm:grid-cols-3">
        {f("name", t("name"), { required: true })}
        {f("category", t("category"))}
        {f("price", x.byWeight ? t("pricePerKg") : t("priceInclVat"), { inputMode: "decimal", required: true })}
        {f("vatRate", t("vatRate"), { inputMode: "decimal" })}
        {f("barcode", t("barcode"))}
        {f("plu", t("plu"), { inputMode: "numeric" })}
        {!customer && (
          <div className="min-w-0 space-y-1"><Label htmlFor="pi-offer">{t("ownProduct")}</Label>
            <Select id="pi-offer" value={x.offerId} onChange={(e) => setX({ ...x, offerId: e.target.value })} data-testid="pi-offer"><option value="">—</option>{offers.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</Select></div>
        )}
        {!customer && x.offerId && f("stockPerUnit", t("stockPerUnit"), { inputMode: "decimal" })}
        <div className="min-w-0 space-y-1"><Label htmlFor="pi-restriction">{t("ageRestriction")}</Label>
          <Select id="pi-restriction" value={x.restriction} onChange={(e) => setX({ ...x, restriction: e.target.value })} data-testid="pi-restriction"><option value="">—</option><option value="ALCOHOL">{t("alcohol")}</option><option value="TOBACCO">{t("tobacco")}</option></Select></div>
        <div className="min-w-0 space-y-1"><Label htmlFor="pi-color">{t("color")}</Label><Input id="pi-color" type="color" value={x.color || "#3b6cf6"} onChange={(e) => setX({ ...x, color: e.target.value })} /></div>
      </div>
      {tills.length > 1 && (
        <fieldset className="rounded-lg border p-2 text-sm" data-testid="pi-tills"><legend className="px-1 text-xs text-muted-foreground">{t("itemTills")}</legend>
          <div className="flex flex-wrap gap-3">
            <label className="flex items-center gap-1"><input type="checkbox" checked={!x.registerIds.length} onChange={() => setX({ ...x, registerIds: [] })} /> {t("allTills")}</label>
            {tills.map((r) => <label key={r.id} className="flex items-center gap-1"><input type="checkbox" checked={x.registerIds.includes(r.id)} onChange={(e) => setX({ ...x, registerIds: e.target.checked ? [...x.registerIds, r.id] : x.registerIds.filter((y) => y !== r.id) })} data-testid={`pi-till-${r.id}`} /> {r.label}</label>)}
          </div>
        </fieldset>
      )}
      <div className="flex flex-wrap gap-4">{box("byWeight", t("byWeight"))}{box("quick", t("quickButton"))}{box("kitchen", t("kitchenItem"))}{box("active", t("active"))}</div>
      <details className="text-sm"><summary className="cursor-pointer">{t("allergens")} ({x.allergens.length})</summary>
        <div className="mt-2 flex flex-wrap gap-2">{ALLERGENS.map((a) => <label key={a} className="flex items-center gap-1"><input type="checkbox" checked={x.allergens.includes(a)} onChange={(e) => setX({ ...x, allergens: e.target.checked ? [...x.allergens, a] : x.allergens.filter((y) => y !== a) })} /> {tf(`a.${a}`)}</label>)}</div>
      </details>
      <div className="flex items-center gap-3"><Button type="submit" disabled={pending} data-testid="pi-save"><Spin on={pending} icon={Save} /> {t("save")}</Button><Msg error={error} done={done} /></div>
    </form>
  );
}

export function RecipeForm({ itemId, lines, purchased }: { itemId: string; lines: { offerId: string; qty: string | number; unit: string }[]; purchased: { offerId: string; name: string; packsLeft: number; netWeightKg: number | null; unitsPerPack: number | null }[] }) {
  const t = useTranslations("pos");
  const { pending, error, done, run } = useRun();
  const [rows, setRows] = useState(lines.map((l) => ({ offerId: l.offerId, qty: String(l.qty), unit: l.unit })));
  return (
    <div className="space-y-2" data-testid="pos-recipe">
      {rows.map((r, i) => (
        <div key={i} className="grid gap-2 sm:grid-cols-[1fr_7rem_7rem_auto]">
          <Select value={r.offerId} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, offerId: e.target.value } : x)))} data-testid="pr-offer"><option value="">{t("chooseIngredient")}</option>{purchased.map((p) => <option key={p.offerId} value={p.offerId}>{p.name}</option>)}</Select>
          <Input inputMode="decimal" value={r.qty} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, qty: e.target.value } : x)))} data-testid="pr-qty" />
          <Select value={r.unit} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, unit: e.target.value } : x)))} data-testid="pr-unit"><option value="KG">kg</option><option value="PCS">{t("pieces")}</option><option value="PACK">{t("packs")}</option></Select>
          <Button size="icon" variant="ghost" onClick={() => setRows(rows.filter((_, j) => j !== i))} aria-label={t("remove")}><Trash2 className="size-4" /></Button>
        </div>
      ))}
      {purchased.length === 0 && <p className="text-xs text-muted-foreground">{t("recipeNoPurchases")}</p>}
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" disabled={!purchased.length} onClick={() => setRows([...rows, { offerId: "", qty: "0.1", unit: "KG" }])} data-testid="pr-add"><Plus className="size-4" /> {t("addIngredient")}</Button>
        <Button size="sm" disabled={pending} onClick={() => run(() => saveRecipeAction({ itemId, lines: rows.filter((r) => r.offerId).map((r) => ({ offerId: r.offerId, qty: num(r.qty), unit: r.unit as "KG" | "PCS" | "PACK" })) }), undefined, t("saved"))} data-testid="pr-save"><Spin on={pending} icon={Save} /> {t("saveRecipe")}</Button>
        <Msg error={error} done={done} />
      </div>
    </div>
  );
}

export function ImportButton() {
  const t = useTranslations("pos");
  const { pending, error, done, run } = useRun();
  const [n, setN] = useState<number | null>(null);
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <Button variant="outline" disabled={pending} onClick={() => run(() => importCatalogueAction({}), (d) => setN((d as { added: number }).added))} data-testid="pos-import"><Spin on={pending} icon={Download} /> {t("importCatalogue")}</Button>
      {n !== null && <span className="text-sm" data-testid="pos-import-result">{t("importedN", { n })}</span>}
      <Msg error={error} done={done} />
    </span>
  );
}

export function RegisterForm({ reg, warehouses, branches, vendor }: { reg?: { id: string; name: string; code: string; addressId: string | null; branchId?: string | null; active: boolean } | null; warehouses: { id: string; label: string; cityName: string }[]; branches: { id: string; name: string }[]; vendor: boolean }) {
  const t = useTranslations("pos");
  const { pending, error, done, run } = useRun();
  const [x, setX] = useState({ name: reg?.name ?? "", code: reg?.code ?? "", addressId: reg?.addressId ?? warehouses[0]?.id ?? "", branchId: reg?.branchId ?? "", active: reg?.active ?? true });
  return (
    <form className="grid gap-2 sm:grid-cols-[1fr_6rem_1fr_auto_auto] sm:items-end" data-testid="pos-register-form" onSubmit={(e) => { e.preventDefault(); run(() => saveRegisterAction({ id: reg?.id ?? null, name: x.name, code: x.code, addressId: vendor ? x.addressId || null : null, branchId: branches.length ? x.branchId || null : undefined, active: x.active }), () => { if (!reg) setX({ name: "", code: "", addressId: x.addressId, branchId: x.branchId, active: true }); }, t("saved")); }}>
      <div className="space-y-1"><Label>{t("tillName")}</Label><Input value={x.name} onChange={(e) => setX({ ...x, name: e.target.value })} data-testid="preg-name" /></div>
      <div className="space-y-1"><Label>{t("tillCode")}</Label><Input value={x.code} maxLength={6} onChange={(e) => setX({ ...x, code: e.target.value.toUpperCase() })} data-testid="preg-code" /></div>
      {vendor ? <div className="space-y-1"><Label>{t("stockFrom")}</Label><Select value={x.addressId} onChange={(e) => setX({ ...x, addressId: e.target.value })} data-testid="preg-address">{warehouses.map((w) => <option key={w.id} value={w.id}>{w.label} · {w.cityName}</option>)}</Select></div>
        : branches.length ? <div className="space-y-1"><Label>{t("shopLabel")}</Label><Select value={x.branchId} onChange={(e) => setX({ ...x, branchId: e.target.value })} data-testid="preg-branch"><option value="">—</option>{branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</Select></div> : <span />}
      <label className="flex items-center gap-2 pb-2 text-sm"><input type="checkbox" checked={x.active} onChange={(e) => setX({ ...x, active: e.target.checked })} /> {t("active")}</label>
      <Button type="submit" disabled={pending} data-testid="preg-save"><Spin on={pending} icon={Save} /> {reg ? t("save") : t("addTill")}</Button>
      <div className="sm:col-span-5"><Msg error={error} done={done} /></div>
    </form>
  );
}

/** Who uses this till: nobody ticked = everyone with the till right; ticked = only them (and the owner). */
export function RegisterPeople({ registerId, people, current }: { registerId: string; people: { userId: string; name: string }[]; current: { userId: string; role: string }[] }) {
  const t = useTranslations("pos");
  const { pending, error, done, run } = useRun();
  const [x, setX] = useState<Record<string, string>>(Object.fromEntries(people.map((p) => [p.userId, current.find((c) => c.userId === p.userId)?.role ?? ""])));
  return (
    <details className="rounded-lg border p-2 text-sm" data-testid={`preg-people-${registerId}`}>
      <summary className="cursor-pointer">{t("tillPeople")} ({Object.values(x).filter(Boolean).length || t("tillPeopleAll")})</summary>
      <p className="my-2 text-xs text-muted-foreground">{t("tillPeopleHelp")}</p>
      <div className="grid gap-1 sm:grid-cols-2">
        {people.map((p) => (
          <label key={p.userId} className="flex items-center justify-between gap-2 rounded border px-2 py-1">
            <span className="min-w-0 break-words">{p.name}</span>
            <Select className="w-36" value={x[p.userId]} onChange={(e) => setX({ ...x, [p.userId]: e.target.value })} data-testid={`preg-role-${registerId}-${p.userId}`}>
              <option value="">—</option><option value="SELL">{t("cashier")}</option><option value="MANAGE">{t("manager")}</option>
            </Select>
          </label>
        ))}
      </div>
      <div className="mt-2 flex items-center gap-3">
        <Button size="sm" disabled={pending} onClick={() => run(() => setRegisterUsersAction({ registerId, users: Object.entries(x).filter(([, r]) => r).map(([userId, role]) => ({ userId, role: role as "SELL" | "MANAGE" })) }), undefined, t("saved"))} data-testid={`preg-people-save-${registerId}`}><Spin on={pending} icon={Save} /> {t("save")}</Button>
        <Msg error={error} done={done} />
      </div>
    </details>
  );
}

export function CompanyForm({ c, currency }: { c: { receiptHeader: string | null; receiptFooter: string | null; loyaltyOn: boolean; pointsPerUnit: unknown; pointValue: unknown; minRedeem: number; discountLimit: unknown; refundDays: number; emailReceipts: boolean; postToAccounting: boolean }; currency: string }) {
  const t = useTranslations("pos");
  const { pending, error, done, run } = useRun();
  const [x, setX] = useState({ receiptHeader: c.receiptHeader ?? "", receiptFooter: c.receiptFooter ?? "", loyaltyOn: c.loyaltyOn, pointsPerUnit: String(c.pointsPerUnit), pointValue: String(c.pointValue), minRedeem: String(c.minRedeem), discountLimit: String(c.discountLimit), refundDays: String(c.refundDays), emailReceipts: c.emailReceipts, postToAccounting: c.postToAccounting });
  const f = (k: keyof typeof x, label: string, extra: React.InputHTMLAttributes<HTMLInputElement> = {}) => <div className="min-w-0 space-y-1"><Label htmlFor={`pc-${k}`}>{label}</Label><Input id={`pc-${k}`} value={String(x[k])} onChange={(e) => setX({ ...x, [k]: e.target.value })} data-testid={`pc-${k}`} {...extra} /></div>;
  const box = (k: "loyaltyOn" | "emailReceipts" | "postToAccounting", label: string) => <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-0.5" checked={x[k]} onChange={(e) => setX({ ...x, [k]: e.target.checked })} data-testid={`pc-${k}`} /> <span>{label}</span></label>;
  return (
    <form className="space-y-3" data-testid="pos-company-form" onSubmit={(e) => { e.preventDefault(); run(() => savePosCompanyAction({ receiptHeader: x.receiptHeader || null, receiptFooter: x.receiptFooter || null, loyaltyOn: x.loyaltyOn, pointsPerUnit: num(x.pointsPerUnit), pointValue: num(x.pointValue), minRedeem: Math.round(num(x.minRedeem)), discountLimit: num(x.discountLimit), refundDays: Math.round(num(x.refundDays)), emailReceipts: x.emailReceipts, postToAccounting: x.postToAccounting }), undefined, t("saved")); }}>
      <div className="grid gap-3 sm:grid-cols-2">{f("receiptHeader", t("receiptHeader"))}{f("receiptFooter", t("receiptFooter"))}</div>
      <div className="grid gap-3 sm:grid-cols-2">{f("discountLimit", t("discountLimit"), { inputMode: "decimal" })}{f("refundDays", t("refundDays"), { inputMode: "numeric" })}</div>
      {box("emailReceipts", t("emailReceiptsOn"))}
      {box("postToAccounting", t("postToAccounting"))}
      <div className="rounded-lg border p-3">
        {box("loyaltyOn", t("loyaltyOn"))}
        {x.loyaltyOn && <div className="mt-3 grid gap-3 sm:grid-cols-3">{f("pointsPerUnit", t("pointsPerUnit", { cur: currency }), { inputMode: "decimal" })}{f("pointValue", t("pointValue", { cur: currency }), { inputMode: "decimal" })}{f("minRedeem", t("minRedeem"), { inputMode: "numeric" })}</div>}
      </div>
      <div className="flex items-center gap-3"><Button type="submit" disabled={pending} data-testid="pc-save"><Spin on={pending} icon={Save} /> {t("save")}</Button><Msg error={error} done={done} /></div>
    </form>
  );
}

export function FiscalForm({ providers, current, account, hint, testOk }: { providers: { key: string; name: string; about: string }[]; current: string | null; account: string | null; hint: string | null; testOk: boolean | null }) {
  const t = useTranslations("pos");
  const { pending, error, done, run } = useRun();
  const [x, setX] = useState({ provider: current ?? providers[0]?.key ?? "", account: account ?? "", secret: "" });
  const [test, setTest] = useState<string | null>(null);
  return (
    <div className="space-y-3" data-testid="pos-fiscal-form">
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="min-w-0 space-y-1"><Label htmlFor="pf-provider">{t("provider")}</Label><Select id="pf-provider" value={x.provider} onChange={(e) => setX({ ...x, provider: e.target.value })} data-testid="pf-provider">{providers.map((p) => <option key={p.key} value={p.key}>{p.name}</option>)}</Select></div>
        <div className="min-w-0 space-y-1"><Label htmlFor="pf-account">{t("providerAccount")}</Label><Input id="pf-account" value={x.account} onChange={(e) => setX({ ...x, account: e.target.value })} data-testid="pf-account" /></div>
        <div className="min-w-0 space-y-1"><Label htmlFor="pf-secret">{t("providerSecret")}</Label><Input id="pf-secret" type="password" autoComplete="off" placeholder={hint ?? ""} value={x.secret} onChange={(e) => setX({ ...x, secret: e.target.value })} data-testid="pf-secret" /></div>
      </div>
      <p className="text-xs text-muted-foreground">{providers.find((p) => p.key === x.provider)?.about}</p>
      <div className="flex flex-wrap items-center gap-2">
        <Button disabled={pending || !x.secret} onClick={() => run(() => saveFiscalConnectionAction({ provider: x.provider as "moloni", account: x.account, secret: x.secret }), (d) => { const r = d as { test?: { ok: boolean; error?: string } }; setTest(r.test?.ok ? t("testOk") : r.test?.error ?? null); setX({ ...x, secret: "" }); }, t("saved"))} data-testid="pf-save"><Spin on={pending} icon={Plug} /> {t("connect")}</Button>
        {current && <Button variant="outline" disabled={pending} onClick={() => run(() => testFiscalAction({}), (d) => { const r = d as { ok: boolean; error?: string }; setTest(r.ok ? t("testOk") : r.error ?? t("error")); })} data-testid="pf-test"><RefreshCw className="size-4" /> {t("testConnection")}</Button>}
        {current && <Button variant="ghost" disabled={pending} onClick={() => run(() => saveFiscalConnectionAction({ provider: null, account: "", secret: "" }), undefined, t("disconnected"))} data-testid="pf-disconnect">{t("disconnect")}</Button>}
        {testOk !== null && !test && <span className="text-sm" data-testid="pf-status">{testOk ? t("testOk") : t("testFailed")}</span>}
        {test && <span className="text-sm" data-testid="pf-status">{test}</span>}
      </div>
      <Msg error={error} done={done} />
    </div>
  );
}

export function PinForm({ userId, self }: { userId: string; self: boolean }) {
  const t = useTranslations("pos");
  const { pending, error, done, run } = useRun();
  const [pin, setPin] = useState("");
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <Input className="w-28" type="password" inputMode="numeric" maxLength={8} placeholder={self ? t("myPin") : t("newPin")} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))} data-testid={`ppin-${userId}`} />
      <Button size="sm" variant="outline" disabled={pending || pin.length < 4} onClick={() => run(() => setPinAction({ userId, pin }), () => setPin(""), t("saved"))} data-testid={`ppin-save-${userId}`}>{t("setPin")}</Button>
      <Msg error={error} done={done} />
    </span>
  );
}

export function GuestForm() {
  const t = useTranslations("pos");
  const { pending, error, done, run } = useRun();
  const [x, setX] = useState({ name: "", phone: "", email: "", code: "", consent: false });
  return (
    <form className="space-y-2" data-testid="pos-guest-form" onSubmit={(e) => { e.preventDefault(); run(() => saveMemberAction({ name: x.name, phone: x.phone || null, email: x.email || null, code: x.code || null, consent: x.consent }), () => setX({ name: "", phone: "", email: "", code: "", consent: false }), t("saved")); }}>
      <div className="grid gap-2 sm:grid-cols-4">
        <Input placeholder={t("name")} value={x.name} onChange={(e) => setX({ ...x, name: e.target.value })} data-testid="pg-name" />
        <Input placeholder={t("phone")} value={x.phone} onChange={(e) => setX({ ...x, phone: e.target.value })} data-testid="pg-phone" />
        <Input placeholder={t("email")} value={x.email} onChange={(e) => setX({ ...x, email: e.target.value })} data-testid="pg-email" />
        <Input placeholder={t("cardNumber")} value={x.code} onChange={(e) => setX({ ...x, code: e.target.value })} data-testid="pg-code" />
      </div>
      <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-0.5" checked={x.consent} onChange={(e) => setX({ ...x, consent: e.target.checked })} data-testid="pg-consent" /> <span>{t("guestConsent")}</span></label>
      <div className="flex items-center gap-3"><Button type="submit" disabled={pending} data-testid="pg-save"><Spin on={pending} icon={Plus} /> {t("addGuest")}</Button><Msg error={error} done={done} /></div>
    </form>
  );
}

export function RefundForm({ sale, registers }: { sale: { id: string; lines: { id: string; name: string; qty: string; left: string; gross: string }[]; payments: { method: string }[] }; registers: { id: string; name: string; shiftId: string | null; shiftNumber: number | null; sold: number }[] }) {
  const t = useTranslations("pos");
  const { pending, error, done, run } = useRun();
  const open = registers.filter((r) => r.shiftId);
  const [reg, setReg] = useState(open[0]?.id ?? "");
  const [qty, setQty] = useState<Record<string, string>>(Object.fromEntries(sale.lines.map((l) => [l.id, "0"])));
  const [method, setMethod] = useState(sale.payments[0]?.method ?? "CASH");
  const [reason, setReason] = useState("");
  const [restock, setRestock] = useState(true);
  if (!open.length) return <p className="text-sm text-muted-foreground" data-testid="pos-refund-noshift">{t("refundNeedsShift")}</p>;
  const r = open.find((x) => x.id === reg)!;
  return (
    <div className="space-y-2" data-testid="pos-refund">
      {sale.lines.map((l) => <div key={l.id} className="flex items-center gap-2 text-sm"><span className="min-w-0 flex-1 break-words">{l.name} <span className="text-xs text-muted-foreground">({t("refundLeft", { n: l.left })})</span></span><Input className="w-24" inputMode="decimal" value={qty[l.id]} onChange={(e) => setQty({ ...qty, [l.id]: e.target.value })} data-testid="prf-qty" /></div>)}
      <div className="grid gap-2 sm:grid-cols-3">
        <Select value={reg} onChange={(e) => setReg(e.target.value)} data-testid="prf-register">{open.map((x) => <option key={x.id} value={x.id}>{x.name} · {t("shiftN", { n: x.shiftNumber ?? 0 })}</option>)}</Select>
        <Select value={method} onChange={(e) => setMethod(e.target.value)} data-testid="prf-method"><option value="CASH">{t("payCash")}</option><option value="CARD">{t("payCard")}</option><option value="MBWAY">MB WAY</option><option value="OTHER">{t("payOther")}</option></Select>
        <Input placeholder={t("reason")} value={reason} onChange={(e) => setReason(e.target.value)} data-testid="prf-reason" />
      </div>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={restock} onChange={(e) => setRestock(e.target.checked)} data-testid="prf-restock" /> {t("restock")}</label>
      <div className="flex items-center gap-3">
        <Button variant="destructive" disabled={pending || !reason} onClick={() => run(() => posRefundAction({ clientId: newClientId(), saleId: sale.id, registerId: r.id, shiftId: r.shiftId!, n: r.sold + 1, lines: Object.entries(qty).filter(([, v]) => num(v) > 0).map(([lineId, v]) => ({ lineId, qty: num(v) })), method: method as "CASH", reason, restock }), undefined, t("refunded"))} data-testid="prf-save"><Spin on={pending} icon={RotateCcw} /> {t("refund")}</Button>
        <Msg error={error} done={done} />
      </div>
    </div>
  );
}

export function RetryButton({ id, admin }: { id: string; admin?: boolean }) {
  const t = useTranslations("pos");
  const { pending, error, run } = useRun();
  return <span className="inline-flex items-center gap-2"><Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => (admin ? import("@/server/actions/pos").then((m) => m.adminRetryPosFiscalAction({ id })) : retryPosFiscalAction({ id })))} data-testid="pos-retry"><Spin on={pending} icon={RefreshCw} /> {admin ? "Send again" : t("sendAgain")}</Button>{error && <span className="text-xs text-destructive">{error}</span>}</span>;
}

export function ReorderButton({ offerId, qty }: { offerId: string; qty: number }) {
  const t = useTranslations("pos");
  const { pending, error, done, run } = useRun();
  const [n, setN] = useState(String(Math.max(1, qty)));
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <Input className="w-16" inputMode="numeric" value={n} onChange={(e) => setN(e.target.value.replace(/\D/g, ""))} data-testid="pst-qty" />
      <Button size="sm" variant="outline" disabled={pending || !Number(n)} onClick={() => run(() => reorderAction({ offerId, qty: Number(n) }), undefined, t("addedToCart"))} data-testid="pst-reorder"><Spin on={pending} icon={ShoppingCart} /> {t("addToCart")}</Button>
      <Msg error={error} done={done} />
    </span>
  );
}

/** Add the customer's NIF to a receipt that isn't certified yet (the customer asked after paying). */
export function SaleNifForm({ saleId, country }: { saleId: string; country: string }) {
  const tr = useTranslations("posReceipt");
  const { pending, error, done, run } = useRun();
  const [v, setV] = useState("");
  const [n, setN] = useState("");
  const c = v.trim() ? checkTaxId(v, country) : null;
  return (
    <form className="space-y-2" data-testid="pos-sale-nif" onSubmit={(e) => { e.preventDefault(); run(() => setSaleTaxIdAction({ saleId, taxId: v, name: n || null }), () => { setV(""); setN(""); }, tr("nifAdded")); }}>
      <div className="grid gap-2 sm:grid-cols-2">
        <div><Label htmlFor="psn-nif">{tr("nif")}</Label><Input id="psn-nif" value={v} onChange={(e) => setV(e.target.value)} aria-invalid={c ? !c.ok : undefined} data-testid="psn-nif" />
          {c && !c.ok && <p className="mt-1 text-xs text-destructive" role="alert">{c.reason === "checksum" ? tr("nifInvalid") : tr("nifFormat")}</p>}</div>
        <div><Label htmlFor="psn-name">{tr("nifName")}</Label><Input id="psn-name" value={n} onChange={(e) => setN(e.target.value)} data-testid="psn-name" /></div>
      </div>
      <div className="flex flex-wrap items-center gap-3"><Button type="submit" variant="outline" disabled={pending || !c?.ok} data-testid="psn-save"><Spin on={pending} icon={Save} /> {tr("nifAdd")}</Button><Msg error={error} done={done} /></div>
    </form>
  );
}
