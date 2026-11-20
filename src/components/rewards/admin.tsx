"use client";
/** FIRINGI's rewards shop (Phase 55, English): reward form, picture, partner codes, approval, gifts, settings and per-business switches. */
import { useEffect, useState } from "react";
import { Ban, Check, Image as ImageIcon, PackageCheck, Pause, Play, Plus, Save, Send, Square, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";
import { Msg, Spin, useRun } from "@/components/shared/run";
import {
  addPartnerCodesAction, adminCancelRedemptionAction, findRewardsBusinessAction, fulfilGiftAction, removeUnusedCodesAction, reviewRewardAction, rewardStatusAction,
  saveAdminRewardAction, saveRewardsSettingsAction, setRewardImageAction, setRewardsSwitchAction,
} from "@/server/actions/rewards";
import { REWARD_BUYER_TYPES, REWARD_KINDS, REWARD_TIERS, type RewardKindT, type RewardsSettings } from "@/lib/rewards";
import { TA } from "./client";

const LANGS = [["en", "English"], ["pt", "Portuguese"], ["es", "Spanish"]] as const;
const KIND_LABEL: Record<RewardKindT, string> = { VOUCHER: "Voucher (€ off)", FREE_DELIVERY: "Free delivery", SUPPLIER_PRODUCT: "Supplier product", GIFT: "Gift / merchandise", PARTNER: "Partner offer" };

function Box({ label, checked, onChange, hint, testid }: { label: string; checked: boolean; onChange: (v: boolean) => void; hint?: string; testid?: string }) {
  return <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-0.5" checked={checked} onChange={(e) => onChange(e.target.checked)} data-testid={testid} /><span>{label}{hint && <span className="block text-xs text-muted-foreground">{hint}</span>}</span></label>;
}
function Num({ label, value, onChange, hint, testid, step = 1 }: { label: string; value: number; onChange: (v: number) => void; hint?: string; testid?: string; step?: number }) {
  return <div><Label className="text-xs">{label}</Label><Input type="number" step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} data-testid={testid} />{hint && <p className="mt-0.5 text-[11px] text-muted-foreground">{hint}</p>}</div>;
}

export type AdminRewardInitial = {
  id: string; kind: RewardKindT; status: string; points: number; stock: number | null; perBuyerLimit: number | null; minTier: string | null; buyerTypes: string[]; countryCodes: string[];
  validFrom: Date | string; validTo: Date | string | null; featured: boolean; sortOrder: number; titles: Record<string, string>; descriptions: Record<string, string>; termsAll: Record<string, string>;
  voucherAmount: number | null; voucherMinOrder: number | null; voucherDays: number | null; giftCost: number | null; partnerName: string | null; partnerUrl: string | null;
};

