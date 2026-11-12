"use client";
/** B2B buying controls (Phase 26): quotes, approvals, recurring orders, order lists. Texts: "buying". */
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Ban, Check, ClipboardList, FileQuestion, ListPlus, Loader2, Pause, Play, Plus, Repeat, Send, ShoppingCart, SkipForward, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";
import {
  acceptQuoteAction, answerQuoteAction, cancelApprovalAction, createListAction, createRecurringAction, decideApprovalAction, declineQuoteAction, deleteApprovalRuleAction, deleteListAction,
  listToCartAction, orderRecurringNowAction, recurringStateAction, rejectQuoteAction, requestQuoteAction, saveApprovalRuleAction, setListItemAction, updateListAction, updateRecurringAction,
} from "@/server/actions/buying";

type Res = { ok: boolean; error?: string; data?: unknown };
function useRun() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const run = (fn: () => Promise<Res>, after?: (data: unknown) => void, okText?: string) =>
    start(async () => {
      setError(null); setDone(null);
      const r = await fn();
      if (r.ok) { after?.(r.data); if (okText) setDone(okText); router.refresh(); } else setError(r.error ?? "Error");
    });
  return { pending, error, done, run, router };
}
function Msg({ error, done }: { error: string | null; done?: string | null }) {
  if (error) return <p className="text-sm text-destructive" role="alert">{error}</p>;
  if (done) return <p className="text-sm text-[color:var(--success,#16a34a)]" role="status">{done}</p>;
  return null;
}
const Spin = ({ on, icon: I }: { on: boolean; icon: React.ElementType }) => (on ? <Loader2 className="size-4 animate-spin" /> : <I className="size-4" />);
export type Opt = { id: string; label: string };
const ta = "w-full rounded-lg border border-input bg-card/80 px-3 py-2 text-sm";

// ───────────────────────────── cart ─────────────────────────────

/** Under the checkout: ask for a quote instead, or save the cart as a list. */
export function CartExtras({ canQuote }: { canQuote: boolean }) {
  const t = useTranslations("buying");
  const { pending, error, run, router } = useRun();
  const [mode, setMode] = useState<"quote" | "list" | null>(null);
  const [f, setF] = useState({ note: "", neededBy: "", name: "", shared: true });
  return (
    <div className="space-y-2 border-t pt-3" data-testid="cart-extras">
      <div className="flex flex-wrap gap-2">
        {canQuote && <Button type="button" variant="outline" size="sm" onClick={() => setMode(mode === "quote" ? null : "quote")} data-testid="ask-quote"><FileQuestion className="size-4" />{t("askQuote")}</Button>}
        <Button type="button" variant="outline" size="sm" onClick={() => setMode(mode === "list" ? null : "list")} data-testid="save-list"><ListPlus className="size-4" />{t("saveAsList")}</Button>
      </div>
      {mode === "quote" && (
        <form className="space-y-2 rounded-xl border p-3" data-testid="quote-form" onSubmit={(e) => { e.preventDefault(); run(() => requestQuoteAction({ note: f.note || null, neededBy: f.neededBy || null }), (d) => { const q = d as { id: string }[]; router.push(q.length === 1 ? `/buy/orders/quotes/${q[0].id}?sent=1` : "/buy/orders/quotes?sent=1"); }); }}>
          <p className="text-xs text-muted-foreground">{t("askQuoteHint")}</p>
          <div className="space-y-1"><Label htmlFor="q-note">{t("noteToSupplier")}</Label><textarea id="q-note" rows={2} maxLength={1000} className={ta} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} placeholder={t("noteHint")} /></div>
          <div className="space-y-1"><Label htmlFor="q-by">{t("neededBy")} <span className="text-muted-foreground">({t("optional")})</span></Label><Input id="q-by" type="date" value={f.neededBy} onChange={(e) => setF({ ...f, neededBy: e.target.value })} /></div>
          <Button type="submit" size="sm" disabled={pending}><Spin on={pending} icon={Send} />{t("sendRequest")}</Button>
        </form>
      )}
      {mode === "list" && (
        <form className="space-y-2 rounded-xl border p-3" data-testid="list-form" onSubmit={(e) => { e.preventDefault(); run(() => createListAction({ name: f.name, shared: f.shared, from: "CART" }), (d) => router.push(`/buy/orders/lists/${d as string}`)); }}>
          <div className="space-y-1"><Label htmlFor="l-name">{t("listName")}</Label><Input id="l-name" required maxLength={80} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder={t("listNameHint")} /></div>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="size-4" checked={f.shared} onChange={(e) => setF({ ...f, shared: e.target.checked })} />{t("sharedWithTeam")}</label>
          <Button type="submit" size="sm" disabled={pending}><Spin on={pending} icon={ListPlus} />{t("save")}</Button>
        </form>
      )}
      <Msg error={error} />
    </div>
  );
}

