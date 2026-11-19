/** Phase 47d — FIRINGI's queue of address changes (new addresses, shops, moves) with the till invoice as proof. */
import Link from "next/link";
import type { Ctx } from "@/server/context";
import { can } from "@/server/rbac/guard";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { adminAddressRequests, addressApprovalSettings } from "@/server/services/addresses";
import { formatDate } from "@/lib/utils";
import { AddressApprovalSettingsForm, AddressDecision } from "./address-requests-client";
import { MapPinned } from "lucide-react";

const KIND: Record<string, string> = { HEAD_OFFICE: "Head office", BILLING: "Billing", WAREHOUSE: "Warehouse", PICKUP: "Pickup / cash & carry", DELIVERY: "Delivery / shop" };

export async function AdminAddressRequestsPage({ ctx, types, title, all }: { ctx: Ctx; types: ("DISTRIBUTOR" | "WHOLESALER" | "CUSTOMER")[]; title: string; all?: boolean }) {
  const [rows, settings] = await Promise.all([adminAddressRequests(ctx, { types, status: all ? "ALL" : "PENDING" }), addressApprovalSettings()]);
  const fmt = (d: { label?: string; line1?: string; line2?: string | null; postalCode?: string; cityName?: string; countryCode?: string } | null) => d ? `${d.line1 ?? ""}${d.line2 ? `, ${d.line2}` : ""}, ${d.postalCode ?? ""} ${d.cityName ?? ""} ${d.countryCode ?? ""}`.replace(/\s+/g, " ").trim() : "—";
  return (
    <>
      <PageHeader title={title} icon={MapPinned} description="New addresses, shops and moves wait here once a company has sent its registration. Approval is needed the first time an address is used; name / contact / phone edits apply at once. The company can attach a recent invoice from its own till at that address." />
      <div className="mb-3 flex gap-3 text-sm"><Link className={all ? "text-primary hover:underline" : "font-semibold"} href="?">Waiting</Link><Link className={all ? "font-semibold" : "text-primary hover:underline"} href="?all=1">All (recent)</Link></div>
      <Card className="mb-4"><CardContent className="overflow-x-auto pt-5">
        <table className="w-full min-w-[760px] text-sm" data-testid="admin-address-requests">
          <thead><tr className="border-b text-left text-xs uppercase text-muted-foreground [&>th]:pr-3"><th className="py-2">Company</th><th>Change</th><th>Proposed</th><th>Now</th><th>Till invoice</th><th>Status / decision</th></tr></thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={6} className="py-6 text-center text-muted-foreground">Nothing waiting.</td></tr>}
            {rows.map((r) => {
              const d = r.data as { label?: string; line1?: string; line2?: string | null; postalCode?: string; cityName?: string; countryCode?: string };
              return (
                <tr key={r.id} className="border-b align-top" data-testid="admin-address-request">
                  <td className="py-2 pr-2"><Link className="text-primary hover:underline" href={`/admin/companies/${r.company.id}`}>{r.company.tradeName ?? r.company.legalName}</Link><div className="text-xs text-muted-foreground">{r.company.country.flag} NIF {r.company.taxId} · {r.requestedBy} · {formatDate(r.createdAt, "en-GB", true)}</div></td>
                  <td className="pr-2"><Badge variant="secondary">{r.action === "CREATE" ? "New" : r.action === "UPDATE" ? "Move" : "Remove"}</Badge><div className="text-xs">{KIND[r.kind] ?? r.kind}</div></td>
                  <td className="pr-2"><div className="font-medium">{d.label ?? ""}</div><div className="text-xs">{r.action === "REMOVE" ? "—" : fmt(d)}</div></td>
                  <td className="pr-2 text-xs text-muted-foreground">{r.current ? fmt({ ...r.current, countryCode: r.current.country.code }) : "—"}</td>
                  <td className="pr-2 text-xs">{r.proofKey ? <a className="text-primary hover:underline" href={`/api/files/address-proof/${r.id}`} target="_blank" rel="noreferrer" data-testid="admin-address-proof">{r.proofName} ({r.proofIssuedOn ? formatDate(r.proofIssuedOn, "en-GB") : "no date"})</a> : <Badge variant="warning">none</Badge>}{r.proofBypassed && <div><Badge variant="outline">approved without invoice</Badge></div>}</td>
                  <td className="min-w-[220px]">{r.status === "PENDING" ? (r.canDecide ? <AddressDecision id={r.id} hasProof={!!r.proofKey || r.action === "REMOVE"} proofRequired={settings.proofRequired} /> : <span className="text-xs text-muted-foreground">Waiting</span>) : <div><Badge variant={r.status === "APPROVED" ? "success" : r.status === "REJECTED" ? "destructive" : "secondary"}>{r.status.toLowerCase()}</Badge>{r.decisionNote && <div className="text-xs">{r.decisionNote}</div>}</div>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </CardContent></Card>
      {can(ctx, "admin.settings.manage") && (
        <Card><CardHeader><CardTitle>Address approval settings</CardTitle><CardDescription>For all distributors, wholesalers and wholesale customers once they have sent their registration. Addresses printed on till receipts are fixed regardless.</CardDescription></CardHeader>
          <CardContent><AddressApprovalSettingsForm initial={settings} /></CardContent></Card>
      )}
    </>
  );
}
