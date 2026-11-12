"use client";
/** The company's own accounting (Phase 27): daily close, expenses with receipt, fixed monthly expenses. Texts: "accounting". */
import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Ban, CalendarClock, Camera, Check, Play, Plus, Printer, Save, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";
import { Msg, Spin, useRun, type Opt } from "@/components/shared/run";
import { addEntryAction, dailySalesAction, deleteEntryAction, saveDailySalesAction, saveRecurringExpenseAction, setRecurringExpenseActiveAction } from "@/server/actions/accounting";

const EXPENSES = ["OTHER_SUPPLIERS", "RENT", "ELECTRICITY", "WATER", "GAS", "TELECOM", "SALARIES", "SOCIAL_SECURITY", "INSURANCE", "MAINTENANCE", "MARKETING", "BANK_FEES", "TAXES_FEES", "ACCOUNTANT", "TRANSPORT", "OTHER"] as const;
const VATS = ["", "0", "6", "13", "23"];
const num = (s: string) => (s.trim() === "" ? 0 : Number(s.replace(",", ".")));

function VatSelect({ id, value, onChange, name }: { id: string; value?: string; onChange?: (v: string) => void; name?: string }) {
  const t = useTranslations("accounting");
  return (
    <Select id={id} name={name} value={value} onChange={onChange ? (e) => onChange(e.target.value) : undefined} defaultValue={onChange ? undefined : ""}>
      {VATS.map((v) => <option key={v} value={v}>{v === "" ? t("vatUnknown") : `${v} %`}</option>)}
    </Select>
  );
}

function ShopSelect({ id, shops, value, onChange, name, required }: { id: string; shops: Opt[]; value?: string; onChange?: (v: string) => void; name?: string; required?: boolean }) {
  const t = useTranslations("accounting");
  if (!shops.length) return null;
  return (
    <div className="space-y-1"><Label htmlFor={id}>{t("shop")}</Label>
      <Select id={id} name={name} value={value} required={required} onChange={onChange ? (e) => onChange(e.target.value) : undefined} defaultValue={onChange ? undefined : ""}>
        {!required && <option value="">{t("wholeCompany")}</option>}
        {required && <option value="" disabled>{t("chooseShop")}</option>}
        {shops.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
      </Select>
    </div>
  );
}

/** The day's close: sales per payment method for a day (and shop). Saving the same day again replaces it. */
export function DailyCloseForm({ shops, mustPickShop, today, locale }: { shops: Opt[]; mustPickShop: boolean; today: string; locale: string }) {
  const t = useTranslations("accounting");
  const { pending, error, done, run } = useRun();
  const [date, setDate] = useState(today);
  const [shop, setShop] = useState(mustPickShop ? shops[0]?.id ?? "" : "");
  const [f, setF] = useState({ cash: "", card: "", deliveryApps: "", other: "", vat: "", note: "" });
  const [loaded, setLoaded] = useState(false);
  // what the person typed since the day / shop changed wins over the figures loaded for it
  const edited = useRef(false);
  useEffect(() => {
    let live = true;
    setLoaded(false);
    edited.current = false;
    dailySalesAction({ date, branchId: shop || null }).then((r) => {
      if (!live || !r.ok || edited.current) return;
      const d = r.data as { cash: number; card: number; deliveryApps: number; other: number; vatRate: number | null };
      const s = (n: number) => (n ? String(n) : "");
      setF((x) => ({ ...x, cash: s(d.cash), card: s(d.card), deliveryApps: s(d.deliveryApps), other: s(d.other), vat: d.vatRate !== null ? String(d.vatRate) : x.vat }));
      setLoaded(d.cash + d.card + d.deliveryApps + d.other > 0);
    });
    return () => { live = false; };
  }, [date, shop]);
  const total = num(f.cash) + num(f.card) + num(f.deliveryApps) + num(f.other);
  const money = new Intl.NumberFormat(locale, { style: "currency", currency: "EUR" });
  const field = (k: "cash" | "card" | "deliveryApps" | "other", label: string) => (
    <div className="space-y-1"><Label htmlFor={`dc-${k}`}>{label}</Label><Input id={`dc-${k}`} type="number" inputMode="decimal" min={0} step="0.01" value={f[k]} onChange={(e) => { edited.current = true; setF((x) => ({ ...x, [k]: e.target.value })); }} placeholder="0,00" className="text-right tabular-nums" /></div>
  );
  return (
    <form className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" data-testid="daily-close" onSubmit={(e) => {
      e.preventDefault();
      run(() => saveDailySalesAction({ date, branchId: shop || null, vatRate: f.vat === "" ? null : Number(f.vat), cash: num(f.cash), card: num(f.card), deliveryApps: num(f.deliveryApps), other: num(f.other), note: f.note || null }), () => setLoaded(true), t("daySaved"));
    }}>
      <div className="space-y-1"><Label htmlFor="dc-date">{t("date")}</Label><Input id="dc-date" type="date" required max={today} value={date} onChange={(e) => setDate(e.target.value)} /></div>
      <ShopSelect id="dc-shop" shops={shops} value={shop} onChange={setShop} required={mustPickShop} />
      <div className="space-y-1"><Label htmlFor="dc-vat">{t("vatRate")}</Label><VatSelect id="dc-vat" value={f.vat} onChange={(v) => { edited.current = true; setF((x) => ({ ...x, vat: v })); }} /></div>
      {!shops.length && <div className="hidden lg:block" />}
      {field("cash", t("cat.SALES_CASH"))}
      {field("card", t("cat.SALES_CARD"))}
      {field("deliveryApps", t("cat.SALES_DELIVERY_APPS"))}
      {field("other", t("cat.SALES_OTHER"))}
      <div className="space-y-1 sm:col-span-2"><Label htmlFor="dc-note">{t("note")}</Label><Input id="dc-note" maxLength={500} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></div>
      <div className="flex flex-wrap items-center gap-3 sm:col-span-2 lg:col-span-4">
        <span className="text-sm">{t("dayTotal")}: <b className="text-lg tabular-nums" data-testid="day-total">{money.format(total)}</b></span>
        {loaded && <span className="text-xs text-muted-foreground">{t("alreadySaved")}</span>}
        <Button type="submit" disabled={pending || total <= 0}><Spin on={pending} icon={Save} />{t("saveDay")}</Button>
        <Msg error={error} done={done} />
      </div>
    </form>
  );
}

