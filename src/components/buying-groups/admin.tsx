"use client";
/** FIRINGI's buying group controls (Phase 49, English). */
import { useEffect, useState } from "react";
import { Ban, Check, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";
import { Msg, Spin, useRun } from "@/components/shared/run";
import { findBusinessAction, reviewGroupAction, saveGroupSettingsAction, setGroupSwitchAction } from "@/server/actions/buying-groups";
import { GROUP_FEATURES, type GroupSettings } from "@/lib/buying-groups";

const FEATURE: Record<string, [string, string]> = {
  pooledRebates: ["Pooled rebate targets", "Suppliers can run rebate deals for a group; everyone's purchases count together and the bonus is shared by what each member bought."],
  groupPrices: ["Group prices from suppliers", "Suppliers can give a group its own prices (members see them in the shop and the cart)."],
  reports: ["Group reports", "Members see the group's purchases and the bonuses earned together; group admins see each member."],
  groupOrders: ["Group orders", "Group admins open a shared order with one supplier; each member's own order is placed when it closes, for the same delivery day."],
};

export function ReviewGroup({ id }: { id: string }) {
  const { pending, error, run } = useRun();
  const [note, setNote] = useState("");
  return (
    <span className="flex flex-wrap items-center gap-1.5" data-testid="bg-review">
      <Button size="sm" disabled={pending} onClick={() => run(() => reviewGroupAction({ id, approve: true, note: note || null }))} data-testid="bg-approve"><Check className="size-4" /> Approve</Button>
      <Input aria-label="Reason" placeholder="Reason (to turn down — the business sees it)" value={note} onChange={(e) => setNote(e.target.value)} className="h-8 w-64 max-w-full" data-testid="bg-review-note" />
      <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => reviewGroupAction({ id, approve: false, note }))} data-testid="bg-reject"><Ban className="size-4" /> Turn down</Button>
      <Msg error={error} />
    </span>
  );
}

export function GroupSwitch({ companyId, state: initial }: { companyId: string; state: "DEFAULT" | "ON" | "OFF" }) {
  const { pending, error, run } = useRun();
  const [state, setState] = useState(initial);
  return (
    <span className="inline-flex items-center gap-1">
      <Select aria-label="Buying groups for this business" value={state} disabled={pending} className="h-8 w-40" data-testid="bg-switch"
        onChange={(e) => { const v = e.target.value as typeof state; const prev = state; setState(v); run(async () => { const r = await setGroupSwitchAction({ companyId, state: v }); if (!r.ok) setState(prev); return r; }); }}>
        <option value="DEFAULT">Default (by type)</option><option value="ON">Always on</option><option value="OFF">Off</option>
      </Select>
      <Msg error={error} />
    </span>
  );
}

