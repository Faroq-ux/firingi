/** Rebates & bonuses (Phase 48) — server parts shared by the supplier and FIRINGI pages. */
import type { TradeBonus } from "@prisma/client";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDate, formatMoney } from "@/lib/utils";
import type { RebateRules, RebateSettings } from "@/lib/rebates";
import { fill, rulesText } from "./labels";
import type { Allowed, Initial } from "./client";

type L = Record<string, string>;
export const TONE = { DRAFT: "outline", PENDING: "warning", APPROVED: "success", REJECTED: "destructive", ENDED: "outline", CANCELLED: "outline" } as const;

export function allowedFrom(s: RebateSettings, admin: boolean): Allowed {
  const on = <K extends string>(o: Record<K, boolean>) => (Object.keys(o) as K[]).filter((k) => o[k]);
  return {
    kinds: on(s.kinds), periods: on(s.periods), audiences: on({ ALL: s.audiences.ALL, SEGMENT: s.audiences.SEGMENT, GROUP: s.audiences.GROUP, COMPANIES: s.audiences.COMPANIES }),
    country: s.audiences.COUNTRY, perShop: s.audiences.PER_SHOP, maxPct: s.maxPct, freeGoodsDays: s.freeGoodsDays, auto: admin || s.approval === "AUTO",
  };
}

/** Where a running deal stands: "Running", "Starts soon", "Ends 30/06" … */
export function statusLabel(l: L, b: Pick<TradeBonus, "status" | "validFrom" | "validTo">, locale: string): { text: string; tone: "outline" | "warning" | "success" | "destructive" | "secondary" } {
  const now = new Date();
  if (b.status === "APPROVED" && b.validFrom > now) return { text: l["status.SCHEDULED"], tone: "secondary" };
  if (b.status === "APPROVED" && b.validTo) return { text: fill(l["status.ENDING"], { date: formatDate(new Date(b.validTo.getTime() - 86_400_000), locale) }), tone: "success" };
  return { text: l[`status.${b.status}`], tone: TONE[b.status as keyof typeof TONE] };
}

export function toInitial(b: TradeBonus, companies: { id: string; name: string }[]): Initial {
  return {
    id: b.id, sellerCompanyId: b.sellerCompanyId, name: b.name, description: b.description, kind: b.kind, period: b.period, rules: b.rules as Record<string, unknown>,
    validFrom: b.validFrom.toISOString().slice(0, 10), validTo: b.validTo ? new Date(b.validTo.getTime() - 86_400_000).toISOString().slice(0, 10) : null,
    audience: b.audience, segmentId: b.segmentId, groupId: b.groupId, companies, countries: b.countries, perShop: b.perShop,
    offerIds: b.offerIds, categoryIds: b.categoryIds, brandIds: b.brandIds, rewardOfferId: b.rewardOfferId, freeGoodsDays: b.freeGoodsDays,
  };
}

type Detail = Awaited<ReturnType<typeof import("@/server/rebates/service").bonusDetail>>;

export function BonusSummary({ l, locale, d, admin }: { l: L; locale: string; d: Detail; admin?: boolean }) {
  const b = d.bonus;
  const st = statusLabel(l, b, locale);
  const scope = b.offerIds.length || b.categoryIds.length || b.brandIds.length ? `${l.scopeSome}: ${[...b.offerIds.map((id) => d.offers.get(id) ?? id)].slice(0, 6).join(", ")}${b.categoryIds.length ? ` · ${l["f.categories"]}: ${b.categoryIds.length}` : ""}${b.brandIds.length ? ` · ${l["f.brands"]}: ${b.brandIds.length}` : ""}` : l.scopeAll;
  return (
    <Card className="mb-4">
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle className="break-words">{b.name}</CardTitle>
          <Badge variant="secondary">{l[`kind.${b.kind}`]}</Badge>
          <Badge variant={st.tone} data-testid="rb-status" data-status={b.status}>{st.text}</Badge>
          {admin && <Badge variant="outline">{l[`funded.${b.fundedBy}`]}</Badge>}
        </div>
        {b.description && <CardDescription className="break-words">{b.description}</CardDescription>}
      </CardHeader>
      <CardContent className="grid gap-2 text-sm sm:grid-cols-2">
        <p><span className="text-muted-foreground">{l.rulesCol}:</span> <span data-testid="rb-rules">{rulesText(l, b.rules as RebateRules, locale)}</span></p>
        <p><span className="text-muted-foreground">{l.periodCol}:</span> {l[`period.${b.period}`]}{b.perShop ? ` · ${l.perShopTag}` : ""}</p>
        <p><span className="text-muted-foreground">{l.dates}:</span> {formatDate(b.validFrom, locale)} → {b.validTo ? formatDate(new Date(b.validTo.getTime() - 86_400_000), locale) : "∞"}</p>
        <p><span className="text-muted-foreground">{l["f.audience"]}:</span> {l[`audience.${b.audience}`]}{b.audience === "COMPANIES" ? ` (${b.companyIds.length})` : ""}{b.countries.length ? ` · ${b.countries.join(", ")}` : ""}</p>
        <p className="break-words sm:col-span-2"><span className="text-muted-foreground">{l["f.products"]}:</span> {scope}</p>
        {b.kind === "FREE_GOODS" && b.rewardOfferId && <p className="break-words sm:col-span-2"><span className="text-muted-foreground">{l["f.rewardOffer"]}:</span> {d.offers.get(b.rewardOfferId)} · {b.freeGoodsDays} d</p>}
        {b.reviewNote && <p className="break-words sm:col-span-2">{fill(l.firingiNote, { note: b.reviewNote })}</p>}
      </CardContent>
    </Card>
  );
}