export function AdminRewardForm({ initial, kind: newKind, pointValue, defaultDays }: { initial?: AdminRewardInitial | null; kind?: RewardKindT; pointValue: number; defaultDays: number }) {
  const { pending, error, done, run, router } = useRun();
  const kind = initial?.kind ?? newKind ?? "VOUCHER";
  const d = (v: Date | string | null | undefined) => (v ? new Date(v).toISOString().slice(0, 10) : "");
  const [s, setS] = useState({
    points: String(initial?.points ?? 1000), stock: initial?.stock != null ? String(initial.stock) : kind === "GIFT" ? "50" : "", perBuyer: initial?.perBuyerLimit != null ? String(initial.perBuyerLimit) : "",
    minTier: initial?.minTier ?? "", buyerTypes: initial?.buyerTypes ?? [], countries: (initial?.countryCodes ?? []).join(", "), validFrom: d(initial?.validFrom), validTo: d(initial?.validTo),
    featured: initial?.featured ?? false, sortOrder: String(initial?.sortOrder ?? 0),
    title: { en: "", pt: "", es: "", ...(initial?.titles ?? {}) } as Record<string, string>, description: { en: "", pt: "", es: "", ...(initial?.descriptions ?? {}) } as Record<string, string>, terms: { en: "", pt: "", es: "", ...(initial?.termsAll ?? {}) } as Record<string, string>,
    voucherAmount: initial?.voucherAmount != null ? String(initial.voucherAmount) : "10", voucherMinOrder: initial?.voucherMinOrder != null ? String(initial.voucherMinOrder) : "", voucherDays: initial?.voucherDays != null ? String(initial.voucherDays) : String(defaultDays),
    giftCost: initial?.giftCost != null ? String(initial.giftCost) : "", partnerName: initial?.partnerName ?? "", partnerUrl: initial?.partnerUrl ?? "",
  });
  const set = <K extends keyof typeof s>(k: K, v: (typeof s)[K]) => setS({ ...s, [k]: v });
  const n = (v: string) => (v.trim() === "" ? null : Number(v.replace(",", ".")));
  const coupon = kind === "VOUCHER" || kind === "FREE_DELIVERY";
  const worth = (Number(s.points) || 0) * pointValue;
  const generous = kind === "VOUCHER" && (n(s.voucherAmount) ?? 0) > worth;
  const submit = (status?: "DRAFT" | "ACTIVE") => run(() => saveAdminRewardAction({
    id: initial?.id ?? null, kind, points: Math.trunc(Number(s.points)), stock: n(s.stock) == null ? null : Math.trunc(n(s.stock)!), perBuyerLimit: n(s.perBuyer) == null ? null : Math.trunc(n(s.perBuyer)!),
    minTier: (s.minTier || null) as (typeof REWARD_TIERS)[number] | null, buyerTypes: s.buyerTypes as (typeof REWARD_BUYER_TYPES)[number][], countryCodes: s.countries.split(/[,\s]+/).filter(Boolean),
    validFrom: s.validFrom || null, validTo: s.validTo || null, featured: s.featured, sortOrder: Math.trunc(Number(s.sortOrder) || 0),
    title: s.title, description: s.description, terms: s.terms,
    voucherAmount: kind === "VOUCHER" ? n(s.voucherAmount) : null, voucherMinOrder: coupon ? n(s.voucherMinOrder) : null, voucherDays: coupon ? n(s.voucherDays) : null,
    giftCost: kind === "GIFT" ? n(s.giftCost) : null, partnerName: kind === "PARTNER" ? s.partnerName : null, partnerUrl: kind === "PARTNER" ? s.partnerUrl || null : null, ...(status ? { status } : {}),
  }), (data) => { if (!initial) router.push(`/admin/marketing/rewards/${(data as { id: string }).id}`); }, "Saved.");
  return (
    <form className="space-y-5" data-testid="ar-form" onSubmit={(e) => { e.preventDefault(); submit(initial ? undefined : "ACTIVE"); }}>
      <p className="text-sm"><span className="font-medium">{KIND_LABEL[kind]}</span>{kind === "SUPPLIER_PRODUCT" && <span className="text-muted-foreground"> — set by the supplier; FIRINGI accepts or rejects it.</span>}</p>
      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Num label="Points" value={Number(s.points)} onChange={(v) => set("points", String(v))} testid="ar-points" hint={`Worth ${worth.toFixed(2)} € as a checkout discount`} />
        {kind !== "PARTNER" && <div><Label className="text-xs">Stock{kind !== "GIFT" && " (empty = unlimited)"}</Label><Input type="number" min={0} value={s.stock} onChange={(e) => set("stock", e.target.value)} data-testid="ar-stock" /></div>}
        <div><Label className="text-xs">Per business (empty = no limit)</Label><Input type="number" min={1} value={s.perBuyer} onChange={(e) => set("perBuyer", e.target.value)} /></div>
        <div><Label className="text-xs">Lowest loyalty tier</Label><Select value={s.minTier} onChange={(e) => set("minTier", e.target.value)}><option value="">Any</option>{REWARD_TIERS.map((t) => <option key={t} value={t}>{t[0] + t.slice(1).toLowerCase()}</option>)}</Select></div>
        {kind === "VOUCHER" && <div><Label className="text-xs">Voucher amount (€, net)</Label><Input inputMode="decimal" value={s.voucherAmount} onChange={(e) => set("voucherAmount", e.target.value)} data-testid="ar-amount" />{generous && <p className="mt-0.5 text-[11px] text-amber-600 dark:text-warning">Worth more than its points ({worth.toFixed(2)} €) — FIRINGI pays the difference.</p>}</div>}
        {coupon && <div><Label className="text-xs">Minimum order (€, optional)</Label><Input inputMode="decimal" value={s.voucherMinOrder} onChange={(e) => set("voucherMinOrder", e.target.value)} /></div>}
        {coupon && <div><Label className="text-xs">Valid for (days after redeeming)</Label><Input type="number" min={1} max={365} value={s.voucherDays} onChange={(e) => set("voucherDays", e.target.value)} /></div>}
        {kind === "GIFT" && <div><Label className="text-xs">Cost to FIRINGI (€, reports)</Label><Input inputMode="decimal" value={s.giftCost} onChange={(e) => set("giftCost", e.target.value)} /></div>}
        {kind === "PARTNER" && <div><Label className="text-xs">Partner</Label><Input value={s.partnerName} maxLength={120} onChange={(e) => set("partnerName", e.target.value)} data-testid="ar-partner" /></div>}
        {kind === "PARTNER" && <div className="sm:col-span-2"><Label className="text-xs">Partner link (https://, optional)</Label><Input value={s.partnerUrl} maxLength={500} onChange={(e) => set("partnerUrl", e.target.value)} /></div>}
      </section>
      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div><Label className="text-xs">From</Label><Input type="date" value={s.validFrom} onChange={(e) => set("validFrom", e.target.value)} /></div>
        <div><Label className="text-xs">Until (optional)</Label><Input type="date" value={s.validTo} onChange={(e) => set("validTo", e.target.value)} /></div>
        <div><Label className="text-xs">Countries (codes, empty = all)</Label><Input value={s.countries} placeholder="PT, ES" onChange={(e) => set("countries", e.target.value)} /></div>
        <div><Label className="text-xs">Order in the shop</Label><Input type="number" value={s.sortOrder} onChange={(e) => set("sortOrder", e.target.value)} /></div>
        <div className="flex flex-wrap items-center gap-4 sm:col-span-2 lg:col-span-4">
          <span className="text-xs text-muted-foreground">For (none ticked = all):</span>
          {REWARD_BUYER_TYPES.map((t) => <Box key={t} label={t === "CUSTOMER" ? "Customers" : "Wholesalers"} checked={s.buyerTypes.includes(t)} onChange={(v) => set("buyerTypes", v ? [...s.buyerTypes, t] : s.buyerTypes.filter((x) => x !== t))} />)}
          <Box label="Featured (shown first)" checked={s.featured} onChange={(v) => set("featured", v)} />
        </div>
      </section>
      <section className="space-y-3">
        <h3 className="text-sm font-semibold">Texts</h3>
        <p className="text-xs text-muted-foreground">English is required; other languages fall back to English.</p>
        <div className="grid gap-3 lg:grid-cols-3">
          {LANGS.map(([code, name]) => (
            <div key={code} className="space-y-2 rounded-lg border p-3">
              <p className="text-xs font-medium">{name}</p>
              <Input aria-label={`Title (${name})`} placeholder="Title" value={s.title[code] ?? ""} maxLength={120} onChange={(e) => set("title", { ...s.title, [code]: e.target.value })} data-testid={`ar-title-${code}`} />
              <textarea aria-label={`Description (${name})`} placeholder="Description" rows={2} className={TA} value={s.description[code] ?? ""} maxLength={2000} onChange={(e) => set("description", { ...s.description, [code]: e.target.value })} />
              <textarea aria-label={`Terms (${name})`} placeholder="Terms" rows={2} className={TA} value={s.terms[code] ?? ""} maxLength={4000} onChange={(e) => set("terms", { ...s.terms, [code]: e.target.value })} />
            </div>
          ))}
        </div>
      </section>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={pending || kind === "SUPPLIER_PRODUCT"} data-testid="ar-save"><Spin on={pending} icon={Save} /> {initial ? "Save" : "Save and publish"}</Button>
        {!initial && <Button type="button" variant="outline" disabled={pending} onClick={() => submit("DRAFT")}>Save as draft</Button>}
        <Msg error={error} done={done} />
      </div>
    </form>
  );
}

export function RewardImage({ id, image }: { id: string; image: string | null }) {
  const { pending, error, run } = useRun();
  const send = (file: File | null) => { const fd = new FormData(); fd.set("id", id); if (file) fd.set("file", file); run(() => setRewardImageAction(fd)); };
  return (
    <div className="space-y-2">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {image ? <img src={image} alt="" className="h-32 w-full rounded-lg border bg-white object-contain dark:bg-muted" /> : <div className="grid h-32 place-items-center rounded-lg border border-dashed text-muted-foreground"><ImageIcon className="size-8" aria-hidden /></div>}
      <div className="flex flex-wrap items-center gap-2">
        <label className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-md border px-3 text-sm hover:bg-accent">{pending ? "…" : "Upload picture"}<input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={(e) => { const f = e.target.files?.[0]; if (f) send(f); }} /></label>
        {image && <Button size="sm" variant="ghost" disabled={pending} onClick={() => send(null)}><Trash2 className="size-4" aria-hidden /> Remove</Button>}
      </div>
      <Msg error={error} />
    </div>
  );
}

export function PartnerCodes({ id, codes }: { id: string; codes: { total: number; used: number; left: number } }) {
  const { pending, error, run } = useRun();
  const [text, setText] = useState(""), [info, setInfo] = useState<string | null>(null);
  return (
    <div className="space-y-2" data-testid="partner-codes">
      <p className="text-sm"><span className="font-semibold tabular-nums" data-testid="codes-left">{codes.left}</span> unused · {codes.used} given · {codes.total} in total</p>
      <textarea className={TA} rows={4} placeholder="Paste codes, one per line" value={text} onChange={(e) => setText(e.target.value)} data-testid="codes-text" />
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" disabled={pending || !text.trim()} data-testid="codes-add" onClick={() => run(() => addPartnerCodesAction({ id, text }), (d) => { setText(""); const r = d as { added: number; skipped: number; bad: number }; setInfo(`${r.added} added · ${r.skipped} already there · ${r.bad} not valid`); })}><Spin on={pending} icon={Plus} /> Add codes</Button>
        {codes.left > 0 && <Button size="sm" variant="ghost" disabled={pending} onClick={() => { if (window.confirm("Remove every unused code?")) run(() => removeUnusedCodesAction({ id })); }}><Trash2 className="size-4" aria-hidden /> Remove unused</Button>}
        <Msg error={error} done={info} />
      </div>
    </div>
  );
}

export function RewardStatusButtons({ id, status }: { id: string; status: string }) {
  const { pending, error, run } = useRun();
  const go = (s: "ACTIVE" | "PAUSED" | "ENDED") => run(() => rewardStatusAction({ id, status: s }));
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {(status === "DRAFT" || status === "PAUSED") && <Button size="sm" disabled={pending} onClick={() => go("ACTIVE")} data-testid="ar-publish"><Play className="size-4" aria-hidden /> Publish</Button>}
      {status === "ACTIVE" && <Button size="sm" variant="outline" disabled={pending} onClick={() => go("PAUSED")}><Pause className="size-4" aria-hidden /> Pause</Button>}
      {status !== "ENDED" && <Button size="sm" variant="ghost" disabled={pending} onClick={() => { if (window.confirm("End this reward? It leaves the shop; what was redeemed stays.")) go("ENDED"); }}><Square className="size-4" aria-hidden /> End</Button>}
      <Msg error={error} />
    </span>
  );
}

export function ReviewButtons({ id }: { id: string }) {
  const { pending, error, run } = useRun();
  const [note, setNote] = useState("");
  return (
    <div className="flex flex-wrap items-end gap-2" data-testid="ar-review">
      <div className="min-w-48 flex-1"><Label className="text-xs">Note to the supplier (needed to reject)</Label><Input value={note} maxLength={1000} onChange={(e) => setNote(e.target.value)} /></div>
      <Button size="sm" disabled={pending} onClick={() => run(() => reviewRewardAction({ id, approve: true, note: note || null }))} data-testid="ar-approve"><Spin on={pending} icon={Check} /> Accept</Button>
      <Button size="sm" variant="destructive" disabled={pending || !note.trim()} onClick={() => run(() => reviewRewardAction({ id, approve: false, note }))} data-testid="ar-reject"><X className="size-4" aria-hidden /> Reject</Button>
      <Msg error={error} />
    </div>
  );
}

export function GiftActions({ id, status }: { id: string; status: string }) {
  const { pending, error, run } = useRun();
  const [tracking, setTracking] = useState("");
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      {status === "PENDING" && <><Input className="h-8 w-44" placeholder="Tracking (optional)" value={tracking} maxLength={200} onChange={(e) => setTracking(e.target.value)} data-testid="gift-tracking" /><Button size="sm" disabled={pending} onClick={() => run(() => fulfilGiftAction({ id, action: "SHIP", tracking: tracking || null }))} data-testid="gift-ship"><Spin on={pending} icon={Send} /> Shipped</Button></>}
      {(status === "PENDING" || status === "SHIPPED") && <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => fulfilGiftAction({ id, action: "DELIVER", tracking: null }))} data-testid="gift-deliver"><PackageCheck className="size-4" aria-hidden /> Delivered</Button>}
      <Msg error={error} />
    </span>
  );
}

