"use client";
/** Rewards shop (Phase 55) — the interactive parts for buyers and suppliers. Texts come in as `l`. */
import { useState } from "react";
import Link from "next/link";
import { Ban, Check, Copy, ExternalLink, Gift, Heart, HeartOff, Pause, Play, Save, ShoppingCart, Square, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";
import { Msg, Spin, useRun } from "@/components/shared/run";
import {
  applyRedemptionAction, cancelMyRedemptionAction, redeemRewardAction, saveSupplierRewardAction, setRewardGoalAction, supplierCancelRedemptionAction, supplierRewardStatusAction,
} from "@/server/actions/rewards";
import { REWARD_TIERS } from "@/lib/rewards";

type L = Record<string, string>;
export const TA = "w-full rounded-lg border border-input bg-card/80 px-3 py-2 text-sm";
const fill = (s: string | undefined, v: Record<string, string | number> = {}) => (s ?? "").replace(/\{(\w+)\}/g, (_, k: string) => String(v[k] ?? `{${k}}`));

export function CopyCode({ l, code }: { l: L; code: string }) {
  const [ok, setOk] = useState(false);
  return (
    <span className="inline-flex max-w-full items-center gap-2 rounded-lg border border-dashed bg-muted/40 px-3 py-1.5">
      <code className="break-all font-mono text-base font-semibold tracking-wider" data-testid="reward-code">{code}</code>
      <button type="button" className="text-muted-foreground hover:text-foreground" aria-label={l.copy} onClick={() => { void navigator.clipboard?.writeText(code).then(() => { setOk(true); setTimeout(() => setOk(false), 1500); }); }}>
        {ok ? <Check className="size-4 text-[color:var(--success,#16a34a)]" aria-hidden /> : <Copy className="size-4" aria-hidden />}
      </button>
      {ok && <span className="sr-only" role="status">{l.copied}</span>}
    </span>
  );
}

type Done = { id: string; kind: string; couponCode: string | null; partnerCode: string | null; partnerUrl: string | null };

/** The redeem button (gift: where to send it). After redeeming: the code / what happens next. */
export function RedeemPanel({ l, id, kind, points, blocked, addresses, supplier, useByDays }: {
  l: L; id: string; kind: string; points: string; blocked: string | null; addresses: { id: string; text: string }[]; supplier: string | null; useByDays: number | null;
}) {
  const { pending, error, run } = useRun();
  const [addr, setAddr] = useState(addresses[0]?.id ?? ""), [note, setNote] = useState("");
  const [done, setDone] = useState<Done | null>(null);
  if (done) {
    const until = useByDays ? new Date(Date.now() + useByDays * 86_400_000).toLocaleDateString() : "";
    return (
      <div className="space-y-3 rounded-xl border border-[color:var(--success,#16a34a)]/40 bg-[color:var(--success,#16a34a)]/5 p-4" data-testid="redeem-done" role="status">
        {done.couponCode && <><p className="text-sm">{fill(l["done.coupon"], { code: done.couponCode, date: until })}</p><CopyCode l={l} code={done.couponCode} /></>}
        {done.partnerCode && <><p className="text-sm">{fill(l["done.partner"], { code: done.partnerCode })}</p><CopyCode l={l} code={done.partnerCode} /></>}
        {kind === "SUPPLIER_PRODUCT" && <p className="text-sm">{fill(l["done.product"], { supplier: supplier ?? "" })}</p>}
        {kind === "GIFT" && <p className="text-sm">{l["done.gift"]}</p>}
        <div className="flex flex-wrap gap-2">
          {(done.couponCode || kind === "SUPPLIER_PRODUCT") && <UseButton l={l} id={done.id} label={done.couponCode ? l.useInCart : l.addToCart} />}
          {done.partnerUrl && <a href={done.partnerUrl} target="_blank" rel="noopener noreferrer" className="inline-flex h-9 items-center gap-1.5 rounded-md border px-3 text-sm hover:bg-accent"><ExternalLink className="size-4" aria-hidden /> {l.openPartner}</a>}
          <Link href="/buy/rewards/mine" className="inline-flex h-9 items-center rounded-md px-3 text-sm text-primary hover:underline">{l.toMine} →</Link>
        </div>
      </div>
    );
  }
  return (
    <div className="space-y-3">
      {kind === "GIFT" && (
        <div className="grid gap-3 sm:grid-cols-2">
          <div><Label className="text-xs" htmlFor="gift-addr">{l.sendTo}</Label>
            <Select id="gift-addr" value={addr} onChange={(e) => setAddr(e.target.value)} data-testid="gift-address">{addresses.map((a) => <option key={a.id} value={a.id}>{a.text}</option>)}</Select></div>
          <div><Label className="text-xs" htmlFor="gift-note">{l.note}</Label><Input id="gift-note" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} /></div>
        </div>
      )}
      {blocked ? <p className="rounded-lg bg-muted p-3 text-sm text-muted-foreground" data-testid="redeem-blocked">{blocked}</p> : (
        <Button size="lg" className="w-full sm:w-auto" disabled={pending} data-testid="redeem-btn"
          onClick={() => { if (!window.confirm(fill(l.confirm, { points }))) return; run(() => redeemRewardAction({ id, addressId: kind === "GIFT" ? addr || null : null, note: note || null }), (d) => setDone(d as Done)); }}>
          <Spin on={pending} icon={Gift} /> {fill(l.redeemFor, { points })}
        </Button>
      )}
      <Msg error={error} />
    </div>
  );
}