export function BonusResults({ l, locale, d, admin }: { l: L; locale: string; d: Detail; admin?: boolean }) {
  const money = (n: number | string) => formatMoney(n, locale);
  const free = d.bonus.kind === "FREE_GOODS";
  const nextText = (n: Detail["current"][number]["result"]["next"]) => {
    if (!n) return l.topReached;
    if (n.unit === "PRODUCTS") return fill(l["missing.PRODUCTS"], { missing: n.missing });
    if (n.unit === "UNITS") return n.freeUnits ? fill(l["missing.UNITS_FREE"], { missing: n.missing, free: n.freeUnits }) : fill(l["missing.UNITS"], { missing: n.missing, pct: n.pct ?? 0 });
    return fill(l["missing.AMOUNT"], { missing: money(n.missing), pct: n.pct ?? 0 });
  };
  return (
    <>
      {d.live && (
        <Card className="mb-4">
          <CardHeader><CardTitle>{fill(l.livePeriod, { period: d.period.key })}</CardTitle></CardHeader>
          <CardContent>
            {!d.current.length ? <p className="py-4 text-center text-sm text-muted-foreground">{l.noBuyers}</p> : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[560px] text-sm" data-testid="rb-live">
                  <thead className="text-left text-xs text-muted-foreground [&>tr>th]:pb-2 [&>tr>th]:pr-3"><tr><th>{l.customer}</th><th className="text-right">{l.bought}</th><th className="text-right">{l.units}</th><th className="text-right">{l.earning}</th><th>{l.nextStep}</th></tr></thead>
                  <tbody className="divide-y">
                    {d.current.map((r) => (
                      <tr key={`${r.companyId}|${r.branchId}`} className="[&>td]:py-2 [&>td]:pr-3">
                        <td className="break-words">{r.company}{r.branch ? <span className="text-xs text-muted-foreground"> · {r.branch}</span> : null}</td>
                        <td className="text-right tabular-nums">{money(r.stats.amount)}</td>
                        <td className="text-right tabular-nums">{r.stats.units}</td>
                        <td className="text-right tabular-nums">{free ? `${r.result.freeUnits} ×` : money(r.result.value)}</td>
                        <td className="text-xs">{nextText(r.result.next)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      )}
      <Card>
        <CardHeader><CardTitle>{l.settled}</CardTitle></CardHeader>
        <CardContent>
          {!d.settlements.length ? <p className="py-4 text-center text-sm text-muted-foreground">{l.noSettled}</p> : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-sm" data-testid="rb-settled">
                <thead className="text-left text-xs text-muted-foreground [&>tr>th]:pb-2 [&>tr>th]:pr-3"><tr><th>{l.periodCol}</th><th>{l.customer}</th><th className="text-right">{l.bought}</th><th className="text-right">{free ? l.freeGiven : l.paid}</th><th>{l.statusCol}</th></tr></thead>
                <tbody className="divide-y">
                  {d.settlements.map((x) => (
                    <tr key={x.id} className="[&>td]:py-2 [&>td]:pr-3">
                      <td className="whitespace-nowrap font-mono text-xs">{x.periodKey}</td>
                      <td className="break-words">{x.company}{x.branch ? <span className="text-xs text-muted-foreground"> · {x.branch}</span> : null}</td>
                      <td className="text-right tabular-nums">{money(Number(x.amount))}</td>
                      <td className="text-right tabular-nums">{free ? x.freeUnits : money(Number(x.value))}</td>
                      <td><Badge variant={x.status === "SETTLED" ? "success" : x.status === "FAILED" ? "destructive" : "outline"}>{l[`rowStatus.${x.status}`] ?? x.status}</Badge>{admin && x.error ? <span className="block text-xs text-muted-foreground">{x.error}</span> : null}</td>
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
