"use client";
/** Buying groups (Phase 49) — the buyer's and the supplier's forms and buttons. Texts come in as `l`. */
import { useEffect, useState } from "react";
import { Ban, Check, Crown, DoorOpen, Lock, Minus, Plus, Save, Send, ShoppingBasket, Tag, Trash2, UserPlus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";
import { Msg, Spin, useRun } from "@/components/shared/run";
import {
  cancelRoundAction, closeGroupAction, createGroupAction, decideRequestAction, inviteMemberAction, leaveGroupAction, openRoundAction, placeRoundAction,
  removeMemberAction, requestJoinAction, respondInviteAction, roundOffersAction, setGroupPricesAction, setRoleAction, setRoundLineAction, stopGroupPricesAction, updateGroupAction,
} from "@/server/actions/buying-groups";

export type L = Record<string, string>;
const f = (s: string | undefined, v: Record<string, string | number> = {}) => (s ?? "").replace(/\{(\w+)\}/g, (_, k: string) => String(v[k] ?? `{${k}}`));
const textarea = "min-h-20 w-full rounded-lg border bg-transparent px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring";

export function RespondInvite({ l, groupId }: { l: L; groupId: string }) {
  const { pending, error, run } = useRun();
  return (
    <span className="flex flex-wrap items-center gap-2">
      <Button size="sm" disabled={pending} onClick={() => run(() => respondInviteAction({ groupId, accept: true }))} data-testid="bg-accept"><Spin on={pending} icon={Check} /> {l.join}</Button>
      <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => respondInviteAction({ groupId, accept: false }))} data-testid="bg-decline"><X className="size-4" /> {l.decline}</Button>
      <Msg error={error} />
    </span>
  );
}

export function CreateGroup({ l, auto }: { l: L; auto: boolean }) {
  const { pending, error, run, router } = useRun();
  const [name, setName] = useState(""), [description, setDescription] = useState(""), [open, setOpen] = useState(true);
  return (
    <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); run(() => createGroupAction({ name, description: description || null, open }), (d) => router.push(`/buy/groups/${(d as { id: string }).id}`)); }} data-testid="bg-create">
      <p className="text-sm text-muted-foreground">{auto ? l.createHintAuto : l.createHint}</p>
      <div><Label htmlFor="bg-name">{l.name}</Label><Input id="bg-name" required maxLength={80} placeholder={l.namePh} value={name} onChange={(e) => setName(e.target.value)} data-testid="bg-name" /></div>
      <div><Label htmlFor="bg-desc">{l.description}</Label><textarea id="bg-desc" className={textarea} maxLength={500} value={description} onChange={(e) => setDescription(e.target.value)} /></div>
      <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-0.5" checked={open} onChange={(e) => setOpen(e.target.checked)} /> {l.openLabel}</label>
      <Button type="submit" disabled={pending || !name.trim()} data-testid="bg-create-btn"><Spin on={pending} icon={Plus} /> {l.createBtn}</Button>
      <Msg error={error} />
    </form>
  );
}

export function AskJoin({ l, groupId }: { l: L; groupId: string }) {
  const { pending, error, done, run } = useRun();
  const [message, setMessage] = useState("");
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Input aria-label={l.message} placeholder={l.message} value={message} maxLength={300} onChange={(e) => setMessage(e.target.value)} className="h-9 min-w-0 flex-1 sm:max-w-xs" />
      <Button size="sm" disabled={pending || !!done} onClick={() => run(() => requestJoinAction({ groupId, message: message || null }), undefined, l.asked)} data-testid="bg-ask"><Spin on={pending} icon={Send} /> {l.askJoin}</Button>
      <Msg error={error} done={done} />
    </div>
  );
}

