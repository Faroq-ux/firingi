import Link from "next/link";
import { Settings, Users } from "lucide-react";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { adminGroups, groupsOverview } from "@/server/buying-groups/service";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { ReviewGroup } from "@/components/buying-groups/admin";
import { formatDate } from "@/lib/utils";

export const metadata = { title: "Buying Groups" };
export const dynamic = "force-dynamic";

const STATUS: Record<string, string> = { PENDING: "Waiting for approval", APPROVED: "Active", REJECTED: "Turned down", CLOSED: "Closed" };
const tone = (s: string) => (s === "APPROVED" ? "success" : s === "PENDING" ? "warning" : "secondary") as "success" | "warning" | "secondary";

export default async function AdminBuyingGroupsPage() {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.customers.view", "admin.customers.manage", "admin.customers.approve", "admin.settings.manage"]);
  const [o, rows] = await Promise.all([groupsOverview(ctx), adminGroups(ctx)]);
  const canManage = ctx.permissions.has("admin.customers.manage") || ctx.permissions.has("admin.settings.manage");
  const pending = rows.filter((g) => g.status === "PENDING");
  const tiles = [["Waiting for approval", o.pending, "bg-t-pending"], ["Active groups", o.live, "bg-t-live"], ["Members in active groups", o.members, "bg-t-members"], ["Open group orders", o.openRounds, "bg-t-rounds"], ["Supplier group price lists", o.priced, "bg-t-priced"]] as const;
  return (
    <>
      <PageHeader title="Buying Groups" icon={Users} description="Restaurants, shops and wholesalers that buy together: group prices from suppliers, pooled rebate targets (the bonus shared by what each member bought), group orders and group reports."
        actions={canManage ? <Link href="/admin/customers/buying-groups/settings" className={buttonVariants({ variant: "outline" })} data-testid="bg-settings-link"><Settings className="size-4" /> Settings</Link> : null} />
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-5">
        {tiles.map(([label, n, id]) => <Card key={id}><CardContent className="pt-5"><p className="text-xs text-muted-foreground">{label}</p><p className="text-2xl font-semibold tabular-nums" data-testid={id}>{n}</p></CardContent></Card>)}
      </div>
      {pending.length > 0 && (
        <Card className="mb-6" data-testid="bg-pending">
          <CardHeader><CardTitle>Waiting for approval</CardTitle></CardHeader>
          <CardContent>
            <ul className="divide-y">
              {pending.map((g) => (
                <li key={g.id} className="space-y-2 py-3 text-sm" data-testid="bg-pending-row">
                  <p className="break-words"><Link href={`/admin/customers/buying-groups/${g.id}`} className="font-medium text-primary hover:underline">{g.name}</Link> <span className="text-xs text-muted-foreground">· {g.country} · started by {g.creator} · {formatDate(g.createdAt, "en")}</span></p>
                  {g.description && <p className="break-words text-xs text-muted-foreground">{g.description}</p>}
                  {canManage && <ReviewGroup id={g.id} />}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
      <Card>
        <CardHeader><CardTitle>All groups</CardTitle></CardHeader>
        <CardContent>
          {!rows.length ? <p className="py-6 text-center text-sm text-muted-foreground">No buying groups yet.</p> : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm" data-testid="bg-all">
                <thead><tr className="text-left text-xs text-muted-foreground"><th className="py-2 pr-3 font-normal">Group</th><th className="py-2 pr-3 font-normal">Status</th><th className="py-2 pr-3 font-normal">Country</th><th className="py-2 pr-3 text-right font-normal">Members</th><th className="py-2 pr-3 text-right font-normal">Group orders</th><th className="py-2 font-normal">Started by</th></tr></thead>
                <tbody>
                  {rows.map((g) => (
                    <tr key={g.id} className="border-t" data-testid="bg-all-row">
                      <td className="py-2 pr-3"><Link href={`/admin/customers/buying-groups/${g.id}`} className="break-words text-primary hover:underline">{g.name}</Link></td>
                      <td className="py-2 pr-3"><Badge variant={tone(g.status)}>{STATUS[g.status]}</Badge></td>
                      <td className="whitespace-nowrap py-2 pr-3">{g.country}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{g.members}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{g.rounds}</td>
                      <td className="break-words py-2">{g.creator}</td>
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