/** On a past order: save it as a list. */
export function SaveOrderAsList({ orderId, number }: { orderId: string; number: string }) {
  const t = useTranslations("buying");
  const { pending, error, run, router } = useRun();
  return (
    <span className="inline-flex flex-col">
      <Button variant="outline" size="sm" disabled={pending} data-testid="order-to-list" onClick={() => run(() => createListAction({ name: t("listFromOrder", { number }), from: "ORDER", orderId }), (d) => router.push(`/buy/orders/lists/${d as string}`))}>
        <Spin on={pending} icon={ListPlus} />{t("saveAsList")}
      </Button>
      <Msg error={error} />
    </span>
  );
}

// ───────────────────────────── quotes ─────────────────────────────

export function AcceptQuote({ id, addresses }: { id: string; addresses: Opt[] }) {
  const t = useTranslations("buying");
  const { pending, error, run, router } = useRun();
  const [f, setF] = useState({ address: addresses[0]?.id ?? "", date: "", notes: "" });
  const [reject, setReject] = useState<string | null>(null);
  return (
    <div className="space-y-4">
      <form className="grid gap-3 sm:grid-cols-2" data-testid="accept-quote" onSubmit={(e) => { e.preventDefault(); run(() => acceptQuoteAction({ id, deliveryAddressId: f.address, requestedDeliveryDate: f.date || null, notes: f.notes || null }), (d) => { const r = d as { orders: { id: string }[]; approval?: { id: string } }; router.push(r.approval ? `/buy/orders/approvals/${r.approval.id}?sent=1` : `/buy/orders/${r.orders[0].id}?placed=1`); }); }}>
        <div className="space-y-1 sm:col-span-2"><Label htmlFor="aq-a">{t("deliveryAddress")}</Label><Select id="aq-a" value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })}>{addresses.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}</Select></div>
        <div className="space-y-1"><Label htmlFor="aq-d">{t("deliveryDate")} <span className="text-muted-foreground">({t("optional")})</span></Label><Input id="aq-d" type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></div>
        <div className="space-y-1"><Label htmlFor="aq-n">{t("notes")}</Label><Input id="aq-n" maxLength={500} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></div>
        <div className="flex flex-wrap items-center gap-2 sm:col-span-2">
          <Button type="submit" disabled={pending || !addresses.length}><Spin on={pending} icon={Check} />{t("acceptOrder")}</Button>
          <Button type="button" variant="outline" onClick={() => setReject(reject === null ? "" : null)}><X className="size-4" />{t("reject")}</Button>
        </div>
      </form>
      {reject !== null && (
        <form className="flex flex-wrap items-center gap-2" onSubmit={(e) => { e.preventDefault(); run(() => rejectQuoteAction({ id, reason: reject || null })); }}>
          <Input aria-label={t("reason")} placeholder={t("reasonOptional")} value={reject} onChange={(e) => setReject(e.target.value)} className="h-9 w-full sm:w-80" maxLength={500} />
          <Button type="submit" variant="destructive" size="sm" disabled={pending}>{t("rejectQuote")}</Button>
        </form>
      )}
      <Msg error={error} />
    </div>
  );
}