export function EditGroup({ l, group }: { l: L; group: { id: string; name: string; description: string | null; open: boolean } }) {
  const { pending, error, done, run } = useRun();
  const [name, setName] = useState(group.name), [description, setDescription] = useState(group.description ?? ""), [open, setOpen] = useState(group.open);
  return (
    <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); run(() => updateGroupAction({ id: group.id, name, description: description || null, open }), undefined, l.saved); }} data-testid="bg-edit">
      <div><Label htmlFor="bg-ename">{l.name}</Label><Input id="bg-ename" required maxLength={80} value={name} onChange={(e) => setName(e.target.value)} /></div>
      <div><Label htmlFor="bg-edesc">{l.description}</Label><textarea id="bg-edesc" className={textarea} maxLength={500} value={description} onChange={(e) => setDescription(e.target.value)} /></div>
      <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-0.5" checked={open} onChange={(e) => setOpen(e.target.checked)} /> {l.openLabel}</label>
      <Button type="submit" size="sm" disabled={pending}><Spin on={pending} icon={Save} /> {l.save}</Button>
      <Msg error={error} done={done} />
    </form>
  );
}

/** After an invitation, the server answers with the business name: show it. */
export function InviteForm({ l, groupId }: { l: L; groupId: string }) {
  const { pending, error, run } = useRun();
  const [taxId, setTaxId] = useState(""), [ok, setOk] = useState<string | null>(null);
  return (
    <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); setOk(null); run(() => inviteMemberAction({ groupId, taxId }), (d) => { setTaxId(""); setOk(f(l.invitedOk, { company: (d as { company: string }).company })); }); }} data-testid="bg-invite">
      <div className="min-w-0 flex-1 sm:max-w-xs"><Label htmlFor="bg-tax">{l.taxId}</Label><Input id="bg-tax" required value={taxId} onChange={(e) => setTaxId(e.target.value)} data-testid="bg-tax" /></div>
      <Button type="submit" size="sm" disabled={pending || taxId.trim().length < 5} data-testid="bg-invite-btn"><Spin on={pending} icon={UserPlus} /> {l.inviteBtn}</Button>
      <div className="basis-full"><Msg error={error} done={ok} /></div>
    </form>
  );
}

export function DecideRequest({ l, groupId, companyId }: { l: L; groupId: string; companyId: string }) {
  const { pending, error, run } = useRun();
  return (
    <span className="flex flex-wrap items-center gap-2">
      <Button size="sm" disabled={pending} onClick={() => run(() => decideRequestAction({ groupId, companyId, accept: true }))} data-testid="bg-req-accept"><Check className="size-4" /> {l.accept}</Button>
      <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => decideRequestAction({ groupId, companyId, accept: false }))} data-testid="bg-req-decline"><X className="size-4" /> {l.decline}</Button>
      <Msg error={error} />
    </span>
  );
}

export function MemberActions({ l, groupId, companyId, role }: { l: L; groupId: string; companyId: string; role: "ADMIN" | "MEMBER" }) {
  const { pending, error, run } = useRun();
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => setRoleAction({ groupId, companyId, role: role === "ADMIN" ? "MEMBER" : "ADMIN" }))} data-testid="bg-role"><Crown className="size-4" /> {role === "ADMIN" ? l.makeMember : l.makeAdmin}</Button>
      <Button size="sm" variant="ghost" disabled={pending} onClick={() => { if (window.confirm(l.removeConfirm)) run(() => removeMemberAction({ groupId, companyId })); }} data-testid="bg-remove"><Trash2 className="size-4" /> {l.remove}</Button>
      <Msg error={error} />
    </span>
  );
}

export function LeaveGroup({ l, groupId }: { l: L; groupId: string }) {
  const { pending, error, run, router } = useRun();
  return <span className="inline-flex flex-wrap items-center gap-2"><Button size="sm" variant="outline" disabled={pending} onClick={() => { if (window.confirm(l.leaveConfirm)) run(() => leaveGroupAction({ groupId }), () => router.push("/buy/groups")); }} data-testid="bg-leave"><Spin on={pending} icon={DoorOpen} /> {l.leave}</Button><Msg error={error} /></span>;
}

