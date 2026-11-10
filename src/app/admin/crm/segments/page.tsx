import Link from "next/link";
import { can, pagePermission, pagePortal } from "@/server/rbac/guard";
import { crmCountries, crmTeam } from "@/server/services/crm";
import { listSegments, segmentMembers } from "@/server/services/crm-insights";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyRow, TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { SegmentForm } from "@/components/crm/forms";
import { ActivityBadge, eur, pretty, when } from "@/components/crm/views";

export const metadata = { title: "Customer Segments" };

export default async function Page({ searchParams }: { searchParams: Promise<{ id?: string; new?: string }> }) {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.crm.view", "admin.crm.manage"]);
  const sp = await searchParams;
  const manage = can(ctx, "admin.crm.manage");
  const [segments, countries, team] = await Promise.all([listSegments(ctx), crmCountries(), crmTeam(ctx)]);
  const current = segments.find((s) => s.id === sp.id);
  const members = current ? await segmentMembers(ctx, current.id) : [];
  const teamOpts = team.map((t) => ({ id: t.id, label: t.name }));
  const r = current?.rules;
  return (
    <>
      <PageHeader title="Customer Segments" description="Groups of buyers defined by rules (type, country, tier, tags, account manager, activity, 90-day spend). Members update by themselves as customers order." />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        <Card>
          <CardHeader><CardTitle>Segments</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm" data-testid="segments-list">
            {segments.map((s) => (
              <Link key={s.id} href={`?id=${s.id}`} className={`block rounded-md border p-2 hover:bg-accent ${s.id === sp.id ? "ring-2 ring-primary" : ""}`}>
                <div className="font-medium">{s.name}</div>
                <div className="text-xs text-muted-foreground">{s.count} buyers · {eur(s.spend90)} in 90 days{s.description ? ` · ${s.description}` : ""}</div>
              </Link>
            ))}
            {!segments.length && <p className="text-muted-foreground">No segments yet.</p>}
            {manage && <Link href="?new=1" className="inline-block text-primary hover:underline">+ New segment</Link>}
          </CardContent>
        </Card>
        <div className="space-y-4">
          {manage && (sp.new || current) && (
            <Card>
              <CardHeader><CardTitle>{current ? `Edit “${current.name}”` : "New segment"}</CardTitle></CardHeader>
              <CardContent>
                <SegmentForm key={current?.id ?? "new"} id={current?.id} name={current?.name} description={current?.description} countries={countries} team={teamOpts}
                  rules={r && { types: r.types ?? [], countryCodes: r.countryCodes ?? [], tags: (r.tags ?? []).join(", "), tiers: r.tiers ?? [], ownerId: r.ownerId ?? "", statuses: r.statuses ?? [], minSpend90: r.minSpend90 == null ? "" : String(r.minSpend90), maxSpend90: r.maxSpend90 == null ? "" : String(r.maxSpend90) }} />
              </CardContent>
            </Card>
          )}
          {current && (
            <Card>
              <CardHeader><CardTitle>{members.length} buyers in “{current.name}”</CardTitle></CardHeader>
              <CardContent>
                <Table data-testid="segment-members">
                  <THead><TR><TH>Company</TH><TH>Type</TH><TH>Activity</TH><TH className="text-right">Spend 90 d</TH><TH>Last order</TH><TH>Manager</TH><TH>Tags</TH></TR></THead>
                  <TBody>
                    {members.map((m) => (
                      <TR key={m.id}>
                        <TD><Link className="text-primary hover:underline" href={`/admin/crm/accounts/${m.id}`}>{m.legalName}</Link></TD>
                        <TD>{m.flag} {pretty(m.type)}</TD>
                        <TD><ActivityBadge status={m.status} /></TD>
                        <TD className="text-right tabular-nums">{eur(m.spend90)}</TD>
                        <TD>{when(m.lastOrderAt)}</TD>
                        <TD>{m.owner ?? "—"}</TD>
                        <TD>{m.tier && <Badge>{m.tier}</Badge>} {m.tags.join(", ")}</TD>
                      </TR>
                    ))}
                    {!members.length && <EmptyRow colSpan={7}>Nobody matches these rules right now.</EmptyRow>}
                  </TBody>
                </Table>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