export function WithdrawQuote({ id }: { id: string }) {
  const t = useTranslations("buying");
  const { pending, error, run } = useRun();
  return <span className="inline-flex items-center gap-2"><Button variant="outline" size="sm" disabled={pending} onClick={() => { if (confirm(t("withdrawConfirm"))) run(() => rejectQuoteAction({ id })); }}><Spin on={pending} icon={Ban} />{t("withdraw")}</Button><Msg error={error} /></span>;
}

type QLine = { id: string; product: string; packaging: string; sku: string | null; qty: number; listUnitNet: string; targetUnitNet: string | null; quotedUnitNet: string | null };

/** The supplier's answer: a price per line, valid until, note — and what it receives after commission. */
export function AnswerQuote({ id, lines, commissionRate, validUntil, note, locale }: { id: string; lines: QLine[]; commissionRate: string; validUntil: string | null; note: string | null; locale: string }) {
  const t = useTranslations("buying");
  const { pending, error, done, run } = useRun();
  const inWeek = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10);
  const [prices, setPrices] = useState<Record<string, string>>(Object.fromEntries(lines.map((l) => [l.id, l.quotedUnitNet ? Number(l.quotedUnitNet).toFixed(2) : Number(l.listUnitNet).toFixed(2)])));
  const [until, setUntil] = useState(validUntil ?? inWeek);
  const [msg, setMsg] = useState(note ?? "");
  const [decline, setDecline] = useState<string | null>(null);
  const money = useMemo(() => new Intl.NumberFormat(locale, { style: "currency", currency: "EUR" }), [locale]);
  const total = lines.reduce((a, l) => a + (Number(prices[l.id]) || 0) * l.qty, 0);
  const rate = Number(commissionRate) || 0;
  return (
    <div className="space-y-4">
      <form className="space-y-3" data-testid="answer-quote" onSubmit={(e) => { e.preventDefault(); run(() => answerQuoteAction({ id, validUntil: until, note: msg || null, lines: lines.map((l) => ({ lineId: l.id, unitNet: Number(prices[l.id]) })) }), undefined, t("sent")); }}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs text-muted-foreground"><th className="py-1 pr-3 font-medium">{t("product")}</th><th className="py-1 pr-3 text-right font-medium">{t("qty")}</th><th className="py-1 pr-3 text-right font-medium">{t("yourListPrice")}</th><th className="py-1 pr-3 text-right font-medium">{t("buyerTarget")}</th><th className="py-1 text-right font-medium">{t("quotedPrice")}</th></tr></thead>
            <tbody>
              {lines.map((l) => (
                <tr key={l.id} className="border-t">
                  <td className="py-2 pr-3"><div className="font-medium">{l.product}</div><div className="text-xs text-muted-foreground">{l.packaging}{l.sku ? ` · ${l.sku}` : ""}</div></td>
                  <td className="py-2 pr-3 text-right tabular-nums">{l.qty}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{money.format(Number(l.listUnitNet))}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{l.targetUnitNet ? money.format(Number(l.targetUnitNet)) : "—"}</td>
                  <td className="py-2 text-right"><Input aria-label={`${t("quotedPrice")} ${l.product}`} type="number" min={0.01} step="0.01" required value={prices[l.id]} onChange={(e) => setPrices({ ...prices, [l.id]: e.target.value })} className="ml-auto h-8 w-28 text-right" data-testid="quote-price" /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-1"><Label htmlFor="aq-u">{t("validUntil")}</Label><Input id="aq-u" type="date" required value={until} onChange={(e) => setUntil(e.target.value)} /></div>
          <div className="space-y-1 sm:col-span-2"><Label htmlFor="aq-m">{t("noteToBuyer")}</Label><Input id="aq-m" maxLength={1000} value={msg} onChange={(e) => setMsg(e.target.value)} /></div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-muted/30 p-3 text-sm">
          <span>{t("quoteTotal")}: <b className="tabular-nums">{money.format(total)}</b></span>
          <span data-testid="payout-preview">{t("youReceive", { rate: rate.toLocaleString(locale) })}: <b className="tabular-nums">{money.format(total * (1 - rate / 100))}</b></span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" disabled={pending}><Spin on={pending} icon={Send} />{t("sendQuote")}</Button>
          <Button type="button" variant="outline" onClick={() => setDecline(decline === null ? "" : null)}><X className="size-4" />{t("decline")}</Button>
          <Msg error={error} done={done} />
        </div>
      </form>
      {decline !== null && (
        <form className="flex flex-wrap items-center gap-2" data-testid="decline-quote" onSubmit={(e) => { e.preventDefault(); run(() => declineQuoteAction({ id, reason: decline })); }}>
          <Input aria-label={t("reason")} placeholder={t("declineReason")} required value={decline} onChange={(e) => setDecline(e.target.value)} className="h-9 w-full sm:w-80" maxLength={500} />
          <Button type="submit" variant="destructive" size="sm" disabled={pending}>{t("declineRequest")}</Button>
        </form>
      )}
    </div>
  );
}

// ───────────────────────────── approvals ─────────────────────────────

export function DecideApproval({ id, canDecide, canCancel }: { id: string; canDecide: boolean; canCancel: boolean }) {
  const t = useTranslations("buying");
  const { pending, error, run, router } = useRun();
  const [note, setNote] = useState("");
  return (
    <div className="space-y-2" data-testid="decide-approval">
      {canDecide && (
        <>
          <Input aria-label={t("note")} placeholder={t("decisionNote")} value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />
          <div className="flex flex-wrap gap-2">
            <Button disabled={pending} onClick={() => run(() => decideApprovalAction({ id, approve: true, note: note || null }), (d) => { const r = d as { orders: { id: string }[] }; if (r.orders[0]) router.push(`/buy/orders/${r.orders[0].id}?placed=1`); })} data-testid="approve"><Spin on={pending} icon={Check} />{t("approve")}</Button>
            <Button variant="destructive" disabled={pending} onClick={() => run(() => decideApprovalAction({ id, approve: false, note: note || null }))} data-testid="reject"><X className="size-4" />{t("reject")}</Button>
          </div>
        </>
      )}
      {canCancel && <Button variant="outline" size="sm" disabled={pending} onClick={() => run(() => cancelApprovalAction({ id }))}><Ban className="size-4" />{t("withdrawRequest")}</Button>}
      <Msg error={error} />
    </div>
  );
}

export function RuleForm({ categories, rule }: { categories: Opt[]; rule?: { id: string; name: string; minGross: string | null; categoryIds: string[]; isActive: boolean } }) {
  const t = useTranslations("buying");
  const { pending, error, done, run } = useRun();
  const [f, setF] = useState({ name: rule?.name ?? "", minGross: rule?.minGross ? String(Number(rule.minGross)) : "", cats: rule?.categoryIds ?? [], isActive: rule?.isActive ?? true });
  return (
    <form className="grid gap-3 sm:grid-cols-4" data-testid="rule-form" onSubmit={(e) => { e.preventDefault(); run(() => saveApprovalRuleAction({ id: rule?.id ?? null, name: f.name, minGross: f.minGross ? Number(f.minGross) : null, categoryIds: f.cats, isActive: f.isActive }), () => { if (!rule) setF({ name: "", minGross: "", cats: [], isActive: true }); }, t("saved")); }}>
      <div className="space-y-1"><Label htmlFor={`r-n-${rule?.id ?? "new"}`}>{t("ruleName")}</Label><Input id={`r-n-${rule?.id ?? "new"}`} required maxLength={80} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder={t("ruleNameHint")} /></div>
      <div className="space-y-1"><Label htmlFor={`r-a-${rule?.id ?? "new"}`}>{t("fromAmount")}</Label><Input id={`r-a-${rule?.id ?? "new"}`} type="number" min={0} step="0.01" value={f.minGross} onChange={(e) => setF({ ...f, minGross: e.target.value })} placeholder="500" /></div>
      <div className="space-y-1 sm:col-span-2"><Label htmlFor={`r-c-${rule?.id ?? "new"}`}>{t("categoriesLabel")}</Label>
        <Select id={`r-c-${rule?.id ?? "new"}`} multiple value={f.cats} onChange={(e) => setF({ ...f, cats: Array.from(e.target.selectedOptions).map((o) => o.value) })} className="h-24">{categories.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</Select></div>
      <div className="flex flex-wrap items-center gap-3 sm:col-span-4">
        {rule && <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="size-4" checked={f.isActive} onChange={(e) => setF({ ...f, isActive: e.target.checked })} />{t("active")}</label>}
        <Button type="submit" size="sm" disabled={pending}><Spin on={pending} icon={rule ? Check : Plus} />{rule ? t("save") : t("addRule")}</Button>
        {rule && <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={() => run(() => deleteApprovalRuleAction({ id: rule.id }))}><Trash2 className="size-4" />{t("delete")}</Button>}
        <Msg error={error} done={done} />
      </div>
    </form>
  );
}

// ───────────────────────────── recurring ─────────────────────────────

const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7];

function ScheduleFields({ f, set, idp }: { f: { frequency: string; weekday: string; dayOfMonth: string }; set: (k: "frequency" | "weekday" | "dayOfMonth", v: string) => void; idp: string }) {
  const t = useTranslations("buying");
  return (
    <>
      <div className="space-y-1"><Label htmlFor={`${idp}-f`}>{t("every")}</Label><Select id={`${idp}-f`} value={f.frequency} onChange={(e) => set("frequency", e.target.value)}>{["WEEKLY", "BIWEEKLY", "MONTHLY"].map((x) => <option key={x} value={x}>{t(`freq.${x}`)}</option>)}</Select></div>
      {f.frequency === "MONTHLY"
        ? <div className="space-y-1"><Label htmlFor={`${idp}-d`}>{t("dayOfMonth")}</Label><Input id={`${idp}-d`} type="number" min={1} max={28} required value={f.dayOfMonth} onChange={(e) => set("dayOfMonth", e.target.value)} /></div>
        : <div className="space-y-1"><Label htmlFor={`${idp}-w`}>{t("weekday")}</Label><Select id={`${idp}-w`} value={f.weekday} onChange={(e) => set("weekday", e.target.value)}>{WEEKDAYS.map((d) => <option key={d} value={d}>{t(`day.${d}`)}</option>)}</Select></div>}
    </>
  );
}

export function NewRecurring({ addresses, lists, defaultList }: { addresses: Opt[]; lists: Opt[]; defaultList?: string }) {
  const t = useTranslations("buying");
  const { pending, error, run, router } = useRun();
  const [f, setF] = useState({ name: "", source: defaultList ? `list:${defaultList}` : "cart", frequency: "WEEKLY", weekday: "1", dayOfMonth: "1", address: addresses[0]?.id ?? "", remind: "1" });
  return (
    <form className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" data-testid="new-recurring" onSubmit={(e) => {
      e.preventDefault();
      run(() => createRecurringAction({ name: f.name, frequency: f.frequency as "WEEKLY", weekday: f.frequency === "MONTHLY" ? null : Number(f.weekday), dayOfMonth: f.frequency === "MONTHLY" ? Number(f.dayOfMonth) : null, deliveryAddressId: f.address, remindDaysBefore: Number(f.remind), listId: f.source.startsWith("list:") ? f.source.slice(5) : null }),
        (d) => router.push(`/buy/orders/recurring/${(d as { id: string }).id}`));
    }}>
      <div className="space-y-1"><Label htmlFor="nr-n">{t("name")}</Label><Input id="nr-n" required maxLength={80} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder={t("recurringNameHint")} /></div>
      <div className="space-y-1"><Label htmlFor="nr-s">{t("products")}</Label><Select id="nr-s" value={f.source} onChange={(e) => setF({ ...f, source: e.target.value })}><option value="cart">{t("fromCart")}</option>{lists.map((l) => <option key={l.id} value={`list:${l.id}`}>{t("fromList", { name: l.label })}</option>)}</Select></div>
      <div className="space-y-1"><Label htmlFor="nr-a">{t("deliveryAddress")}</Label><Select id="nr-a" value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })}>{addresses.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}</Select></div>
      <ScheduleFields idp="nr" f={f} set={(k, v) => setF({ ...f, [k]: v })} />
      <div className="space-y-1"><Label htmlFor="nr-r">{t("remindBefore")}</Label><Select id="nr-r" value={f.remind} onChange={(e) => setF({ ...f, remind: e.target.value })}>{[0, 1, 2, 3].map((d) => <option key={d} value={d}>{d === 0 ? t("noReminder") : t("daysBefore", { count: d })}</option>)}</Select></div>
      <div className="flex flex-wrap items-center gap-3 sm:col-span-2 lg:col-span-3"><Button type="submit" disabled={pending || !addresses.length}><Spin on={pending} icon={Repeat} />{t("createRecurring")}</Button><Msg error={error} /></div>
    </form>
  );
}