export function CloseGroup({ label, confirm, groupId }: { label: string; confirm: string; groupId: string }) {
  const { pending, error, run } = useRun();
  return <span className="inline-flex flex-wrap items-center gap-2"><Button size="sm" variant="outline" disabled={pending} onClick={() => { if (window.confirm(confirm)) run(() => closeGroupAction({ groupId })); }} data-testid="bg-close"><Spin on={pending} icon={Lock} /> {label}</Button><Msg error={error} /></span>;
}

const localInput = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);

export function OpenRound({ l, groupId, suppliers, maxDays }: { l: L; groupId: string; suppliers: { id: string; name: string }[]; maxDays: number }) {
  const { pending, error, run, router } = useRun();
  const [seller, setSeller] = useState(suppliers[0]?.id ?? ""), [title, setTitle] = useState(""), [note, setNote] = useState("");
  const [closes, setCloses] = useState(() => localInput(new Date(Date.now() + 2 * 86_400_000)));
  const [delivery, setDelivery] = useState(() => new Date(Date.now() + 4 * 86_400_000).toISOString().slice(0, 10));
  const max = localInput(new Date(Date.now() + maxDays * 86_400_000));
  return (
    <form className="grid gap-3 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); run(() => openRoundAction({ groupId, sellerCompanyId: seller, title, note: note || null, closesAt: new Date(closes).toISOString(), deliveryDate: delivery }), (d) => router.push(`/buy/groups/${groupId}/rounds/${(d as { id: string }).id}`)); }} data-testid="bg-round-form">
      <div className="sm:col-span-2"><Label htmlFor="bg-seller">{l.supplier}</Label><Select id="bg-seller" value={seller} onChange={(e) => setSeller(e.target.value)} data-testid="bg-seller">{suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select></div>
      <div className="sm:col-span-2"><Label htmlFor="bg-rtitle">{l.roundTitle}</Label><Input id="bg-rtitle" required maxLength={80} placeholder={l.roundTitlePh} value={title} onChange={(e) => setTitle(e.target.value)} data-testid="bg-rtitle" /></div>
      <div><Label htmlFor="bg-closes">{l.closesAt}</Label><Input id="bg-closes" type="datetime-local" required max={max} value={closes} onChange={(e) => setCloses(e.target.value)} data-testid="bg-closes" /></div>
      <div><Label htmlFor="bg-deliv">{l.deliveryDate}</Label><Input id="bg-deliv" type="date" required value={delivery} onChange={(e) => setDelivery(e.target.value)} data-testid="bg-deliv" /></div>
      <div className="sm:col-span-2"><Label htmlFor="bg-rnote">{l.note}</Label><textarea id="bg-rnote" className={textarea} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} /></div>
      <div className="sm:col-span-2"><Button type="submit" disabled={pending || !seller || !title.trim()} data-testid="bg-round-open"><Spin on={pending} icon={ShoppingBasket} /> {l.openRoundBtn}</Button></div>
      <div className="sm:col-span-2"><Msg error={error} /></div>
    </form>
  );
}

