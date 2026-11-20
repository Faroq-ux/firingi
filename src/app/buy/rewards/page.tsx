import Link from "next/link";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { Gift, Hourglass, Sparkles, Trophy, Users } from "lucide-react";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { myRewards } from "@/server/loyalty/service";
import { buyerRewardsAccess } from "@/server/rewards/service";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CreditForm, InviteLink } from "@/components/loyalty/controls";
import { formatDate, formatMoney } from "@/lib/utils";

export const metadata = { title: "Rewards" };
const TIER_STYLE: Record<string, string> = {
  BRONZE: "from-[#b87333] to-[#e0a96d]",
  SILVER: "from-[#8e9aaf] to-[#d9dee8]",
  GOLD: "from-[#d4a017] to-[#ffe08a]",
};

export default async function RewardsPage() {
  const ctx = await pagePortal("buy");
  pagePermission(ctx, ["buyer.orders.view", "buyer.orders.place", "buyer.invoices.view"]);
  const [r, t, locale, tr, shop] = await Promise.all([myRewards(ctx), getTranslations("loyalty"), getLocale(), getTranslations("rewardsShop"), buyerRewardsAccess(ctx.company)]);
  if (!r.on) notFound();
  const s = r.settings;
  const money = (v: string | number) => formatMoney(v, locale);
  const pick = (m: unknown) => { const o = (m ?? {}) as Record<string, string>; return o[locale] ?? o[locale.split("-")[0]] ?? o.en ?? ""; };
  const perUnit = Math.round(1 / s.pointValue);
  return (
    <>
      <PageHeader title={t("title")} description={t("description")} actions={shop.on ? <Link href="/buy/rewards/shop" className="inline-flex items-center gap-1.5 rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow hover:opacity-90" data-testid="to-shop"><Gift className="size-4" aria-hidden /> {tr("shopLink")}</Link> : undefined} />
      <div className="grid gap-4 lg:grid-cols-3">
        {/* balance */}
        <Card className="relative overflow-hidden lg:col-span-2" data-testid="rewards-balance">
          <div aria-hidden className="pointer-events-none absolute -right-16 -top-16 size-56 rounded-full bg-[radial-gradient(circle,color-mix(in_oklch,var(--vivid-violet)_35%,transparent),transparent_70%)]" />
          <CardContent className="relative flex flex-wrap items-end gap-x-8 gap-y-3 pt-6">
            <div>
              <p className="text-sm text-muted-foreground">{t("balance")}</p>
              <p className="text-gradient text-5xl font-bold tabular-nums" data-testid="points-balance">{r.balance.toLocaleString(locale)}</p>
              <p className="text-sm text-muted-foreground">{t("worth", { value: money(r.value) })}</p>
            </div>
            <div className="text-sm text-muted-foreground">{t("lifetime", { points: r.lifetimeEarned.toLocaleString(locale) })}</div>
            {r.expiring && (
              <p className="flex w-full items-center gap-2 rounded-lg bg-warning/15 p-2 text-sm" role="status" data-testid="points-expiring">
                <Hourglass className="size-4 shrink-0" aria-hidden /> {t("expiring", { points: r.expiring.points.toLocaleString(locale), date: formatDate(r.expiring.at, locale) })}
              </p>
            )}
          </CardContent>
        </Card>
        {/* tier */}
        <Card data-testid="rewards-tier">
          <CardContent className="space-y-3 pt-6">
            <div className="flex items-center gap-3">
              <span className={`grid size-12 place-items-center rounded-2xl bg-gradient-to-br ${TIER_STYLE[r.tier]} text-white shadow-md`}><Trophy className="size-6" aria-hidden /></span>
              <div><p className="text-xs text-muted-foreground">{t("tierLabel")}</p><p className="text-xl font-semibold" data-testid="tier-name">{t(`tiers.${r.tier}`)}</p></div>
            </div>
            <p className="text-sm text-muted-foreground">{t("spend", { amount: money(r.spend12m) })}</p>
            {r.next ? (
              <div className="space-y-1">
                <div className="h-2 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(r.next.progress * 100)} aria-label={t("tierNext", { missing: money(r.next.missing), tier: t(`tiers.${r.next.tier}`) })}>
                  <div className="h-full rounded-full bg-[linear-gradient(90deg,var(--vivid-blue),var(--vivid-violet))]" style={{ width: `${Math.round(r.next.progress * 100)}%` }} />
                </div>
                <p className="text-xs">{t("tierNext", { missing: money(r.next.missing), tier: t(`tiers.${r.next.tier}`) })}</p>
              </div>
            ) : <p className="text-sm">{t("tierTop")}</p>}
            <ul className="space-y-1 text-sm" data-testid="tier-perks">
              <li>✓ {t("perkPoints", { mult: r.perks.multiplier.toLocaleString(locale) })}</li>
              {r.perks.freeDelivery && <li>✓ {t("perkFreeDelivery")}</li>}
              {r.perks.prioritySupport && <li>✓ {t("perkPriority")}</li>}
            </ul>
          </CardContent>
        </Card>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><Gift className="size-5 text-[color:var(--vivid-violet)]" aria-hidden /> {t("useTitle")}</CardTitle></CardHeader>
          <CardContent className="space-y-3 text-sm">
            <p>{t("useCart", { per: perUnit, pct: s.maxRedeemPct, min: s.minRedeem })} <Link href="/buy/orders/cart" className="text-primary underline-offset-4 hover:underline">{t("openCart")}</Link></p>
            <div className="border-t pt-3">
              <p className="mb-2 font-medium">{t("creditTitle")}</p>
              <p className="mb-2 text-muted-foreground">{t("creditText")}</p>
              <CreditForm balance={r.balance} min={s.creditNoteMin} pointValue={s.pointValue} locale={locale} />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><Users className="size-5 text-[color:var(--vivid-teal)]" aria-hidden /> {t("referralTitle")}</CardTitle></CardHeader>
          <CardContent className="space-y-3 text-sm">
            <p>{t("referralText", { inviter: s.referral.inviter.toLocaleString(locale), invited: s.referral.invited.toLocaleString(locale) })}</p>
            <InviteLink code={r.referralCode} />
            {!!r.invited.length && (
              <div data-testid="referral-list">
                <p className="mb-1 font-medium">{t("referralInvited")}</p>
                <ul className="space-y-1">{r.invited.map((i, n) => <li key={n} className="flex justify-between gap-2"><span className="truncate">{i.name}</span><span className={i.rewarded ? "text-[color:color-mix(in_oklch,var(--vivid-teal)_80%,var(--foreground))]" : "text-muted-foreground"}>{i.rewarded ? t("referralRewarded") : t("referralPending")}</span></li>)}</ul>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {!!r.campaigns.length && (
        <Card className="mt-4" data-testid="rewards-campaigns">
          <CardHeader><CardTitle className="flex items-center gap-2"><Sparkles className="size-5 text-[color:var(--vivid-pink)]" aria-hidden /> {t("campaignsTitle")}</CardTitle></CardHeader>
          <CardContent className="grid gap-2 sm:grid-cols-2">
            {r.campaigns.map((c) => (
              <div key={c.id} className="rounded-xl border bg-[color-mix(in_oklch,var(--vivid-pink)_6%,transparent)] p-3">
                <p className="font-semibold">{t("campaignMult", { mult: Number(c.multiplier).toLocaleString(locale), date: formatDate(c.endsAt, locale) })}</p>
                {pick(c.message) && <p className="text-sm text-muted-foreground">{pick(c.message)}</p>}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Card className="mt-4">
        <CardHeader><CardTitle>{t("howTitle")}</CardTitle></CardHeader>
        <CardContent className="grid gap-3 text-sm sm:grid-cols-3">
          <p>① {t("howEarn", { points: s.pointsPerEuro })}</p>
          <p>② {t("howSpend", { per: perUnit })}</p>
          <p>③ {t("howExpiry", { months: s.expiryMonths })}</p>
        </CardContent>
      </Card>

      <Card className="mt-4">
        <CardHeader><CardTitle>{t("historyTitle")}</CardTitle></CardHeader>
        <CardContent>
          {!r.entries.length ? <p className="text-sm text-muted-foreground">{t("historyEmpty")}</p> : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm" data-testid="points-history">
                <thead><tr className="border-b text-left text-xs text-muted-foreground"><th className="py-2 pr-3 font-medium">{t("colDate")}</th><th className="py-2 pr-3 font-medium">{t("colWhat")}</th><th className="py-2 pr-3 text-right font-medium">{t("colPoints")}</th></tr></thead>
                <tbody>
                  {r.entries.map((e) => (
                    <tr key={e.id} className="border-b last:border-0">
                      <td className="whitespace-nowrap py-2 pr-3 text-muted-foreground">{formatDate(e.at, locale)}</td>
                      <td className="py-2 pr-3">
                        {t(`kinds.${e.kind}`)}
                        {e.order && <> · {e.orderId ? <Link href={`/buy/orders/${e.orderId}`} className="text-primary hover:underline">{e.order}</Link> : e.order}</>}
                        {e.invoice && <> · {e.invoice}</>}
                        {e.expiresAt && e.remaining > 0 && <span className="block text-xs text-muted-foreground">{t("expires", { date: formatDate(e.expiresAt, locale) })}</span>}
                      </td>
                      <td className={`py-2 pr-3 text-right font-semibold tabular-nums ${e.points >= 0 ? "text-[color:color-mix(in_oklch,var(--vivid-teal)_80%,var(--foreground))]" : "text-muted-foreground"}`}>{e.points > 0 ? "+" : ""}{e.points.toLocaleString(locale)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </>
  );
}
