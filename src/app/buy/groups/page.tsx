import Link from "next/link";
import { Search, Users } from "lucide-react";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { myGroups, openGroups } from "@/server/buying-groups/service";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { fill, groupLabels } from "@/components/buying-groups/labels";
import { AskJoin, CreateGroup, RespondInvite } from "@/components/buying-groups/client";

export const metadata = { title: "Buying Groups" };
export const dynamic = "force-dynamic";

export default async function BuyingGroupsPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const ctx = await pagePortal("buy");
  pagePermission(ctx, ["buyer.orders.view", "buyer.orders.place", "company.profile.manage"]);
  const { q } = await searchParams;
  const [{ l }, m] = await Promise.all([groupLabels(), myGroups(ctx)]);
  const manager = ctx.membership.isOwner || ctx.permissions.has("company.profile.manage");
  const find = m.access.member && m.settings.joinRequests ? await openGroups(ctx, q ?? null) : [];
  const invites = m.groups.filter((g) => g.myStatus === "INVITED");
  const mine = m.groups.filter((g) => g.myStatus !== "INVITED");
  const tone = (s: string) => (s === "APPROVED" ? "success" : s === "PENDING" ? "warning" : "secondary") as "success" | "warning" | "secondary";
  return (
    <>
      <PageHeader title={l.title} icon={Users} description={l.intro} />
      {!m.access.member ? <p className="rounded-xl border border-dashed p-6 text-center text-sm" data-testid="bg-closed">{l[`closed.${m.access.why ?? "OFF"}`]}</p> : (
        <div className="space-y-6">
          {invites.length > 0 && (
            <Card data-testid="bg-invites">
              <CardHeader><CardTitle>{l.invitations}</CardTitle></CardHeader>
              <CardContent>
                <ul className="divide-y">
                  {invites.map((g) => (
                    <li key={g.id} className="flex flex-wrap items-center gap-3 py-3 text-sm" data-testid="bg-invite-row">
                      <div className="min-w-0 flex-1"><p className="break-words font-medium">{fill(l.invitedTo, { name: g.name })}</p>{g.description && <p className="break-words text-xs text-muted-foreground">{g.description}</p>}<p className="text-xs text-muted-foreground">{fill(l.membersN, { n: g.members })}</p></div>
                      {manager && <RespondInvite l={l} groupId={g.id} />}
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader><CardTitle>{l.myGroups}</CardTitle></CardHeader>
            <CardContent>
              {!mine.length ? <p className="py-4 text-center text-sm text-muted-foreground">{l.noGroups}</p> : (
                <ul className="divide-y" data-testid="bg-my-groups">
                  {mine.map((g) => (
                    <li key={g.id} className="flex flex-wrap items-center gap-2 py-3 text-sm" data-testid="bg-group-row" data-status={g.status}>
                      <Link href={`/buy/groups/${g.id}`} className="min-w-0 break-words font-medium text-primary hover:underline">{g.name}</Link>
                      <Badge variant={tone(g.status)}>{l[`status.${g.status}`]}</Badge>
                      {g.myStatus === "REQUESTED" ? <Badge variant="outline">{l["memberStatus.REQUESTED"]}</Badge> : <Badge variant="outline">{l[`role.${g.myRole}`]}</Badge>}
                      <span className="ml-auto text-xs text-muted-foreground">{fill(l.membersN, { n: g.members })}</span>
                      {g.reviewNote && g.status === "REJECTED" && <p className="basis-full break-words text-xs text-muted-foreground">{fill(l.firingiNote, { note: g.reviewNote })}</p>}
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <div className="grid gap-6 lg:grid-cols-2">
            {m.access.create && manager && (
              <Card>
                <CardHeader><CardTitle>{l.create}</CardTitle></CardHeader>
                <CardContent><CreateGroup l={l} auto={m.settings.approval === "AUTO"} /></CardContent>
              </Card>
            )}
            {m.settings.joinRequests && (
              <Card>
                <CardHeader><CardTitle>{l.findTitle}</CardTitle></CardHeader>
                <CardContent className="space-y-3">
                  <form className="flex gap-2" method="get">
                    <Input name="q" defaultValue={q ?? ""} placeholder={l.search} aria-label={l.search} />
                    <Button type="submit" variant="outline" aria-label={l.search}><Search className="size-4" /></Button>
                  </form>
                  {!find.length ? <p className="py-2 text-sm text-muted-foreground">{l.noOpen}</p> : (
                    <ul className="divide-y" data-testid="bg-open-groups">
                      {find.map((g) => (
                        <li key={g.id} className="space-y-2 py-3 text-sm" data-testid="bg-open-row">
                          <p className="break-words font-medium">{g.name} <span className="text-xs font-normal text-muted-foreground">· {fill(l.membersN, { n: g.members })}</span></p>
                          {g.description && <p className="break-words text-xs text-muted-foreground">{g.description}</p>}
                          {manager && <AskJoin l={l} groupId={g.id} />}
                        </li>
                      ))}
                    </ul>
                  )}
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      )}
    </>
  );
}