type Line = { offerId: string; label: string; qty: number; addressId: string | null };
/** A member's lines in an open round: search the supplier's products, add, change or remove. */
export function RoundLines({ l, roundId, mine, addresses }: { l: L; roundId: string; mine: Line[]; addresses: { id: string; label: string | null; line1: string; isDefault: boolean }[] }) {
  const { pending, error, run } = useRun();
  const [q, setQ] = useState(""), [hits, setHits] = useState<{ id: string; label: string }[]>([]), [qty, setQty] = useState<Record<string, number>>({});
  const [addressId, setAddressId] = useState(mine.find((m) => m.addressId)?.addressId ?? addresses[0]?.id ?? "");
  useEffect(() => {
    const t = setTimeout(async () => { const r = await roundOffersAction({ roundId, q }); if (r.ok) setHits(r.data as typeof hits); }, 250);
    return () => clearTimeout(t);
  }, [q, roundId]);
  const set = (offerId: string, n: number) => run(() => setRoundLineAction({ roundId, offerId, qty: Math.max(0, n), addressId: addressId || null }));
  return (
    <div className="space-y-4">
      {addresses.length > 1 && (
        <div className="max-w-md"><Label htmlFor="bg-addr">{l.address}</Label>
          <Select id="bg-addr" value={addressId} onChange={(e) => { setAddressId(e.target.value); for (const m of mine) run(() => setRoundLineAction({ roundId, offerId: m.offerId, qty: m.qty, addressId: e.target.value })); }}>
            {addresses.map((a) => <option key={a.id} value={a.id}>{a.label ? `${a.label} — ` : ""}{a.line1}</option>)}
          </Select>
        </div>
      )}
      <div>
        <h3 className="mb-2 text-sm font-medium">{l.myLines}</h3>
        {!mine.length ? <p className="text-sm text-muted-foreground">{l.noLines}</p> : (
          <ul className="divide-y rounded-lg border" data-testid="bg-my-lines">
            {mine.map((m) => (
              <li key={m.offerId} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm" data-testid="bg-my-line">
                <span className="min-w-0 basis-full break-words sm:basis-auto sm:flex-1">{m.label}</span>
                <span className="inline-flex items-center gap-1">
                  <Button size="sm" variant="outline" aria-label="−" disabled={pending} onClick={() => set(m.offerId, m.qty - 1)}><Minus className="size-3.5" /></Button>
                  <span className="w-10 text-center tabular-nums" data-testid="bg-line-qty">{m.qty}</span>
                  <Button size="sm" variant="outline" aria-label="+" disabled={pending} onClick={() => set(m.offerId, m.qty + 1)}><Plus className="size-3.5" /></Button>
                  <Button size="sm" variant="ghost" aria-label={l.remove} disabled={pending} onClick={() => set(m.offerId, 0)}><Trash2 className="size-4" /></Button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div>
        <h3 className="mb-2 text-sm font-medium">{l.addProduct}</h3>
        <Input placeholder={l.searchProduct} value={q} onChange={(e) => setQ(e.target.value)} data-testid="bg-offer-search" />
        <ul className="mt-2 max-h-72 divide-y overflow-y-auto rounded-lg border" data-testid="bg-offers">
          {hits.map((h) => (
            <li key={h.id} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm" data-testid="bg-offer">
              <span className="min-w-0 basis-full break-words sm:basis-auto sm:flex-1">{h.label}</span>
              <Input type="number" min={1} aria-label={l.qty} className="h-8 w-20" value={qty[h.id] ?? 1} onChange={(e) => setQty((x) => ({ ...x, [h.id]: Number(e.target.value) }))} />
              <Button size="sm" disabled={pending} onClick={() => set(h.id, (mine.find((m) => m.offerId === h.id)?.qty ?? 0) + Math.max(1, Math.floor(qty[h.id] ?? 1)))} data-testid="bg-offer-add"><Plus className="size-4" /> {l.add}</Button>
            </li>
          ))}
        </ul>
      </div>
      <Msg error={error} />
    </div>
  );
}

export function RoundAdmin({ l, roundId }: { l: L; roundId: string }) {
  const { pending, error, run } = useRun();
  const [done, setDone] = useState<string | null>(null);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button disabled={pending} onClick={() => { if (window.confirm(l.placeConfirm)) run(() => placeRoundAction({ roundId }), (d) => setDone(f(l.placed, d as { placed: number; failed: number }))); }} data-testid="bg-place"><Spin on={pending} icon={Send} /> {l.placeNow}</Button>
      <Button variant="outline" disabled={pending} onClick={() => { if (window.confirm(l.cancelConfirm)) run(() => cancelRoundAction({ roundId })); }} data-testid="bg-cancel"><Ban className="size-4" /> {l.cancelRound}</Button>
      <Msg error={error} done={done} />
    </div>
  );
}

// ── supplier ────────────────────────────────────────────────────────────────

export function GroupPricesForm({ l, groupId, offers, locale }: { l: L; groupId: string; offers: { id: string; label: string; sku: string; base: number | null }[]; locale: string }) {
  const { pending, error, done, run } = useRun();
  const [mode, setMode] = useState<"pct" | "items">("pct"), [pct, setPct] = useState("5"), [validTo, setValidTo] = useState("");
  const [prices, setPrices] = useState<Record<string, string>>({}), [q, setQ] = useState("");
  const money = (n: number) => new Intl.NumberFormat(locale, { style: "currency", currency: "EUR" }).format(n);
  const shown = offers.filter((o) => !q || `${o.label} ${o.sku}`.toLowerCase().includes(q.toLowerCase())).slice(0, 200);
  const save = () => run(() => setGroupPricesAction({
    groupId, validTo: validTo || null,
    ...(mode === "pct" ? { pct: Number(pct) } : { items: Object.entries(prices).filter(([, v]) => Number(v) > 0).map(([offerId, v]) => ({ offerId, price: Number(v) })) }),
  }), undefined, l.vSaved);
  return (
    <div className="space-y-3" data-testid="bg-prices-form">
      <div className="flex flex-wrap gap-4 text-sm">
        <label className="flex items-center gap-2"><input type="radio" checked={mode === "pct"} onChange={() => setMode("pct")} data-testid="bg-mode-pct" /> {l.vModePct}</label>
        <label className="flex items-center gap-2"><input type="radio" checked={mode === "items"} onChange={() => setMode("items")} data-testid="bg-mode-items" /> {l.vModeItems}</label>
      </div>
      {mode === "pct" ? (
        <div className="max-w-xs"><Label htmlFor={`bg-pct-${groupId}`}>{l.vPct}</Label><Input id={`bg-pct-${groupId}`} type="number" step="0.1" min={0.1} max={50} value={pct} onChange={(e) => setPct(e.target.value)} data-testid="bg-pct" /><p className="mt-1 text-xs text-muted-foreground">{l.vPctHint}</p></div>
      ) : (
        <div className="rounded-lg border">
          <Input className="rounded-b-none border-0 border-b" placeholder={l.searchProduct} value={q} onChange={(e) => setQ(e.target.value)} />
          <ul className="max-h-72 divide-y overflow-y-auto">
            {shown.map((o) => (
              <li key={o.id} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
                <span className="min-w-0 basis-full break-words sm:basis-auto sm:flex-1">{o.label} <span className="text-xs text-muted-foreground">{o.sku}{o.base != null ? ` · ${f(l.vBase, { price: money(o.base) })}` : ""}</span></span>
                <Input type="number" step="0.01" min={0} aria-label={l.vPrice} placeholder="€" className="h-8 w-28" value={prices[o.id] ?? ""} onChange={(e) => setPrices((x) => ({ ...x, [o.id]: e.target.value }))} data-testid="bg-item-price" />
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="max-w-xs"><Label htmlFor={`bg-vt-${groupId}`}>{l.vValidTo}</Label><Input id={`bg-vt-${groupId}`} type="date" value={validTo} onChange={(e) => setValidTo(e.target.value)} /></div>
      <Button size="sm" disabled={pending} onClick={save} data-testid="bg-prices-save"><Spin on={pending} icon={Tag} /> {l.vSave}</Button>
      <Msg error={error} done={done} />
    </div>
  );
}

export function StopGroupPrices({ l, groupId }: { l: L; groupId: string }) {
  const { pending, error, done, run } = useRun();
  return <span className="inline-flex flex-wrap items-center gap-2"><Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => stopGroupPricesAction({ groupId }), undefined, l.vStopped)} data-testid="bg-prices-stop"><Spin on={pending} icon={Ban} /> {l.vStop}</Button><Msg error={error} done={done} /></span>;
}