export function AdminCancel({ id }: { id: string }) {
  const { pending, error, run } = useRun();
  const [open, setOpen] = useState(false), [reason, setReason] = useState("");
  if (!open) return <Button size="sm" variant="ghost" onClick={() => setOpen(true)}><Ban className="size-4" aria-hidden /> Cancel</Button>;
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <Input className="h-8 w-56" placeholder="Why? (the customer sees this)" value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} />
      <Button size="sm" variant="destructive" disabled={pending || !reason.trim()} onClick={() => run(() => adminCancelRedemptionAction({ id, reason }))}><Spin on={pending} icon={Check} /> Cancel & give points back</Button>
      <Msg error={error} />
    </span>
  );
}

// ── settings ────────────────────────────────────────────────────────────────

export function RewardsSwitch({ companyId, state: initial }: { companyId: string; state: "DEFAULT" | "ON" | "OFF" }) {
  const { pending, error, run } = useRun();
  const [state, setState] = useState(initial);
  return (
    <span className="inline-flex items-center gap-1">
      <Select aria-label="Rewards shop for this business" value={state} disabled={pending} className="h-8 w-40" data-testid="rewards-switch"
        onChange={(e) => { const v = e.target.value as typeof state; const prev = state; setState(v); run(async () => { const r = await setRewardsSwitchAction({ companyId, state: v }); if (!r.ok) setState(prev); return r; }); }}>
        <option value="DEFAULT">Default (by type)</option><option value="ON">Always on</option><option value="OFF">Off</option>
      </Select>
      <Msg error={error} />
    </span>
  );
}

