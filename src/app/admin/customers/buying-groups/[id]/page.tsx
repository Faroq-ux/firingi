import Link from "next/link";
import { notFound } from "next/navigation";
import { Users } from "lucide-react";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { groupDetail, groupReport } from "@/server/buying-groups/service";
import { NotFoundError } from "@/server/errors";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ReviewGroup } from "@/components/buying-groups/admin";
import { CloseGroup } from "@/components/buying-groups/client";
import { formatDate, formatMoney } from "@/lib/utils";

export const metadata = { title: "Buying Group" };
export const dynamic = "force-dynamic";

const STATUS: Record<string, string> = { PENDING: "Waiting for approval", APPROVED: "Active", REJECTED: "Turned down", CLOSED: "Closed" };
const MEMBER: Record<string, string> = { INVITED: "Invited", REQUESTED: "Asked to join", ACTIVE: "Member", DECLINED: "Declined", LEFT: "Left", REMOVED: "Removed" };
const ROUND: Record<string, string> = { OPEN: "Open", PLACED: "Placed", CANCELLED: "Cancelled" };

export default async function AdminBuyingGroupPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.customers.view", "admin.customers.manage", "admin.customers.approve", "admin.settings.manage"]);
  const { id } = await params;
  const d = await groupDetail(ctx, id).catch((e) => { if (e instanceof NotFoundError) notFound(); throw e; });
  const r = d.settings.features.reports ? await groupReport(ctx, id, "QUARTER") : null;
  const canManage = ctx.permissions.has("admin.customers.manage") || ctx.permissions.has("admin.settings.manage");
  const g = d.group, eur = (n: number) => formatMoney(n, "en");
  return (
    <>
      <PageHeader title={g.name} icon={Users} eyebrow="Buying group" description={g.description ?? undefined}
        actions={canManage && g.status !== "CLOSED" ? <CloseGroup label="Close group" confirm="Close this group for everyone? Open group orders are cancelled and group prices stop." groupId={g.id} /> : null} />
      <div className="mb-4 flex flex-wrap items-center gap-2 text-sm">
        <Link href="/admin/customers/buying-groups" className="text-primary hover:underline">← Buying Groups</Link>
        <Badge variant={g.status === "APPROVED" ? "success" : g.status === "PENDING" ? "warning" : "secondary"} data-testid="bg-status">{STATUS[g.status]}</Badge>
        <span className="text-muted-foreground">{g.open ? "Open to join requests" : "Invitation only"} · created {formatDate(g.createdAt, "en")}</span>
        {g.reviewNote && <span className="basis-full break-words text-xs text-muted-foreground">Note: {g.reviewNote}</span>}
      </div>
      {g.status === "PENDING" && canManage && <Card className="mb-6"><CardContent className="pt-6"><ReviewGroup id={g.id} /></CardContent></Card>}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Members</CardTitle></CardHeader>
          <CardContent>
            <ul className="divide-y text-sm" data-testid="bg-members">
              {d.members.map((m) => (
                <li key={m.companyId} className="flex flex-wrap items-center gap-2 py-2" data-testid="bg-member">
                  <Link href={`/admin/crm/accounts/${m.companyId}`} className="min-w-0 flex-1 break-words text-primary hover:underline">{m.name}</Link>
                  <span className="text-xs text-muted-foreground">{m.type === "WHOLESALER" ? "Wholesaler" : "Customer"}</span>
                  {m.role === "ADMIN" && m.status === "ACTIVE" && <Badge>Admin</Badge>}
                  <Badge variant={m.status === "ACTIVE" ? "success" : "secondary"}>{MEMBER[m.status]}</Badge>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
        {r && (
          <Card>
            <CardHeader><CardTitle>Purchases this quarter ({r.period})</CardTitle></CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="grid grid-cols-2 gap-3"><div className="rounded-lg border p-3"><p className="text-xs text-muted-foreground">Group total (excl. VAT)</p><p className="text-lg font-semibold tabular-nums" data-testid="bg-total">{eur(r.total)}</p></div><div className="rounded-lg border p-3"><p className="text-xs text-muted-foreground">Bonuses earned (last 12 months)</p><p className="text-lg font-semibold tabular-nums">{eur(r.bonuses.value)}</p>{r.bonuses.free > 0 && <p className="text-xs text-muted-foreground">{r.bonuses.free} free units</p>}</div></div>
              <ul className="divide-y">{r.byMember.map((m) => <li key={m.companyId} className="flex justify-between gap-2 py-1.5"><span className="min-w-0 break-words">{m.name}</span><span className="tabular-nums">{eur(m.net)} <span className="text-xs text-muted-foreground">({m.share} %)</span></span></li>)}</ul>
            </CardContent>
          </Card>
        )}
        <Card>
          <CardHeader><CardTitle>Group prices and deals</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            {!d.prices.length && !d.bonuses.length && <p className="text-muted-foreground">None yet.</p>}
            {d.prices.map((p) => <p key={p.id}>Prices: {p.supplier} — {p.items} products{p.validTo ? ` until ${formatDate(p.validTo, "en")}` : ""}</p>)}
            {d.bonuses.map((b) => <p key={b.id}>Deal: <Link href={`/admin/pricing/rebates/${b.id}`} className="text-primary hover:underline">{b.name}</Link> — {b.supplier}</p>)}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Group orders</CardTitle></CardHeader>
          <CardContent>
            {!d.rounds.length ? <p className="text-sm text-muted-foreground">None yet.</p> : (
              <ul className="divide-y text-sm" data-testid="bg-rounds">{d.rounds.map((x) => <li key={x.id} className="flex flex-wrap items-center gap-2 py-2"><span className="min-w-0 flex-1 break-words">{x.title} <span className="text-xs text-muted-foreground">· {x.supplier} · delivery {formatDate(x.deliveryDate, "en")} · {x.lines} lines</span></span><Badge variant={x.status === "OPEN" ? "success" : "secondary"}>{ROUND[x.status]}</Badge></li>)}</ul>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