export function GoalButton({ l, id, saving }: { l: L; id: string; saving: boolean }) {
  const { pending, error, run } = useRun();
  return (
    <span className="inline-flex flex-col gap-1">
      <Button variant="outline" size="sm" disabled={pending} data-testid="goal-btn" onClick={() => run(() => setRewardGoalAction({ id: saving ? null : id }))}>
        <Spin on={pending} icon={saving ? HeartOff : Heart} /> {saving ? l.stopSaving : l.saveFor}
      </Button>
      <Msg error={error} />
    </span>
  );
}

/** Voucher → into the cart as its coupon; supplier product → into the cart (free there). */
export function UseButton({ id, label }: { l?: L; id: string; label: string }) {
  const { pending, error, run, router } = useRun();
  return (
    <span className="inline-flex flex-col gap-1">
      <Button size="sm" disabled={pending} data-testid="reward-use" onClick={() => run(() => applyRedemptionAction({ id }), (d) => router.push((d as { to: string }).to))}><Spin on={pending} icon={ShoppingCart} /> {label}</Button>
      <Msg error={error} />
    </span>
  );
}

export function CancelMine({ l, id }: { l: L; id: string }) {
  const { pending, error, run } = useRun();
  return (
    <span className="inline-flex flex-col gap-1">
      <Button size="sm" variant="ghost" disabled={pending} data-testid="reward-cancel" onClick={() => { if (window.confirm(l.cancelConfirm)) run(() => cancelMyRedemptionAction({ id })); }}><Spin on={pending} icon={X} /> {l.cancel}</Button>
      <Msg error={error} />
    </span>
  );
}

// ── supplier ────────────────────────────────────────────────────────────────

type SupplierItem = { id: string; offerId: string | null; qty: number | null; points: number; stock: number | null; perBuyerLimit: number | null; minTier: string | null; title: string; description: string | null; validTo: Date | string | null };