/** Find a customer or wholesaler and switch buying groups on or off for it alone. */
export function AddBusinessSwitch() {
  const [q, setQ] = useState(""), [hits, setHits] = useState<{ id: string; name: string; type: string }[]>([]);
  useEffect(() => {
    if (q.trim().length < 2) { setHits([]); return; }
    const t = setTimeout(async () => { const r = await findBusinessAction({ q }); if (r.ok) setHits(r.data as typeof hits); }, 250);
    return () => clearTimeout(t);
  }, [q]);
  return (
    <div className="space-y-2">
      <Input placeholder="Find a business by name or NIF…" value={q} onChange={(e) => setQ(e.target.value)} data-testid="bg-find" />
      {hits.length > 0 && (
        <ul className="divide-y rounded-lg border" data-testid="bg-find-hits">
          {hits.map((h) => (
            <li key={h.id} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
              <span className="min-w-0 flex-1 break-words">{h.name} <span className="text-xs text-muted-foreground">· {h.type === "WHOLESALER" ? "Wholesaler" : "Customer"}</span></span>
              <GroupSwitch companyId={h.id} state="DEFAULT" />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Box({ label, checked, onChange, hint, testid }: { label: string; checked: boolean; onChange: (v: boolean) => void; hint?: string; testid?: string }) {
  return <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-0.5" checked={checked} onChange={(e) => onChange(e.target.checked)} data-testid={testid} /><span>{label}{hint && <span className="block text-xs text-muted-foreground">{hint}</span>}</span></label>;
}

export function GroupSettingsForm({ initial }: { initial: GroupSettings }) {
  const { pending, error, done, run } = useRun();
  const [s, setS] = useState(initial);
  const set = <K extends keyof GroupSettings>(k: K, v: GroupSettings[K]) => setS((x) => ({ ...x, [k]: v }));
  return (
    <form className="space-y-6" onSubmit={(e) => { e.preventDefault(); run(() => saveGroupSettingsAction(s), undefined, "Saved."); }} data-testid="bs-form">
      <Box label="Buying groups are on" hint="Off: businesses don't see groups; group prices and group deals stop applying. Nothing is deleted." checked={s.enabled} onChange={(v) => set("enabled", v)} testid="bs-enabled" />
      <div className="grid gap-6 md:grid-cols-2">
        <fieldset className="space-y-2">
          <legend className="mb-1 text-sm font-medium">Who takes part</legend>
          <Box label="Customers (restaurants, shops…) can join groups" checked={s.members.CUSTOMER} onChange={(v) => set("members", { ...s.members, CUSTOMER: v })} testid="bs-member-CUSTOMER" />
          <Box label="Wholesalers (buying from distributors) can join groups" checked={s.members.WHOLESALER} onChange={(v) => set("members", { ...s.members, WHOLESALER: v })} testid="bs-member-WHOLESALER" />
          <Box label="Customers can start groups" checked={s.creators.CUSTOMER} onChange={(v) => set("creators", { ...s.creators, CUSTOMER: v })} testid="bs-creator-CUSTOMER" />
          <Box label="Wholesalers can start groups" checked={s.creators.WHOLESALER} onChange={(v) => set("creators", { ...s.creators, WHOLESALER: v })} testid="bs-creator-WHOLESALER" />
        </fieldset>
        <fieldset className="space-y-2">
          <legend className="mb-1 text-sm font-medium">What groups can do</legend>
          {GROUP_FEATURES.map((k) => <Box key={k} label={FEATURE[k][0]} hint={FEATURE[k][1]} checked={s.features[k]} onChange={(v) => set("features", { ...s.features, [k]: v })} testid={`bs-feature-${k}`} />)}
        </fieldset>
        <fieldset className="space-y-2">
          <legend className="mb-1 text-sm font-medium">Membership</legend>
          <Box label="Businesses can find open groups and ask to join" hint="Invitations by NIF / VAT number always work." checked={s.joinRequests} onChange={(v) => set("joinRequests", v)} testid="bs-joinRequests" />
          <Box label="A business can be in several groups" checked={s.multipleGroups} onChange={(v) => set("multipleGroups", v)} testid="bs-multipleGroups" />
        </fieldset>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <div><Label htmlFor="bs-approval">New groups</Label>
          <Select id="bs-approval" value={s.approval} onChange={(e) => set("approval", e.target.value as "ALWAYS" | "AUTO")} data-testid="bs-approval"><option value="ALWAYS">FIRINGI approves every new group</option><option value="AUTO">Groups start at once</option></Select>
        </div>
        <div><Label htmlFor="bs-max">Members per group</Label><Input id="bs-max" type="number" value={s.maxMembers} onChange={(e) => set("maxMembers", Number(e.target.value))} data-testid="bs-maxMembers" /><p className="mt-1 text-xs text-muted-foreground">2–1000</p></div>
        <div><Label htmlFor="bs-days">Days a group order stays open</Label><Input id="bs-days" type="number" value={s.roundMaxDays} onChange={(e) => set("roundMaxDays", Number(e.target.value))} data-testid="bs-roundMaxDays" /><p className="mt-1 text-xs text-muted-foreground">1–60</p></div>
      </div>
      <Button type="submit" disabled={pending} data-testid="bs-save"><Spin on={pending} icon={Save} /> Save settings</Button>
      <Msg error={error} done={done} />
    </form>
  );
}