/** An expense (or a single sale) with an optional photo / PDF of the receipt. */
export function ExpenseForm({ shops, mustPickShop, today }: { shops: Opt[]; mustPickShop: boolean; today: string }) {
  const t = useTranslations("accounting");
  const { pending, error, done, run } = useRun();
  const form = useRef<HTMLFormElement>(null);
  return (
    <form ref={form} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" data-testid="expense-form" onSubmit={(e) => {
      e.preventDefault();
      const fd = new FormData(e.currentTarget);
      run(() => addEntryAction(fd), () => { form.current?.reset(); }, t("expenseSaved"));
    }}>
      <div className="space-y-1"><Label htmlFor="ex-date">{t("date")}</Label><Input id="ex-date" name="date" type="date" required max={today} defaultValue={today} /></div>
      <div className="space-y-1"><Label htmlFor="ex-cat">{t("category")}</Label>
        <Select id="ex-cat" name="category" required defaultValue=""><option value="" disabled>{t("chooseCategory")}</option>{EXPENSES.map((c) => <option key={c} value={c}>{t(`cat.${c}`)}</option>)}</Select>
      </div>
      <div className="space-y-1"><Label htmlFor="ex-amt">{t("amountInclVat")}</Label><Input id="ex-amt" name="amount" type="number" inputMode="decimal" min={0.01} step="0.01" required className="text-right tabular-nums" placeholder="0,00" /></div>
      <div className="space-y-1"><Label htmlFor="ex-vat">{t("vatRate")}</Label><VatSelect id="ex-vat" name="vatRate" /></div>
      <div className="space-y-1"><Label htmlFor="ex-payee">{t("payee")}</Label><Input id="ex-payee" name="payee" maxLength={120} placeholder={t("payeeHint")} /></div>
      <ShopSelect id="ex-shop" name="branchId" shops={shops} required={mustPickShop} />
      <div className="space-y-1 sm:col-span-2"><Label htmlFor="ex-desc">{t("description")}</Label><Input id="ex-desc" name="description" maxLength={500} /></div>
      <div className="space-y-1 sm:col-span-2"><Label htmlFor="ex-rec" className="flex items-center gap-1.5"><Camera className="size-4" />{t("receipt")} <span className="text-muted-foreground">({t("optional")})</span></Label><Input id="ex-rec" name="receipt" type="file" accept="image/jpeg,image/png,image/webp,application/pdf" /></div>
      <div className="flex flex-wrap items-center gap-3 sm:col-span-2 lg:col-span-4">
        <Button type="submit" disabled={pending}><Spin on={pending} icon={Plus} />{t("addExpense")}</Button>
        <Msg error={error} done={done} />
      </div>
    </form>
  );
}

