"use client";
/** Supplier advertising controls (Phase 34): the new-ad form, pause / resume / end, price and budgets. */
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Megaphone, Pause, Play, Save, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Msg, Spin, useRun } from "@/components/shared/run";
import { createCampaignAction, updateCampaignAction } from "@/server/actions/ads";

type Placement = "SEARCH" | "CATEGORY" | "HOME" | "CART";
type Rule = { enabled: boolean; slots: number; minCpc: number; dailyPrice: number };
type Opt = { id: string; label: string };
const PLACEMENTS: Placement[] = ["SEARCH", "CATEGORY", "HOME", "CART"];

export function CampaignForm({ rules, offers, categories, approval, locale }: { rules: Record<Placement, Rule>; offers: Opt[]; categories: Opt[]; approval: boolean; locale: string }) {
  const t = useTranslations("ads");
  const router = useRouter();
  const { pending, error, run } = useRun();
  const money = (n: number) => new Intl.NumberFormat(locale, { style: "currency", currency: "EUR" }).format(n);
  const open = PLACEMENTS.filter((p) => rules[p].enabled);
  const today = new Date().toISOString().slice(0, 10);
  const week = new Date(Date.now() + 6 * 86400_000).toISOString().slice(0, 10);
  const [v, setV] = useState({ name: "", placement: open[0] ?? "SEARCH", pricing: "CPC" as "CPC" | "DAILY", offerIds: [] as string[], keywords: "", categoryId: "", cpcBid: String(rules[open[0] ?? "SEARCH"].minCpc), dailyBudget: "10", totalBudget: "", startsOn: today, endsOn: "" });
  const [filter, setFilter] = useState("");
  const rule = rules[v.placement];
  const days = v.endsOn && v.startsOn ? Math.round((Date.parse(v.endsOn) - Date.parse(v.startsOn)) / 86400_000) + 1 : 0;
  const shown = useMemo(() => offers.filter((o) => !filter || o.label.toLowerCase().includes(filter.toLowerCase())).slice(0, 60), [offers, filter]);
  const toggle = (id: string) => setV({ ...v, offerIds: v.offerIds.includes(id) ? v.offerIds.filter((x) => x !== id) : v.offerIds.length < 20 ? [...v.offerIds, id] : v.offerIds });
  if (!open.length) return <p className="text-sm text-muted-foreground">{t("noPlacements")}</p>;
  return (
    <form className="space-y-5" data-testid="ad-form" onSubmit={(e) => {
      e.preventDefault();
      run(() => createCampaignAction({
        name: v.name, placement: v.placement, pricing: v.pricing, offerIds: v.offerIds,
        keywords: v.placement === "SEARCH" ? v.keywords.split(",").map((k) => k.trim()).filter(Boolean) : [],
        categoryId: v.placement === "CATEGORY" && v.categoryId ? v.categoryId : null,
        cpcBid: v.pricing === "CPC" ? Number(v.cpcBid) : null, dailyBudget: v.pricing === "CPC" ? Number(v.dailyBudget) : null,
        totalBudget: v.pricing === "CPC" && v.totalBudget ? Number(v.totalBudget) : null, startsOn: v.startsOn, endsOn: v.endsOn || null,
      }), (d) => router.push(`/vendor/ads/${(d as { id: string }).id}`));
    }}>
      <div className="space-y-1"><Label htmlFor="ad-name">{t("name")}</Label><Input id="ad-name" required minLength={3} maxLength={120} value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} /></div>
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">{t("where")}</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {open.map((p) => (
            <label key={p} className={`flex cursor-pointer items-start gap-2 rounded-xl border p-3 text-sm ${v.placement === p ? "border-primary bg-primary/5" : ""}`}>
              <input type="radio" name="placement" className="mt-1" checked={v.placement === p} onChange={() => setV({ ...v, placement: p, cpcBid: String(Math.max(Number(v.cpcBid) || 0, rules[p].minCpc)) })} data-testid={`ad-placement-${p}`} />
              <span><span className="font-medium">{t(`placements.${p}`)}</span><span className="block text-xs text-muted-foreground">{t("whereHint", { min: money(rules[p].minCpc), day: money(rules[p].dailyPrice), slots: rules[p].slots })}</span></span>
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">{t("howPay")}</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {(["CPC", "DAILY"] as const).map((p) => (
            <label key={p} className={`flex cursor-pointer items-start gap-2 rounded-xl border p-3 text-sm ${v.pricing === p ? "border-primary bg-primary/5" : ""}`}>
              <input type="radio" name="pricing" className="mt-1" checked={v.pricing === p} onChange={() => setV({ ...v, pricing: p, endsOn: p === "DAILY" && !v.endsOn ? week : v.endsOn })} data-testid={`ad-pricing-${p}`} />
              <span><span className="font-medium">{t(p === "CPC" ? "cpc" : "daily")}</span><span className="block text-xs text-muted-foreground">{t(p === "CPC" ? "cpcHint" : "dailyHint")}</span></span>
            </label>
          ))}
        </div>
      </fieldset>
      <div className="space-y-1">
        <Label htmlFor="ad-filter">{t("products")} · {v.offerIds.length}</Label>
        <Input id="ad-filter" placeholder={t("searchProducts")} value={filter} onChange={(e) => setFilter(e.target.value)} />
        <div className="max-h-56 overflow-y-auto rounded-xl border p-2" data-testid="ad-products">
          {shown.map((o) => (
            <label key={o.id} className="flex items-center gap-2 py-1 text-sm"><input type="checkbox" checked={v.offerIds.includes(o.id)} onChange={() => toggle(o.id)} /> <span className="min-w-0 break-words">{o.label}</span></label>
          ))}
        </div>
      </div>
      {v.placement === "SEARCH" && (
        <div className="space-y-1"><Label htmlFor="ad-keywords">{t("keywords")}</Label><Input id="ad-keywords" value={v.keywords} onChange={(e) => setV({ ...v, keywords: e.target.value })} placeholder="mozzarella, queijo" /><p className="text-xs text-muted-foreground">{t("keywordsHint")}</p></div>
      )}
      {v.placement === "CATEGORY" && (
        <div className="space-y-1">
          <Label htmlFor="ad-category">{t("category")}</Label>
          <select id="ad-category" className="h-9 w-full rounded-md border bg-background px-2 text-sm" value={v.categoryId} onChange={(e) => setV({ ...v, categoryId: e.target.value })}>
            <option value="">{t("categoryAny")}</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {v.pricing === "CPC" && <>
          <div className="space-y-1"><Label htmlFor="ad-bid">{t("bid")}</Label><Input id="ad-bid" type="number" step="0.01" min={rule.minCpc} required value={v.cpcBid} onChange={(e) => setV({ ...v, cpcBid: e.target.value })} /></div>
          <div className="space-y-1"><Label htmlFor="ad-daily">{t("dailyBudget")}</Label><Input id="ad-daily" type="number" step="0.5" min={0} required value={v.dailyBudget} onChange={(e) => setV({ ...v, dailyBudget: e.target.value })} /></div>
          <div className="space-y-1"><Label htmlFor="ad-total">{t("totalBudget")}</Label><Input id="ad-total" type="number" step="1" min={0} value={v.totalBudget} onChange={(e) => setV({ ...v, totalBudget: e.target.value })} /></div>
        </>}
        <div className="space-y-1"><Label htmlFor="ad-start">{t("startsOn")}</Label><Input id="ad-start" type="date" min={today} required value={v.startsOn} onChange={(e) => setV({ ...v, startsOn: e.target.value })} /></div>
        <div className="space-y-1"><Label htmlFor="ad-end">{v.pricing === "DAILY" ? t("endsOn") : t("endsOnOptional")}</Label><Input id="ad-end" type="date" min={v.startsOn} required={v.pricing === "DAILY"} value={v.endsOn} onChange={(e) => setV({ ...v, endsOn: e.target.value })} /></div>
      </div>
      {v.pricing === "DAILY" && days > 0 && <p className="rounded-md bg-primary/10 p-2 text-sm font-medium text-primary" data-testid="ad-daily-cost">{t("dailyCost", { days, price: money(rule.dailyPrice), total: money(days * rule.dailyPrice) })}</p>}
      <p className="text-xs text-muted-foreground">{t("formNote")}</p>
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending || !v.offerIds.length} data-testid="ad-submit"><Spin on={pending} icon={Megaphone} /> {approval ? t("submit") : t("submitDirect")}</Button>
        <Msg error={error} />
      </div>
    </form>
  );
}

