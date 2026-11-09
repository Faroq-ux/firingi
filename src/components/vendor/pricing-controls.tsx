"use client";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";
import { deleteGroupAction, removePriceAction, saveGroupAction, savePriceListAction, setGroupMemberAction, setPriceAction } from "@/server/actions/catalogue";

function useRun() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const run = (fn: () => Promise<{ ok: boolean; error?: string; data?: unknown }>, after?: (data: unknown) => void) =>
    start(async () => { setError(null); const r = await fn(); if (r.ok) { after?.(r.data); router.refresh(); } else setError(r.error ?? "Error"); });
  return { pending, error, run };
}
type Opt = { id: string; label: string };

export function NewPriceListForm({ groups, customers }: { groups: Opt[]; customers: Opt[] }) {
  const t = useTranslations("catalogue.vendor");
  const router = useRouter();
  const { pending, error, run } = useRun();
  const [scope, setScope] = useState<"CUSTOMER_GROUP" | "CUSTOMER" | "CONTRACT">("CUSTOMER_GROUP");
  const [open, setOpen] = useState(false);
  if (!open) return <Button onClick={() => setOpen(true)}>{t("newPriceList")}</Button>;
  return (
    <form
      className="grid gap-3 rounded-xl border bg-card p-4 sm:grid-cols-2 lg:grid-cols-4"
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        run(() => savePriceListAction({
          name: String(fd.get("name")), scope, targetGroupId: scope === "CUSTOMER_GROUP" ? String(fd.get("target")) : null,
          targetCompanyId: scope !== "CUSTOMER_GROUP" ? String(fd.get("target")) : null, priority: Number(fd.get("priority") || 0),
          validFrom: String(fd.get("validFrom") || "") || null, validTo: String(fd.get("validTo") || "") || null,
        }), (d) => router.push(`/vendor/products/price-lists/${(d as { id: string }).id}`));
      }}
    >
      <div className="space-y-1"><Label htmlFor="pl-name">{t("name")}</Label><Input id="pl-name" name="name" required /></div>
      <div className="space-y-1"><Label htmlFor="pl-scope">{t("scope")}</Label>
        <Select id="pl-scope" value={scope} onChange={(e) => setScope(e.target.value as typeof scope)}>
          {(["CUSTOMER_GROUP", "CUSTOMER", "CONTRACT"] as const).map((s) => <option key={s} value={s}>{t(`scopes.${s}`)}</option>)}
        </Select></div>
      <div className="space-y-1"><Label htmlFor="pl-target">{t("target")}</Label>
        <Select id="pl-target" name="target" required defaultValue="">
          <option value="" disabled>{t("chooseCustomer")}</option>
          {(scope === "CUSTOMER_GROUP" ? groups : customers).map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
        </Select></div>
      <div className="space-y-1"><Label htmlFor="pl-prio">{t("priority")}</Label><Input id="pl-prio" name="priority" type="number" min={0} max={100} defaultValue={0} /></div>
      <div className="space-y-1"><Label htmlFor="pl-from">{t("validFrom")}</Label><Input id="pl-from" name="validFrom" type="date" /></div>
      <div className="space-y-1"><Label htmlFor="pl-to">{t("validTo")}</Label><Input id="pl-to" name="validTo" type="date" /></div>
      <div className="flex items-end gap-2 sm:col-span-2">
        <Button type="submit" disabled={pending}>{t("save")}</Button>
        <Button type="button" variant="outline" onClick={() => setOpen(false)}>{t("cancel")}</Button>
      </div>
      {error && <p className="text-sm text-destructive sm:col-span-4">{error}</p>}
    </form>
  );
}

export function AddPriceForm({ priceListId, offers }: { priceListId: string; offers: Opt[] }) {
  const t = useTranslations("catalogue.vendor");
  const { pending, error, run } = useRun();
  return (
    <form
      className="flex flex-wrap items-end gap-2 rounded-lg border border-dashed p-3"
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        const form = e.currentTarget;
        run(() => setPriceAction({ priceListId, offerId: String(fd.get("offerId")), minQty: Number(fd.get("minQty")), price: Number(fd.get("price")) }), () => form.reset());
      }}
    >
      <div className="min-w-64 flex-1 space-y-1"><Label htmlFor="ap-offer">{t("product")}</Label>
        <Select id="ap-offer" name="offerId" required>{offers.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}</Select></div>
      <div className="space-y-1"><Label htmlFor="ap-min">{t("minQty")}</Label><Input id="ap-min" name="minQty" type="number" min={1} defaultValue={1} className="w-24" /></div>
      <div className="space-y-1"><Label htmlFor="ap-price">{t("price")}</Label><Input id="ap-price" name="price" type="number" min="0.01" step="0.01" required className="w-28" /></div>
      <Button type="submit" disabled={pending}>{t("addPrice")}</Button>
      {error && <p className="w-full text-sm text-destructive">{error}</p>}
    </form>
  );
}

export function RemovePriceButton({ itemId }: { itemId: string }) {
  const t = useTranslations("catalogue.vendor");
  const { pending, run } = useRun();
  return <Button size="sm" variant="ghost" className="text-destructive" disabled={pending} onClick={() => run(() => removePriceAction({ itemId }))}>{t("remove")}</Button>;
}

export function NewGroupForm() {
  const t = useTranslations("catalogue.vendor");
  const { pending, error, run } = useRun();
  return (
    <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); const fd = new FormData(e.currentTarget); const f = e.currentTarget; run(() => saveGroupAction({ name: String(fd.get("name")), description: String(fd.get("description") || "") || null }), () => f.reset()); }}>
      <div className="space-y-1"><Label htmlFor="g-name">{t("name")}</Label><Input id="g-name" name="name" required className="w-56" /></div>
      <div className="flex-1 space-y-1"><Label htmlFor="g-desc">Description</Label><Input id="g-desc" name="description" /></div>
      <Button type="submit" disabled={pending}>{t("newGroup")}</Button>
      {error && <p className="w-full text-sm text-destructive">{error}</p>}
    </form>
  );
}

export function GroupMembers({ groupId, members, candidates }: { groupId: string; members: Opt[]; candidates: Opt[] }) {
  const t = useTranslations("catalogue.vendor");
  const { pending, error, run } = useRun();
  const [pick, setPick] = useState("");
  const available = candidates.filter((c) => !members.some((m) => m.id === c.id));
  return (
    <div className="space-y-2">
      {members.length === 0 && <p className="text-sm text-muted-foreground">{t("noMembers")}</p>}
      <ul className="flex flex-wrap gap-2">
        {members.map((m) => (
          <li key={m.id} className="flex items-center gap-1 rounded-full border px-2 py-0.5 text-sm">
            {m.label}
            <button type="button" aria-label={t("remove")} className="text-muted-foreground hover:text-destructive" disabled={pending} onClick={() => run(() => setGroupMemberAction({ groupId, companyId: m.id, member: false }))}>×</button>
          </li>
        ))}
      </ul>
      <div className="flex gap-2">
        <Select className="h-8 w-64" value={pick} onChange={(e) => setPick(e.target.value)}>
          <option value="">{t("chooseCustomer")}</option>
          {available.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
        </Select>
        <Button size="sm" disabled={!pick || pending} onClick={() => run(() => setGroupMemberAction({ groupId, companyId: pick, member: true }), () => setPick(""))}>{t("addMember")}</Button>
        <Button size="sm" variant="ghost" className="ml-auto text-destructive" disabled={pending} onClick={() => confirm("?") && run(() => deleteGroupAction({ groupId }))}>{t("delete")}</Button>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
