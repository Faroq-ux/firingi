import Link from "next/link";
import { Rocket } from "lucide-react";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { inviteCountries, launchSettings, listInvites } from "@/server/launch/service";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { DataTable } from "@/components/ui/data-table";
import { InviteActions, InviteForm } from "@/components/launch/admin";

export const metadata = { title: "Pilot & invites" };
export const dynamic = "force-dynamic";
const TYPE: Record<string, string> = { CUSTOMER: "Customer", WHOLESALER: "Wholesaler", DISTRIBUTOR: "Distributor" };
const STATE = { open: ["Open", "default"], used: ["Used", "success"], expired: ["Expired", "outline"], revoked: ["Revoked", "destructive"] } as const;
const d = (x: Date | null) => (x ? x.toISOString().slice(0, 10) : "—");

export default async function PilotPage() {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.settings.view", "admin.settings.manage"]);
  const [settings, invites, countries] = await Promise.all([launchSettings(), listInvites(ctx), inviteCountries()]);
  const manage = ctx.permissions.has("admin.settings.manage");
  const opts = countries.map((c) => ({
    code: c.code, label: `${c.flag ?? ""} ${c.code}`,
    types: [c.customerMarketEnabled && "CUSTOMER", c.wholesalerMarketEnabled && "WHOLESALER", c.distributorSourcingEnabled && "DISTRIBUTOR"].filter(Boolean) as string[],
  }));
  const used = invites.filter((i) => i.state === "used").length;
  return (
    <>
      <PageHeader title="Pilot & invites" icon={Rocket}
        description="During the pilot, businesses can only apply with an invitation link. Each invitation is for one business, account type and country, is used once and expires. The e-mail goes out in the country's language. FIRINGI still approves every application as usual." />
      <Card className="mb-4" data-testid="pilot-state">
        <CardContent className="flex flex-wrap items-center gap-3 pt-5 text-sm">
          {settings.pilot ? <Badge variant="warning" className="px-3 py-1">Pilot is ON — invitation only</Badge> : <Badge variant="outline" className="px-3 py-1">Pilot is OFF — registration is open</Badge>}
          <span className="text-muted-foreground">{invites.length} invitations · {used} used</span>
          <Link href="/admin/settings/launch#settings" className="ml-auto font-medium text-primary hover:underline">Turn the pilot on or off →</Link>
        </CardContent>
      </Card>
      {manage && (
        <Card className="mb-4">
          <CardHeader><CardTitle>New invitation</CardTitle></CardHeader>
          <CardContent>{opts.length ? <InviteForm countries={opts} /> : <p className="text-sm text-muted-foreground">No market is open yet — open one under International first.</p>}</CardContent>
        </Card>
      )}
      <DataTable tableId="admin.launch.invites" testId="invites-table" empty="No invitations yet."
        columns={[{ key: "company", label: "Business" }, { key: "email", label: "E-mail" }, { key: "type", label: "Type", filter: true }, { key: "country", label: "Country", filter: true }, { key: "state", label: "State", type: "badge", filter: true }, { key: "sent", label: "Sent" }, { key: "expires", label: "Expires" }, { key: "actions", label: "" }]}
        rows={invites.map((i) => ({
          id: i.id,
          cells: {
            company: { t: i.companyName, sub: i.note ?? undefined }, email: i.email, type: TYPE[i.type] ?? i.type, country: i.countryCode,
            state: { t: STATE[i.state][0], tone: STATE[i.state][1] },
            sent: d(i.sentAt), expires: d(i.expiresAt),
            actions: i.state === "used" && i.usedBy ? { t: i.usedBy.legalName, node: <Link className="text-primary hover:underline" href={`/admin/companies/${i.usedBy.id}`}>{i.usedBy.legalName}</Link> }
              : i.state === "open" && manage ? { t: "", node: <InviteActions id={i.id} link={i.link} /> } : "",
          },
        }))} />
    </>
  );
}