export function EditSchedule({ id, frequency, weekday, dayOfMonth, addressId, addresses, remind }: { id: string; frequency: string; weekday: number | null; dayOfMonth: number | null; addressId: string; addresses: Opt[]; remind: number }) {
  const t = useTranslations("buying");
  const { pending, error, done, run } = useRun();
  const [f, setF] = useState({ frequency, weekday: String(weekday ?? 1), dayOfMonth: String(dayOfMonth ?? 1), address: addressId, remind: String(remind) });
  return (
    <form className="grid gap-3 sm:grid-cols-2" data-testid="edit-schedule" onSubmit={(e) => { e.preventDefault(); run(() => updateRecurringAction({ id, frequency: f.frequency as "WEEKLY", weekday: f.frequency === "MONTHLY" ? null : Number(f.weekday), dayOfMonth: f.frequency === "MONTHLY" ? Number(f.dayOfMonth) : null, deliveryAddressId: f.address, remindDaysBefore: Number(f.remind) }), undefined, t("saved")); }}>
      <ScheduleFields idp="es" f={f} set={(k, v) => setF({ ...f, [k]: v })} />
      <div className="space-y-1"><Label htmlFor="es-a">{t("deliveryAddress")}</Label><Select id="es-a" value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })}>{addresses.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}</Select></div>
      <div className="space-y-1"><Label htmlFor="es-r">{t("remindBefore")}</Label><Select id="es-r" value={f.remind} onChange={(e) => setF({ ...f, remind: e.target.value })}>{[0, 1, 2, 3].map((d) => <option key={d} value={d}>{d === 0 ? t("noReminder") : t("daysBefore", { count: d })}</option>)}</Select></div>
      <div className="flex items-center gap-3 sm:col-span-2"><Button type="submit" size="sm" variant="outline" disabled={pending}><Spin on={pending} icon={Check} />{t("save")}</Button><Msg error={error} done={done} /></div>
    </form>
  );
}

