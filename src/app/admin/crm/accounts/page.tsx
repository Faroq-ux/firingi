import type { CompanyType } from "@prisma/client";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { crmTeam, listAccounts } from "@/server/services/crm";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { DataTable } from "@/components/ui/data-table";
import { listViews } from "@/server/services/workspace";
import { Pills, eur, pretty, when } from "@/components/crm/views";

export const metadata = { title: "Business Accounts" };

export default async function Page({ searchParams }: { searchParams: Promise<{ type?: string; owner?: string; tag?: string; q?: string }> }) {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.crm.view", "admin.crm.manage"]);
  const sp = await searchParams;
  const type = ["CUSTOMER", "WHOLESALER", "DISTRIBUTOR"].includes(sp.type ?? "") ? (sp.type as CompanyType) : undefined;
  const ownerId = sp.owner === "me" ? ctx.user.id : sp.owner === "none" ? undefined : sp.owner || undefined;
  const [rows0, team] = await Promise.all([listAccounts(ctx, { type, ownerId, tag: sp.tag?.toLowerCase(), q: sp.q }), crmTeam(ctx)]);
  const rows = sp.owner === "none" ? rows0.filter((r) => !r.crmAccount?.ownerId) : rows0;
  const base = { type: sp.type, owner: sp.owner, tag: sp.tag, q: sp.q };
  return (
    <>
      <PageHeader title="Business Accounts" description="Approved customers, wholesalers and distributors with their account manager, tier, tags and recent business." />
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <Pills items={[{ value: "", label: "All" }, { value: "CUSTOMER", label: "Customers" }, { value: "WHOLESALER", label: "Wholesalers" }, { value: "DISTRIBUTOR", label: "Distributors" }]} current={sp.type ?? ""} param="type" base={base} />
        <Pills items={[{ value: "", label: "Any manager" }, { value: "me", label: "Mine" }, { value: "none", label: "No manager" }, ...team.slice(0, 6).map((t) => ({ value: t.id, label: t.name }))]} current={sp.owner ?? ""} param="owner" base={base} />
        <form className="flex w-full min-w-0 gap-1 sm:w-auto">
          {sp.type && <input type="hidden" name="type" value={sp.type} />}
          <input name="q" defaultValue={sp.q} placeholder="Name or VAT…" className="h-8 min-w-0 flex-1 rounded-md border bg-card px-2 text-sm" />
          <input name="tag" defaultValue={sp.tag} placeholder="Tag" className="h-8 w-24 rounded-md border bg-card px-2 text-sm" />
          <button className="h-8 rounded-md border px-2 text-sm">Filter</button>
        </form>
      </div>
      <DataTable tableId="admin.crm-accounts" views={await listViews(ctx, "admin.crm-accounts")} testId="accounts-table" empty="No accounts." exportName="accounts"
        columns={[{ key: "company", label: "Company" }, { key: "type", label: "Type", type: "badge" }, { key: "manager", label: "Manager", type: "badge" }, { key: "tags", label: "Tier · tags" }, { key: "bought", label: "Bought 90 d", type: "money" }, { key: "sold", label: "Sold 90 d", type: "money" }, { key: "lastOrder", label: "Last order", type: "date" }, { key: "lastContact", label: "Last contact", type: "date" }, { key: "tasks", label: "Open tasks", type: "number" }]}
        rows={rows.map((a) => ({
          id: a.id, href: `/admin/crm/accounts/${a.id}`,
          cells: {
            company: { t: a.tradeName ?? a.legalName, sub: `${a.country.flag ?? ""} ${a.legalName}`.trim() },
            type: `${pretty(a.type)}${a.isInHouse ? " (in-house)" : ""}`, manager: a.crmAccount?.owner?.name ?? "—",
            tags: { t: [a.crmAccount?.tier, ...(a.crmAccount?.tags ?? [])].filter(Boolean).join(" "), node: <>{a.crmAccount?.tier && <Badge>{a.crmAccount.tier}</Badge>} {a.crmAccount?.tags.map((t) => <Badge key={t} variant="secondary" className="mr-1">{t}</Badge>)}</> },
            bought: { t: a.type === "DISTRIBUTOR" ? "—" : eur(a.bought90), v: a.type === "DISTRIBUTOR" ? null : Number(a.bought90) },
            sold: { t: a.type === "CUSTOMER" ? "—" : eur(a.sold90), v: a.type === "CUSTOMER" ? null : Number(a.sold90) },
            lastOrder: { t: when(a.lastOrderAt), v: a.lastOrderAt ? new Date(a.lastOrderAt).getTime() : null },
            lastContact: { t: when(a.lastContactAt), v: a.lastContactAt ? new Date(a.lastContactAt).getTime() : null },
            tasks: a.openTasks || 0,
          },
        }))} />
    </>
  );
}