export function FindRewardsBusiness() {
  const [q, setQ] = useState(""), [hits, setHits] = useState<{ id: string; name: string; type: string; state: "DEFAULT" | "ON" | "OFF" }[]>([]);
  useEffect(() => {
    if (q.trim().length < 2) { setHits([]); return; }
    const t = setTimeout(async () => { const r = await findRewardsBusinessAction({ q }); if (r.ok) setHits(r.data as typeof hits); }, 250);
    return () => clearTimeout(t);
  }, [q]);
  return (
    <div className="space-y-2">
      <Input placeholder="Find a business by name or NIF…" value={q} onChange={(e) => setQ(e.target.value)} data-testid="rewards-find" />
      {hits.length > 0 && <ul className="divide-y rounded-lg border">{hits.map((h) => <li key={h.id} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm"><span className="min-w-0 flex-1 break-words">{h.name} <span className="text-xs text-muted-foreground">· {h.type.toLowerCase()}</span></span><RewardsSwitch companyId={h.id} state={h.state} /></li>)}</ul>}
    </div>
  );
}

export function RewardsSettingsForm({ initial }: { initial: RewardsSettings }) {
  const { pending, error, done, run } = useRun();
  const [s, setS] = useState(initial);
  const set = <K extends keyof RewardsSettings>(k: K, v: RewardsSettings[K]) => setS({ ...s, [k]: v });
  return (
    <form className="space-y-6" data-testid="rs-form" onSubmit={(e) => { e.preventDefault(); run(() => saveRewardsSettingsAction(s), undefined, "Saved."); }}>
      <Box label="The rewards shop is on" hint="Off: the shop closes for everyone; what was redeemed stays, and the daily job keeps statuses right." checked={s.enabled} onChange={(v) => set("enabled", v)} testid="rs-enabled" />
      <section className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-2"><h3 className="text-sm font-semibold">Kinds in the shop</h3>
          {REWARD_KINDS.map((k) => <Box key={k} label={KIND_LABEL[k]} checked={s.kinds[k]} onChange={(v) => set("kinds", { ...s.kinds, [k]: v })} testid={`rs-kind-${k}`} />)}
        </div>
        <div className="space-y-2"><h3 className="text-sm font-semibold">Who redeems</h3>
          <Box label="Customers" checked={s.buyerTypes.CUSTOMER} onChange={(v) => set("buyerTypes", { ...s.buyerTypes, CUSTOMER: v })} testid="rs-buyer-CUSTOMER" />
          <Box label="Wholesalers" checked={s.buyerTypes.WHOLESALER} onChange={(v) => set("buyerTypes", { ...s.buyerTypes, WHOLESALER: v })} testid="rs-buyer-WHOLESALER" />
          <p className="text-xs text-muted-foreground">Loyalty must be on for the business too (it holds the points).</p>
        </div>
        <div className="space-y-2"><h3 className="text-sm font-semibold">Who offers own products</h3>
          <Box label="Distributors" checked={s.supplierTypes.DISTRIBUTOR} onChange={(v) => set("supplierTypes", { ...s.supplierTypes, DISTRIBUTOR: v })} testid="rs-supplier-DISTRIBUTOR" />
          <Box label="Wholesalers" checked={s.supplierTypes.WHOLESALER} onChange={(v) => set("supplierTypes", { ...s.supplierTypes, WHOLESALER: v })} testid="rs-supplier-WHOLESALER" />
          <Box label="FIRINGI accepts supplier rewards first" checked={s.supplierApproval} onChange={(v) => set("supplierApproval", v)} testid="rs-approval" />
        </div>
      </section>
      <section className="space-y-3"><h3 className="text-sm font-semibold">Rules</h3>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Num label="Supplier rewards: fewest points" value={s.supplierMinPoints} onChange={(v) => set("supplierMinPoints", v)} />
          <Num label="Supplier rewards: most points" value={s.supplierMaxPoints} onChange={(v) => set("supplierMaxPoints", v)} />
          <Num label="Days to order a supplier product" value={s.handoverDays} onChange={(v) => set("handoverDays", v)} hint="After that it expires and the points come back." />
          <Num label="Vouchers valid for (days, default)" value={s.voucherDays} onChange={(v) => set("voucherDays", v)} />
          <Num label="Remind before a voucher expires (days)" value={s.reminderDays} onChange={(v) => set("reminderDays", v)} />
          <Num label="Low-stock alert at" value={s.lowStock} onChange={(v) => set("lowStock", v)} />
          <Num label="Most points per business per month (0 = no limit)" value={s.monthlyLimit} onChange={(v) => set("monthlyLimit", v)} testid="rs-monthly" />
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          <Box label="Points back for vouchers that expire unused" checked={s.refundExpired} onChange={(v) => set("refundExpired", v)} />
          <Box label="Businesses may cancel an unused voucher, or a gift / product not yet on its way" checked={s.buyerCancel} onChange={(v) => set("buyerCancel", v)} />
        </div>
      </section>
      <div className="flex items-center gap-3"><Button type="submit" disabled={pending} data-testid="rs-save"><Spin on={pending} icon={Check} /> Save</Button><Msg error={error} done={done} /></div>
    </form>
  );
}
