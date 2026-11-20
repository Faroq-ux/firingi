import Link from "next/link";
import { Gift } from "lucide-react";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { adminRedemptions } from "@/server/rewards/service";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { AdminCancel, GiftActions } from "@/components/rewards/admin";
import { REWARD_KINDS } from "@/lib/rewards";

export const metadata = { title: "Reward Redemptions" };
export const dynamic = "force-dynamic";

const KIND: Record<string, string> = { VOUCHER: "Voucher", FREE_DELIVERY: "Free delivery", SUPPLIER_PRODUCT: "Supplier product", GIFT: "Gift", PARTNER: "Partner offer" };
const STATUSES = ["ALL", "PENDING", "SHIPPED", "ISSUED", "USED", "DELIVERED", "CANCELLED", "EXPIRED"];

/** Phase 55: everything redeemed — gifts to send (tracking), codes, supplier products; cancel with points back. */
export default async function Page({ searchParams }: { searchParams: Promise<{ status?: string; kind?: string; q?: string }> }) {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.marketing.view", "admin.marketing.manage"]);
  const f = await searchParams;
  const status = STATUSES.includes(f.status ?? "") ? f.status : "ALL";
  const kind = (REWARD_KINDS as readonly string[]).includes(f.kind ?? "") ? f.kind : undefined;
  const rows = await adminRedemptions(ctx, { status, kind, q: f.q });
  const qs = (p: Record<string, string | undefined>) => `?${new URLSearchParams(Object.entries({ status, kind, q: f.q, ...p }).filter(([, v]) => v) as [string, string][]).toString()}`;
  return (
    <>
      <PageHeader title="Reward Redemptions" icon={Gift} description="Gifts to send, coupons and partner codes given, supplier products on their way. Cancelling gives the points back." actions={<Link href="/admin/marketing/rewards" className="text-sm text-primary hover:underline">← Rewards Shop</Link>} />
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {STATUSES.map((s) => <Link key={s} href={qs({ status: s })} className={`rounded-full border px-3 py-1 text-xs ${status === s ? "border-primary bg-primary/10 text-primary" : "hover:bg-accent"}`}>{s === "ALL" ? "All" : s.toLowerCase()}</Link>)}
        <span className="mx-1 text-muted-foreground">|</span>
        <Link href={qs({ kind: undefined })} className={`rounded-full border px-3 py-1 text-xs ${!kind ? "border-primary bg-primary/10 text-primary" : "hover:bg-accent"}`}>Every kind</Link>
        {REWARD_KINDS.map((k) => <Link key={k} href={qs({ kind: k })} className={`rounded-full border px-3 py-1 text-xs ${kind === k ? "border-primary bg-primary/10 text-primary" : "hover:bg-accent"}`}>{KIND[k]}</Link>)}
        <form className="ml-auto" action="/admin/marketing/rewards/redemptions"><input type="hidden" name="status" value={status} />{kind && <input type="hidden" name="kind" value={kind} />}<input name="q" defaultValue={f.q} placeholder="Business, reward or code…" className="h-8 w-52 rounded-md border bg-card/80 px-2 text-sm" aria-label="Search redemptions" /></form>
      </div>
      {!rows.length ? <p className="py-10 text-center text-muted-foreground">Nothing here.</p> : (
        <ul className="space-y-2" data-testid="red-list">
          {rows.map((r) => {
            const open = r.status === "ISSUED" || r.status === "PENDING" || r.status === "SHIPPED";
            return (
              <li key={r.id}><Card data-testid="red-row" data-kind={r.kind} data-status={r.status}><CardContent className="flex flex-col gap-2 pt-4 lg:flex-row lg:flex-wrap lg:items-center">
                <div className="min-w-0 flex-1 space-y-0.5">
                  <p className="break-words font-medium">{r.title} <span className="text-xs font-normal text-muted-foreground">· {KIND[r.kind]}</span></p>
                  <p className="break-words text-sm"><Link href={`/admin/marketing/loyalty/members/${r.companyId}`} className="hover:underline">{r.buyer}</Link> · {r.points.toLocaleString("en")} pts · {new Date(r.at).toLocaleDateString("en-GB")}</p>
                  {r.couponCode && <p className="text-xs text-muted-foreground">Coupon <code>{r.couponCode}</code>{r.expiresAt && ` · until ${new Date(r.expiresAt).toLocaleDateString("en-GB")}`}</p>}
                  {r.partnerCode && <p className="text-xs text-muted-foreground">Code <code>{r.partnerCode}</code></p>}
                  {r.supplier && <p className="break-words text-xs text-muted-foreground">{r.supplier} · {r.usedQty}/{r.qty} taken{r.order ? ` · order ${r.order.number}` : ""}</p>}
                  {r.address && <p className="break-words text-xs text-muted-foreground">To: {r.address}{r.note && ` — “${r.note}”`}</p>}
                  {r.tracking && <p className="break-words text-xs">Tracking: {r.tracking}</p>}
                  {r.cancelReason && <p className="break-words text-xs text-muted-foreground">Reason: {r.cancelReason}</p>}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={r.status === "PENDING" ? "warning" : r.status === "DELIVERED" || r.status === "USED" || r.status === "ISSUED" ? "success" : r.status === "EXPIRED" ? "destructive" : "secondary"}>{r.status.toLowerCase()}</Badge>
                  {r.kind === "GIFT" && <GiftActions id={r.id} status={r.status} />}
                  {open && <AdminCancel id={r.id} />}
                </div>
              </CardContent></Card></li>
            );
          })}
        </ul>
      )}
    </>
  );
}