export function SupplierRewardForm({ l, locale, offers, item, min, max, onDone }: { l: L; locale: string; offers: { id: string; name: string }[]; item?: SupplierItem | null; min: number; max: number; onDone?: () => void }) {
  const { pending, error, done, run } = useRun();
  const lang = locale.split("-")[0] === "pt" ? "pt" : locale.split("-")[0];
  const [s, setS] = useState({
    offerId: item?.offerId ?? offers[0]?.id ?? "", qty: String(item?.qty ?? 1), points: String(item?.points ?? min * 5), stock: String(item?.stock ?? 20), perBuyer: item?.perBuyerLimit != null ? String(item.perBuyerLimit) : "",
    minTier: item?.minTier ?? "", title: item?.title ?? "", description: item?.description ?? "", validTo: item?.validTo ? new Date(item.validTo).toISOString().slice(0, 10) : "",
  });
  const set = (k: keyof typeof s, v: string) => setS({ ...s, [k]: v });
  const int = (v: string) => (v.trim() === "" ? null : Math.trunc(Number(v)));
  const submit = () => run(() => saveSupplierRewardAction({
    id: item?.id ?? null, offerId: s.offerId, qty: int(s.qty) ?? 1, points: int(s.points) ?? 0, stock: int(s.stock), perBuyerLimit: int(s.perBuyer),
    minTier: (s.minTier || null) as (typeof REWARD_TIERS)[number] | null, title: { [lang]: s.title }, description: s.description ? { [lang]: s.description } : null, validTo: s.validTo || null,
  }), () => { if (!item) setS({ ...s, title: "", description: "" }); onDone?.(); }, l["v.saved"]);
  return (
    <form className="space-y-3" data-testid="supplier-reward-form" onSubmit={(e) => { e.preventDefault(); submit(); }}>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <div className="sm:col-span-2 lg:col-span-3"><Label className="text-xs" htmlFor="sr-offer">{l["v.product"]}</Label>
          <Select id="sr-offer" value={s.offerId} onChange={(e) => set("offerId", e.target.value)} data-testid="sr-offer">{offers.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</Select></div>
        <div className="sm:col-span-2"><Label className="text-xs" htmlFor="sr-title">{l["v.name"]}</Label><Input id="sr-title" required maxLength={120} value={s.title} onChange={(e) => set("title", e.target.value)} data-testid="sr-title" /></div>
        <div><Label className="text-xs" htmlFor="sr-qty">{l["v.qty"]}</Label><Input id="sr-qty" type="number" min={1} max={100} value={s.qty} onChange={(e) => set("qty", e.target.value)} data-testid="sr-qty" /></div>
        <div><Label className="text-xs" htmlFor="sr-points">{l["v.points"]}</Label><Input id="sr-points" type="number" min={min} max={max} value={s.points} onChange={(e) => set("points", e.target.value)} data-testid="sr-points" />
          <p className="mt-0.5 text-[11px] text-muted-foreground">{fill(l["v.pointsHint"], { min, max })}</p></div>
        <div><Label className="text-xs" htmlFor="sr-stock">{l["v.stock"]}</Label><Input id="sr-stock" type="number" min={0} value={s.stock} onChange={(e) => set("stock", e.target.value)} data-testid="sr-stock" /></div>
        <div><Label className="text-xs" htmlFor="sr-per">{l["v.perBuyer"]}</Label><Input id="sr-per" type="number" min={1} value={s.perBuyer} onChange={(e) => set("perBuyer", e.target.value)} /></div>
        <div><Label className="text-xs" htmlFor="sr-tier">{l["v.minTier"]}</Label>
          <Select id="sr-tier" value={s.minTier} onChange={(e) => set("minTier", e.target.value)}><option value="">{l["v.anyTier"]}</option>{REWARD_TIERS.map((t) => <option key={t} value={t}>{l[`tiers.${t}`]}</option>)}</Select></div>
        <div><Label className="text-xs" htmlFor="sr-until">{l["v.until"]}</Label><Input id="sr-until" type="date" value={s.validTo} onChange={(e) => set("validTo", e.target.value)} /></div>
        <div className="sm:col-span-2 lg:col-span-3"><Label className="text-xs" htmlFor="sr-desc">{l["v.descr"]}</Label><textarea id="sr-desc" className={TA} rows={2} maxLength={2000} value={s.description} onChange={(e) => set("description", e.target.value)} /></div>
      </div>
      <p className="text-xs text-muted-foreground">{l["v.approvalNote"]} {l["v.cost"]}</p>
      <div className="flex flex-wrap items-center gap-3"><Button type="submit" disabled={pending || !offers.length} data-testid="sr-save"><Spin on={pending} icon={Save} /> {l["v.save"]}</Button><Msg error={error} done={done} /></div>
    </form>
  );
}

export function SupplierRewardEditor({ l, locale, offers, item, min, max }: { l: L; locale: string; offers: { id: string; name: string }[]; item: SupplierItem; min: number; max: number }) {
  const [open, setOpen] = useState(false);
  if (!open) return <Button size="sm" variant="outline" onClick={() => setOpen(true)} data-testid="sr-edit">{l["v.edit"]}</Button>;
  return <div className="mt-3 w-full rounded-lg border p-3"><SupplierRewardForm l={l} locale={locale} offers={offers} item={item} min={min} max={max} onDone={() => setOpen(false)} /></div>;
}

export function SupplierStatus({ l, id, status }: { l: L; id: string; status: string }) {
  const { pending, error, run } = useRun();
  const go = (s: "ACTIVE" | "PAUSED" | "ENDED") => run(() => supplierRewardStatusAction({ id, status: s }));
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {status === "ACTIVE" && <Button size="sm" variant="ghost" disabled={pending} onClick={() => go("PAUSED")} data-testid="sr-pause"><Pause className="size-4" aria-hidden /> {l["v.pause"]}</Button>}
      {status === "PAUSED" && <Button size="sm" variant="ghost" disabled={pending} onClick={() => go("ACTIVE")}><Play className="size-4" aria-hidden /> {l["v.resume"]}</Button>}
      {status !== "ENDED" && <Button size="sm" variant="ghost" disabled={pending} onClick={() => { if (window.confirm(l["v.endConfirm"])) go("ENDED"); }}><Square className="size-4" aria-hidden /> {l["v.end"]}</Button>}
      <Msg error={error} />
    </span>
  );
}

export function CantGive({ l, id }: { l: L; id: string }) {
  const { pending, error, run } = useRun();
  const [open, setOpen] = useState(false), [reason, setReason] = useState("");
  if (!open) return <Button size="sm" variant="ghost" onClick={() => setOpen(true)} data-testid="cant-give"><Ban className="size-4" aria-hidden /> {l["v.cantGive"]}</Button>;
  return (
    <span className="flex w-full flex-wrap items-end gap-2">
      <span className="min-w-48 flex-1"><Label className="text-xs" htmlFor={`cg-${id}`}>{l["v.reason"]}</Label><Input id={`cg-${id}`} value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} data-testid="cant-give-reason" /></span>
      <Button size="sm" variant="destructive" disabled={pending || !reason.trim()} onClick={() => { if (window.confirm(l["v.confirmCancel"])) run(() => supplierCancelRedemptionAction({ id, reason })); }} data-testid="cant-give-ok"><Spin on={pending} icon={Check} /> OK</Button>
      <Msg error={error} />
    </span>
  );
}