export function RecurringActions({ id, status, skipNext }: { id: string; status: string; skipNext: boolean }) {
  const t = useTranslations("buying");
  const { pending, error, done, run } = useRun();
  const act = (action: "PAUSE" | "RESUME" | "END" | "SKIP_NEXT" | "UNSKIP") => run(() => recurringStateAction({ id, action }));
  if (status === "ENDED") return null;
  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="recurring-actions">
      {status === "ACTIVE" && <Button size="sm" variant="outline" disabled={pending} onClick={() => act(skipNext ? "UNSKIP" : "SKIP_NEXT")}><SkipForward className="size-4" />{skipNext ? t("unskip") : t("skipNext")}</Button>}
      {status === "ACTIVE" && <Button size="sm" variant="outline" disabled={pending} onClick={() => act("PAUSE")}><Pause className="size-4" />{t("pause")}</Button>}
      {status === "PAUSED" && <Button size="sm" variant="outline" disabled={pending} onClick={() => act("RESUME")}><Play className="size-4" />{t("resume")}</Button>}
      {(status === "ACTIVE" || status === "PAUSED") && <Button size="sm" disabled={pending} onClick={() => run(() => orderRecurringNowAction({ id }), undefined, t("orderPlaced"))} data-testid="order-now"><Spin on={pending} icon={ShoppingCart} />{t("orderNow")}</Button>}
      <Button size="sm" variant="ghost" disabled={pending} onClick={() => { if (confirm(t("endConfirm"))) act("END"); }}><Ban className="size-4" />{t("end")}</Button>
      <Msg error={error} done={done} />
    </div>
  );
}