export function CampaignActions({ id, status, pausedReason }: { id: string; status: string; pausedReason: string | null }) {
  const t = useTranslations("ads");
  const { pending, error, run } = useRun();
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      {status === "ACTIVE" && <Button variant="outline" disabled={pending} onClick={() => run(() => updateCampaignAction({ id, action: "PAUSE" }))} data-testid="ad-pause"><Pause className="size-4" /> {t("pause")}</Button>}
      {status === "PAUSED" && pausedReason !== "FIRINGI" && <Button variant="outline" disabled={pending} onClick={() => run(() => updateCampaignAction({ id, action: "RESUME" }))} data-testid="ad-resume"><Play className="size-4" /> {t("resume")}</Button>}
      {!["ENDED", "REJECTED"].includes(status) && <Button variant="outline" disabled={pending} onClick={() => run(() => updateCampaignAction({ id, action: "END" }))} data-testid="ad-end"><Square className="size-4" /> {t("end")}</Button>}
      <Msg error={error} />
    </span>
  );
}

export function BudgetForm({ id, cpcBid, dailyBudget, totalBudget, minCpc }: { id: string; cpcBid: string; dailyBudget: string; totalBudget: string | null; minCpc: number }) {
  const t = useTranslations("ads");
  const { pending, error, done, run } = useRun();
  const [v, setV] = useState({ cpcBid, dailyBudget, totalBudget: totalBudget ?? "" });
  return (
    <form className="flex flex-wrap items-end gap-2" data-testid="budget-form" onSubmit={(e) => { e.preventDefault(); run(() => updateCampaignAction({ id, cpcBid: Number(v.cpcBid), dailyBudget: Number(v.dailyBudget), totalBudget: v.totalBudget ? Number(v.totalBudget) : null }), undefined, t("saved")); }}>
      <div className="space-y-1"><Label htmlFor="b-bid">{t("bid")}</Label><Input id="b-bid" className="w-28" type="number" step="0.01" min={minCpc} value={v.cpcBid} onChange={(e) => setV({ ...v, cpcBid: e.target.value })} /></div>
      <div className="space-y-1"><Label htmlFor="b-daily">{t("dailyBudget")}</Label><Input id="b-daily" className="w-28" type="number" step="0.5" value={v.dailyBudget} onChange={(e) => setV({ ...v, dailyBudget: e.target.value })} /></div>
      <div className="space-y-1"><Label htmlFor="b-total">{t("totalBudget")}</Label><Input id="b-total" className="w-28" type="number" step="1" value={v.totalBudget} onChange={(e) => setV({ ...v, totalBudget: e.target.value })} /></div>
      <Button type="submit" variant="outline" disabled={pending} data-testid="budget-save"><Spin on={pending} icon={Save} /> {t("save")}</Button>
      <Msg error={error} done={done} />
    </form>
  );
}
