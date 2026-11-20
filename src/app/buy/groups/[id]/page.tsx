import Link from "next/link";
import { notFound } from "next/navigation";
import { Users } from "lucide-react";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { groupDetail, groupReport, roundSuppliers } from "@/server/buying-groups/service";
import { NotFoundError } from "@/server/errors";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { fill, groupLabels } from "@/components/buying-groups/labels";
import { CloseGroup, DecideRequest, EditGroup, InviteForm, LeaveGroup, MemberActions, OpenRound, RespondInvite } from "@/components/buying-groups/client";
import { formatDate, formatMoney } from "@/lib/utils";
import { cn } from "@/lib/utils";

export const metadata = { title: "Buying Group" };
export const dynamic = "force-dynamic";

const PERIODS = ["MONTH", "QUARTER", "YEAR"] as const;

export default async function BuyingGroupPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ period?: string }> }) {
  const ctx = await pagePortal("buy");
  pagePermission(ctx, ["buyer.orders.view", "buyer.orders.place", "company.profile.manage"]);
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const period = (PERIODS as readonly string[]).includes(sp.period ?? "") ? (sp.period as (typeof PERIODS)[number]) : "QUARTER";
  const [{ l, locale }, d] = await Promise.all([groupLabels(), groupDetail(ctx, id).catch((e) => { if (e instanceof NotFoundError) notFound(); throw e; })]);
  const g = d.group, s = d.settings, live = g.status === "APPROVED", active = d.me?.status === "ACTIVE";
  const manager = ctx.membership.isOwner || ctx.permissions.has("company.profile.manage");
  const boss = d.admin && manager;
  const money = (n: number) => formatMoney(n, locale);
  const [report, suppliers] = await Promise.all([
    active && s.features.reports ? groupReport(ctx, id, period) : null,
    boss && live && s.features.groupOrders ? roundSuppliers(ctx, id) : [],
  ]);
  const membersActive = d.members.filter((m) => m.status === "ACTIVE");
  const requests = d.members.filter((m) => m.status === "REQUESTED");
  const invited = d.members.filter((m) => m.status === "INVITED");
  const tone = (st: string) => (st === "APPROVED" ? "success" : st === "PENDING" ? "warning" : "secondary") as "success" | "warning" | "secondary";
  return (
    <>
      <PageHeader title={g.name} icon={Users} eyebrow={l.title} description={g.description ?? undefined}
        actions={<>{active && manager && <LeaveGroup l={l} groupId={g.id} />}{boss && g.status !== "CLOSED" && <CloseGroup label={l.closeGroup} confirm={l.closeConfirm} groupId={g.id} />}</>} />
      <div className="mb-4 flex flex-wrap items-center gap-2 text-sm">
        <Link href="/buy/groups" className="text-primary hover:underline">← {l.title}</Link>
        <Badge variant={tone(g.status)} data-testid="bg-status">{l[`status.${g.status}`]}</Badge>
        {d.me && <Badge variant="outline">{d.me.status === "ACTIVE" ? l[`role.${d.me.role}`] : l[`memberStatus.${d.me.status}`]}</Badge>}
        <span className="text-muted-foreground">{fill(l.membersN, { n: membersActive.length })}</span>
        {g.reviewNote && <span className="basis-full break-words text-xs text-muted-foreground">{fill(l.firingiNote, { note: g.reviewNote })}</span>}
      </div>
      {d.me?.status === "INVITED" && manager && <Card className="mb-6"><CardContent className="flex flex-wrap items-center gap-3 pt-6"><p className="flex-1 text-sm">{fill(l.invitedTo, { name: g.name })}</p><RespondInvite l={l} groupId={g.id} /></CardContent></Card>}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>{l.membersTitle}</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <ul className="divide-y" data-testid="bg-members">
              {membersActive.map((m) => (
                <li key={m.companyId} className="flex flex-wrap items-center gap-x-2 gap-y-1 py-2 text-sm" data-testid="bg-member">
                  <span className="min-w-[12rem] flex-1 break-words">{m.name}{m.me ? ` (${l.you})` : ""}{m.joinedAt && <span className="block text-xs text-muted-foreground">{fill(l.since, { date: formatDate(m.joinedAt, locale) })}</span>}</span>
                  {m.role === "ADMIN" && <Badge>{l["role.ADMIN"]}</Badge>}
                  {boss && !m.me && <MemberActions l={l} groupId={g.id} companyId={m.companyId} role={m.role} />}
                </li>
              ))}
            </ul>
            {boss && requests.length > 0 && (
              <div data-testid="bg-requests">
                <h3 className="mb-2 text-sm font-medium">{l.requests}</h3>
                <ul className="divide-y rounded-lg border">
                  {requests.map((m) => (
                    <li key={m.companyId} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm" data-testid="bg-request">
                      <span className="min-w-0 flex-1 break-words">{m.name}{m.message && <span className="block text-xs text-muted-foreground">“{m.message}”</span>}</span>
                      <DecideRequest l={l} groupId={g.id} companyId={m.companyId} />
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {boss && invited.length > 0 && <p className="text-xs text-muted-foreground" data-testid="bg-invited">{l["memberStatus.INVITED"]}: {invited.map((m) => m.name).join(", ")}</p>}
            {boss && live && <div><h3 className="mb-2 text-sm font-medium">{l.invite}</h3><InviteForm l={l} groupId={g.id} /></div>}
          </CardContent>
        </Card>

        {report && (
          <Card data-testid="bg-report">
            <CardHeader>
              <CardTitle>{l.reportTitle}</CardTitle>
              <div className="flex flex-wrap gap-1.5 pt-1">
                {PERIODS.map((p) => <Link key={p} href={`?period=${p}`} className={cn("rounded-full border px-3 py-1 text-xs", p === period ? "border-primary bg-primary/10 text-primary" : "hover:bg-muted")} data-testid={`bg-period-${p}`}>{l[`period.${p}`]}</Link>)}
              </div>
            </CardHeader>
            <CardContent className="space-y-4 text-sm">
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="rounded-lg border p-3"><p className="text-xs text-muted-foreground">{l.total}</p><p className="text-lg font-semibold tabular-nums" data-testid="bg-total">{money(report.total)}</p></div>
                <div className="rounded-lg border p-3"><p className="text-xs text-muted-foreground">{l.myShare}</p><p className="text-lg font-semibold tabular-nums">{money(report.me.net)}</p><p className="text-xs text-muted-foreground">{fill(l.share, { pct: report.me.share })}</p></div>
                <div className="rounded-lg border p-3"><p className="text-xs text-muted-foreground">{l.bonusEarned}</p><p className="text-lg font-semibold tabular-nums">{money(report.bonuses.value)}</p>{report.bonuses.free > 0 && <p className="text-xs text-muted-foreground">{fill(l.freeUnits, { n: report.bonuses.free })}</p>}</div>
              </div>
              {report.byMember.length > 0 && (
                <div className="overflow-x-auto">
                  <h3 className="mb-1 font-medium">{l.byMember}</h3>
                  <table className="w-full text-sm" data-testid="bg-by-member"><thead><tr className="text-left text-xs text-muted-foreground"><th className="py-1 pr-2 font-normal" /><th className="py-1 pr-2 text-right font-normal">{l.orders}</th><th className="py-1 text-right font-normal">{l.net}</th></tr></thead>
                    <tbody>{report.byMember.map((m) => <tr key={m.companyId} className="border-t"><td className="break-words py-1.5 pr-2">{m.name}</td><td className="py-1.5 pr-2 text-right tabular-nums">{m.orders}</td><td className="py-1.5 text-right tabular-nums">{money(m.net)} <span className="text-xs text-muted-foreground">({m.share} %)</span></td></tr>)}</tbody></table>
                </div>
              )}
              {report.bySupplier.length > 0 ? (
                <div>
                  <h3 className="mb-1 font-medium">{l.bySupplier}</h3>
                  <ul className="divide-y">{report.bySupplier.map((x) => <li key={x.name} className="flex justify-between gap-2 py-1.5"><span className="min-w-0 break-words">{x.name}</span><span className="tabular-nums">{money(x.net)}</span></li>)}</ul>
                </div>
              ) : <p className="text-muted-foreground">{l.noPurchases}</p>}
            </CardContent>
          </Card>
        )}

        {s.features.groupPrices && (
          <Card>
            <CardHeader><CardTitle>{l.pricesTitle}</CardTitle><CardDescription>{l.pricesIntro}</CardDescription></CardHeader>
            <CardContent>
              {!d.prices.length ? <p className="text-sm text-muted-foreground">{l.noPrices}</p> : (
                <ul className="divide-y text-sm" data-testid="bg-prices">{d.prices.map((p) => <li key={p.id} className="py-2">{fill(l.priceRow, { supplier: p.supplier, n: p.items })}{p.validTo && <span className="text-xs text-muted-foreground"> · {fill(l.until, { date: formatDate(p.validTo, locale) })}</span>}</li>)}</ul>
              )}
            </CardContent>
          </Card>
        )}

        {s.features.pooledRebates && (
          <Card>
            <CardHeader><CardTitle>{l.dealsTitle}</CardTitle><CardDescription>{l.dealsIntro}</CardDescription></CardHeader>
            <CardContent className="space-y-2 text-sm">
              {!d.bonuses.length ? <p className="text-muted-foreground">{l.noDeals}</p> : <ul className="divide-y" data-testid="bg-deals">{d.bonuses.map((b) => <li key={b.id} className="py-2"><span className="font-medium">{b.name}</span> <span className="text-xs text-muted-foreground">· {b.supplier}</span></li>)}</ul>}
              {active && d.bonuses.length > 0 && <Link href="/buy/rewards/bonuses" className="inline-block text-primary hover:underline">{l.seeBonuses} →</Link>}
            </CardContent>
          </Card>
        )}

        {s.features.groupOrders && (
          <Card className="lg:col-span-2">
            <CardHeader><CardTitle>{l.roundsTitle}</CardTitle><CardDescription>{l.roundsIntro}</CardDescription></CardHeader>
            <CardContent className="space-y-6">
              {!d.rounds.length ? <p className="text-sm text-muted-foreground">{l.noRounds}</p> : (
                <ul className="divide-y" data-testid="bg-rounds">
                  {d.rounds.map((r) => (
                    <li key={r.id} className="flex flex-wrap items-center gap-2 py-2 text-sm" data-testid="bg-round-row" data-status={r.status}>
                      {active ? <Link href={`/buy/groups/${g.id}/rounds/${r.id}`} className="min-w-0 break-words font-medium text-primary hover:underline">{r.title}</Link> : <span className="font-medium">{r.title}</span>}
                      <Badge variant={r.status === "OPEN" ? "success" : "secondary"}>{l[`roundStatus.${r.status}`]}</Badge>
                      <span className="text-xs text-muted-foreground">{r.supplier} · {r.status === "OPEN" ? fill(l.closes, { date: formatDate(r.closesAt, locale, true) }) : fill(l.deliveredOn, { date: formatDate(r.deliveryDate, locale) })} · {fill(l.linesN, { n: r.lines })}</span>
                    </li>
                  ))}
                </ul>
              )}
              {boss && live && suppliers.length > 0 && <div className="rounded-lg border p-4"><h3 className="mb-3 text-sm font-medium">{l.newRound}</h3><OpenRound l={l} groupId={g.id} suppliers={suppliers} maxDays={s.roundMaxDays} /></div>}
            </CardContent>
          </Card>
        )}

        {boss && g.status !== "CLOSED" && (
          <Card><CardHeader><CardTitle>{l.edit}</CardTitle></CardHeader><CardContent><EditGroup l={l} group={{ id: g.id, name: g.name, description: g.description, open: g.open }} /></CardContent></Card>
        )}
      </div>
    </>
  );
}
