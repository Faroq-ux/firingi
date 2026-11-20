import Link from "next/link";
import { Gift, Plus } from "lucide-react";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { adminRewards, rewardsOverview } from "@/server/rewards/service";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { KIND_ICON } from "@/components/rewards/pages";
import { REWARD_KINDS } from "@/lib/rewards";

export const metadata = { title: "Rewards Shop" };
export const dynamic = "force-dynamic";

const KIND: Record<string, string> = { VOUCHER: "Voucher", FREE_DELIVERY: "Free delivery", SUPPLIER_PRODUCT: "Supplier product", GIFT: "Gift", PARTNER: "Partner offer" };
const STATUS_TONE: Record<string, "success" | "warning" | "secondary" | "destructive"> = { DRAFT: "secondary", PENDING: "warning", ACTIVE: "success", PAUSED: "secondary", REJECTED: "destructive", ENDED: "secondary" };
const STATUSES = ["ALL", "ACTIVE", "PENDING", "PAUSED", "DRAFT", "REJECTED", "ENDED"];

/** Phase 55: FIRINGI's rewards shop — every reward, supplier rewards to accept, numbers. */
export default async function Page({ searchParams }: { searchParams: Promise<{ status?: string; kind?: string; q?: string }> }) {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.marketing.view", "admin.marketing.manage"]);
  const f = await searchParams;
  const status = STATUSES.includes(f.status ?? "") ? f.status : "ALL";
  const kind = (REWARD_KINDS as readonly string[]).includes(f.kind ?? "") ? f.kind : undefined;
  const [list, o] = await Promise.all([adminRewards(ctx, { status, kind, q: f.q }), rewardsOverview(ctx)]);
  const qs = (p: Record<string, string | undefined>) => `?${new URLSearchParams(Object.entries({ status, kind, q: f.q, ...p }).filter(([, v]) => v) as [string, string][]).toString()}`;
  const tiles: [string, string, string?][] = [
    ["Redeemed (30 days)", `${o.last30.count} · ${o.last30.points.toLocaleString("en")} pts`],
    ["Points spent, € value (30 days)", `${o.last30.euros} €`],
    ["Supplier rewards to accept", String(o.pending), "kpi-pending"],
    ["Gifts to send", String(o.open.PENDING ?? 0)],
    ["Voucher discounts given", `${o.voucherDiscount} €`],
    ["Gift cost", `${o.giftCost} €`],
  ];
  return (
    <>
      <PageHeader title="Rewards Shop" icon={Gift} description="Businesses spend loyalty points here: FIRINGI vouchers and free delivery (as single-use coupons), suppliers' own products (supplier-paid), gifts FIRINGI sends, and partner codes."
        actions={<div className="flex flex-wrap gap-3 text-sm"><Link href="/admin/marketing/rewards/redemptions" className="text-primary hover:underline">Redemptions →</Link><Link href="/admin/settings/rewards" className="text-primary hover:underline">Settings →</Link></div>} />
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {tiles.map(([label, value, testid]) => <Card key={label}><CardContent className="pt-5"><p className="text-xs text-muted-foreground">{label}</p><p className="break-words text-xl font-semibold tabular-nums" data-testid={testid}>{value}</p></CardContent></Card>)}
      </div>
      {o.lowStock.length > 0 && <p className="mb-4 rounded-lg bg-warning/15 p-3 text-sm" role="status">Running low: {o.lowStock.map((x) => `${x.title} (${x.stock})`).join(", ")}</p>}
      <Card className="mb-4">
        <CardHeader><CardTitle>New reward</CardTitle></CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {REWARD_KINDS.filter((k) => k !== "SUPPLIER_PRODUCT").map((k) => { const I = KIND_ICON[k]; return <Link key={k} href={`/admin/marketing/rewards/new?kind=${k}`} className="inline-flex h-9 items-center gap-1.5 rounded-md border px-3 text-sm hover:bg-accent" data-testid={`new-${k}`}><Plus className="size-4" aria-hidden /><I className="size-4" aria-hidden /> {KIND[k]}</Link>; })}
        </CardContent>
      </Card>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {STATUSES.map((s) => <Link key={s} href={qs({ status: s })} className={`rounded-full border px-3 py-1 text-xs ${status === s ? "border-primary bg-primary/10 text-primary" : "hover:bg-accent"}`}>{s === "ALL" ? "All" : s.toLowerCase()}{s === "PENDING" && list.pending ? ` (${list.pending})` : ""}</Link>)}
        <span className="mx-1 text-muted-foreground">|</span>
        <Link href={qs({ kind: undefined })} className={`rounded-full border px-3 py-1 text-xs ${!kind ? "border-primary bg-primary/10 text-primary" : "hover:bg-accent"}`}>Every kind</Link>
        {REWARD_KINDS.map((k) => <Link key={k} href={qs({ kind: k })} className={`rounded-full border px-3 py-1 text-xs ${kind === k ? "border-primary bg-primary/10 text-primary" : "hover:bg-accent"}`}>{KIND[k]}</Link>)}
        <form className="ml-auto" action="/admin/marketing/rewards"><input type="hidden" name="status" value={status} />{kind && <input type="hidden" name="kind" value={kind} />}<input name="q" defaultValue={f.q} placeholder="Search…" className="h-8 w-44 rounded-md border bg-card/80 px-2 text-sm" aria-label="Search rewards" /></form>
      </div>
      <Card><CardContent className="overflow-x-auto pt-4">
        {!list.items.length ? <p className="py-6 text-center text-sm text-muted-foreground">No rewards.</p> : (
          <table className="w-full min-w-[640px] text-sm" data-testid="ar-table">
            <thead><tr className="text-left text-xs text-muted-foreground"><th className="py-2">Reward</th><th>Kind</th><th className="text-right">Points</th><th className="text-right">Stock</th><th className="text-right">Redeemed</th><th>Status</th></tr></thead>
            <tbody className="divide-y">
              {list.items.map((i) => (
                <tr key={i.id} data-testid="ar-row">
                  <td className="py-2 pr-2"><Link href={`/admin/marketing/rewards/${i.id}`} className="font-medium hover:underline">{i.title}</Link>{i.supplier && <span className="block text-xs text-muted-foreground">{i.supplier} · {i.qty} × {i.offer?.name}</span>}{i.partnerName && <span className="block text-xs text-muted-foreground">{i.partnerName}</span>}</td>
                  <td>{KIND[i.kind]}</td>
                  <td className="text-right tabular-nums">{i.points.toLocaleString("en")}</td>
                  <td className="text-right tabular-nums">{i.stock ?? "∞"}</td>
                  <td className="text-right tabular-nums">{i.redeemed}</td>
                  <td><Badge variant={STATUS_TONE[i.status]}>{i.status.toLowerCase()}</Badge></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </CardContent></Card>
      {o.top.length > 0 && <p className="mt-3 text-xs text-muted-foreground">Most redeemed: {o.top.map((t) => `${t.title} (${t.count})`).join(" · ")} · Supplier units handed over: {o.supplierUnits}</p>}
    </>
  );
}