/** A fixed monthly expense (rent, salaries, social security, a phone contract…). */
export function RecurringExpenseForm({ shops, mustPickShop, today }: { shops: Opt[]; mustPickShop: boolean; today: string }) {
  const t = useTranslations("accounting");
  const { pending, error, done, run } = useRun();
  const blank = { category: "", amount: "", vat: "", payee: "", description: "", day: "1", startsOn: today.slice(0, 8) + "01", endsOn: "", shop: mustPickShop ? shops[0]?.id ?? "" : "" };
  const [f, setF] = useState(blank);
  return (
    <form className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" data-testid="recurring-expense-form" onSubmit={(e) => {
      e.preventDefault();
      run(() => saveRecurringExpenseAction({ category: f.category as "RENT", amount: num(f.amount), vatRate: f.vat === "" ? null : Number(f.vat), payee: f.payee || null, description: f.description || null, dayOfMonth: Number(f.day), startsOn: f.startsOn, endsOn: f.endsOn || null, branchId: f.shop || null }), () => setF(blank), t("recurringSaved"));
    }}>
      <div className="space-y-1"><Label htmlFor="re-cat">{t("category")}</Label>
        <Select id="re-cat" required value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}><option value="" disabled>{t("chooseCategory")}</option>{EXPENSES.map((c) => <option key={c} value={c}>{t(`cat.${c}`)}</option>)}</Select>
      </div>
      <div className="space-y-1"><Label htmlFor="re-amt">{t("amountInclVat")}</Label><Input id="re-amt" type="number" inputMode="decimal" min={0.01} step="0.01" required value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} className="text-right tabular-nums" /></div>
      <div className="space-y-1"><Label htmlFor="re-vat">{t("vatRate")}</Label><VatSelect id="re-vat" value={f.vat} onChange={(v) => setF({ ...f, vat: v })} /></div>
      <div className="space-y-1"><Label htmlFor="re-day">{t("dayOfMonth")}</Label><Input id="re-day" type="number" min={1} max={28} required value={f.day} onChange={(e) => setF({ ...f, day: e.target.value })} /></div>
      <div className="space-y-1"><Label htmlFor="re-payee">{t("payee")}</Label><Input id="re-payee" maxLength={120} value={f.payee} onChange={(e) => setF({ ...f, payee: e.target.value })} placeholder={t("payeeHint")} /></div>
      <ShopSelect id="re-shop" shops={shops} value={f.shop} onChange={(v) => setF({ ...f, shop: v })} required={mustPickShop} />
      <div className="space-y-1"><Label htmlFor="re-from">{t("startsOn")}</Label><Input id="re-from" type="date" required value={f.startsOn} onChange={(e) => setF({ ...f, startsOn: e.target.value })} /></div>
      <div className="space-y-1"><Label htmlFor="re-to">{t("endsOn")} <span className="text-muted-foreground">({t("optional")})</span></Label><Input id="re-to" type="date" value={f.endsOn} onChange={(e) => setF({ ...f, endsOn: e.target.value })} /></div>
      <div className="space-y-1 sm:col-span-2 lg:col-span-4"><Label htmlFor="re-desc">{t("description")}</Label><Input id="re-desc" maxLength={500} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></div>
      <div className="flex flex-wrap items-center gap-3 sm:col-span-2 lg:col-span-4">
        <Button type="submit" disabled={pending}><Spin on={pending} icon={CalendarClock} />{t("addRecurring")}</Button>
        <Msg error={error} done={done} />
      </div>
    </form>
  );
}

export function RecurringToggle({ id, isActive }: { id: string; isActive: boolean }) {
  const t = useTranslations("accounting");
  const { pending, run } = useRun();
  return <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => run(() => setRecurringExpenseActiveAction({ id, active: !isActive }))}>{isActive ? <><Ban className="size-4" />{t("stop")}</> : <><Play className="size-4" />{t("resume")}</>}</Button>;
}

export function DeleteEntry({ id }: { id: string }) {
  const t = useTranslations("accounting");
  const { pending, run } = useRun();
  return <Button type="button" size="icon" variant="ghost" aria-label={t("delete")} disabled={pending} onClick={() => { if (confirm(t("deleteConfirm"))) run(() => deleteEntryAction({ id })); }}><Trash2 className="size-4" /></Button>;
}

export function PrintButton() {
  const t = useTranslations("accounting");
  return <Button type="button" variant="outline" size="sm" onClick={() => window.print()} className="print:hidden"><Printer className="size-4" />{t("print")}</Button>;
}

export const SavedTick = () => <Check className="size-4 text-[color:var(--success,#16a34a)]" aria-hidden />;