type RLine = { offerId: string; qty: number; product: string; packaging: string; supplier: string; unitNet: string | null; ok: boolean; available: number };

/** The products of a recurring order with their quantities (0 removes); stock today shown per line. */
export function RecurringItems({ id, lines, editable, locale }: { id: string; lines: RLine[]; editable: boolean; locale: string }) {
  const t = useTranslations("buying");
  const { pending, error, done, run } = useRun();
  const [q, setQ] = useState<Record<string, string>>(Object.fromEntries(lines.map((l) => [l.offerId, String(l.qty)])));
  const money = useMemo(() => new Intl.NumberFormat(locale, { style: "currency", currency: "EUR" }), [locale]);
  const total = lines.reduce((a, l) => a + (Number(l.unitNet) || 0) * (Number(q[l.offerId]) || 0), 0);
  return (
    <div className="space-y-3">
      <div className="overflow-x-auto">
        <table className="w-full text-sm" data-testid="recurring-lines">
          <thead><tr className="text-left text-xs text-muted-foreground"><th className="py-1 pr-3 font-medium">{t("product")}</th><th className="py-1 pr-3 font-medium">{t("supplier")}</th><th className="py-1 pr-3 text-right font-medium">{t("unitPrice")}</th><th className="py-1 pr-3 text-right font-medium">{t("qty")}</th><th className="py-1 font-medium">{t("today")}</th></tr></thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.offerId} className="border-t">
                <td className="py-2 pr-3"><div className="font-medium">{l.product}</div><div className="text-xs text-muted-foreground">{l.packaging}</div></td>
                <td className="py-2 pr-3">{l.supplier}</td>
                <td className="py-2 pr-3 text-right tabular-nums">{l.unitNet ? money.format(Number(l.unitNet)) : "—"}</td>
                <td className="py-2 pr-3 text-right">{editable ? <Input aria-label={`${t("qty")} ${l.product}`} type="number" min={0} value={q[l.offerId]} onChange={(e) => setQ({ ...q, [l.offerId]: e.target.value })} className="ml-auto h-8 w-20 text-right" /> : l.qty}</td>
                <td className="py-2 text-xs">{l.ok ? <span className="text-[color:var(--success,#16a34a)]">{t("inStock")}</span> : <span className="text-destructive">{l.unitNet ? t("onlyAvailable", { count: l.available }) : t("notAvailable")}</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <span>{t("estimate")}: <b className="tabular-nums">{money.format(total)}</b> <span className="text-muted-foreground">({t("exclVat")})</span></span>
        {editable && <span className="flex items-center gap-2"><Msg error={error} done={done} /><Button size="sm" variant="outline" disabled={pending} data-testid="save-items" onClick={() => run(() => updateRecurringAction({ id, items: lines.map((l) => ({ offerId: l.offerId, qty: Number(q[l.offerId]) || 0 })).filter((x) => x.qty > 0) }), undefined, t("saved"))}><Spin on={pending} icon={Check} />{t("saveQuantities")}</Button></span>}
      </div>
    </div>
  );
}

// ───────────────────────────── lists ─────────────────────────────

export function NewList() {
  const t = useTranslations("buying");
  const { pending, error, run, router } = useRun();
  const [f, setF] = useState({ name: "", shared: true, fromCart: false });
  return (
    <form className="flex flex-wrap items-end gap-3" data-testid="new-list" onSubmit={(e) => { e.preventDefault(); run(() => createListAction({ name: f.name, shared: f.shared, from: f.fromCart ? "CART" : null }), (d) => router.push(`/buy/orders/lists/${d as string}`)); }}>
      <div className="space-y-1"><Label htmlFor="nl-n">{t("listName")}</Label><Input id="nl-n" required maxLength={80} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder={t("listNameHint")} className="w-64" /></div>
      <label className="flex items-center gap-2 pb-2 text-sm"><input type="checkbox" className="size-4" checked={f.fromCart} onChange={(e) => setF({ ...f, fromCart: e.target.checked })} />{t("withCartProducts")}</label>
      <label className="flex items-center gap-2 pb-2 text-sm"><input type="checkbox" className="size-4" checked={f.shared} onChange={(e) => setF({ ...f, shared: e.target.checked })} />{t("sharedWithTeam")}</label>
      <Button type="submit" disabled={pending}><Spin on={pending} icon={Plus} />{t("createList")}</Button>
      <Msg error={error} />
    </form>
  );
}

export function ListQty({ id, offerId, qty }: { id: string; offerId: string; qty: number }) {
  const t = useTranslations("buying");
  const { pending, error, run } = useRun();
  const [v, setV] = useState(String(qty));
  return (
    <span className="inline-flex items-center gap-1">
      <Input aria-label={t("qty")} type="number" min={0} value={v} onChange={(e) => setV(e.target.value)} onBlur={() => { if (Number(v) !== qty) run(() => setListItemAction({ id, offerId, qty: Number(v) || 0 })); }} className="h-8 w-20 text-right" data-testid="list-qty" />
      <Button type="button" size="icon" variant="ghost" aria-label={t("remove")} disabled={pending} onClick={() => run(() => setListItemAction({ id, offerId, qty: 0 }))}><Trash2 className="size-4" /></Button>
      {error && <span className="text-xs text-destructive">{error}</span>}
    </span>
  );
}

export function ListActions({ id, name, shared, mine, canDelete }: { id: string; name: string; shared: boolean; mine: boolean; canDelete: boolean }) {
  const t = useTranslations("buying");
  const { pending, error, done, run, router } = useRun();
  const [n, setN] = useState(name);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button disabled={pending} data-testid="list-to-cart" onClick={() => run(() => listToCartAction({ id }), (d) => { const r = d as { added: number; skipped: number }; router.push(`/buy/orders/cart${r.skipped ? `?skipped=${r.skipped}` : ""}`); })}><Spin on={pending} icon={ShoppingCart} />{t("addAllToCart")}</Button>
        <a href={`/buy/orders/recurring?list=${id}`} className="inline-flex h-9 items-center gap-2 rounded-md border px-3 text-sm hover:bg-accent"><Repeat className="size-4" />{t("makeRecurring")}</a>
        {canDelete && <Button variant="ghost" size="sm" disabled={pending} onClick={() => { if (confirm(t("deleteListConfirm"))) run(() => deleteListAction({ id }), () => router.push("/buy/orders/lists")); }}><Trash2 className="size-4" />{t("delete")}</Button>}
      </div>
      <form className="flex flex-wrap items-center gap-2" onSubmit={(e) => { e.preventDefault(); run(() => updateListAction({ id, name: n }), undefined, t("saved")); }}>
        <Input aria-label={t("listName")} value={n} onChange={(e) => setN(e.target.value)} maxLength={80} className="h-9 w-64" />
        <Button type="submit" size="sm" variant="outline" disabled={pending}><ClipboardList className="size-4" />{t("rename")}</Button>
        {mine && <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="size-4" checked={shared} onChange={(e) => run(() => updateListAction({ id, shared: e.target.checked }))} />{t("sharedWithTeam")}</label>}
      </form>
      <Msg error={error} done={done} />
    </div>
  );
}
