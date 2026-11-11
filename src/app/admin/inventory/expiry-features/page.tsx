import { can, pagePermission, pagePortal } from "@/server/rbac/guard";
import { getDefaults, listFeatureRequests, supplierFeatures } from "@/server/inventory/expiry";
import { SUPPLIER_FEATURES as FEATURES, FEATURE_LABEL, FIELD } from "@/server/inventory/settings";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { DecideRequest, DefaultsForm, FeatureSwitch, ResetFeatures } from "@/components/inventory/admin-controls";

export const metadata = { title: "Expiry Features" };

export default async function ExpiryFeatures() {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.inventory.view", "admin.inventory.manage"]);
  const manage = can(ctx, "admin.inventory.manage");
  const [defaults, suppliers, requests] = await Promise.all([getDefaults(ctx), supplierFeatures(ctx), listFeatureRequests(ctx)]);
  const pending = requests.filter((r) => r.status === "PENDING");
  const date = new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
  return (
    <>
      <PageHeader title="Expiry Features" description="Switch FEFO picking, expiry alerts, AI markdown suggestions and best-before display on or off for each supplier. Suppliers can ask for a change; you approve or reject it." />
      <Card className="mb-6"><CardHeader><CardTitle>Requests from suppliers</CardTitle><CardDescription>{pending.length ? `${pending.length} waiting for a decision.` : "Nothing waiting."}</CardDescription></CardHeader>
        <CardContent className="space-y-2" data-testid="feature-requests">
          {requests.slice(0, 30).map((r) => (
            <div key={r.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border p-3 text-sm">
              <div><b>{r.supplier}</b> asks to switch <b>{r.enable ? "on" : "off"}</b> “{FEATURE_LABEL[r.feature as keyof typeof FEATURE_LABEL]}”{r.note ? <span className="text-muted-foreground"> — {r.note}</span> : null}
                <div className="text-xs text-muted-foreground">{r.requestedBy} · {date.format(r.requestedAt)}{r.decidedBy ? ` · decided by ${r.decidedBy}` : ""}{r.reason ? ` · ${r.reason}` : ""}</div></div>
              {r.status === "PENDING" && manage ? <DecideRequest id={r.id} /> : <Badge variant={r.status === "APPROVED" ? "success" : r.status === "REJECTED" ? "destructive" : "outline"}>{r.status.toLowerCase()}</Badge>}
            </div>
          ))}
        </CardContent>
      </Card>
      <Card className="mb-6"><CardHeader><CardTitle>Defaults</CardTitle><CardDescription>Apply to every supplier without its own switches.</CardDescription></CardHeader><CardContent><DefaultsForm value={defaults} canManage={manage} /></CardContent></Card>
      <Table data-testid="supplier-features">
        <THead><TR><TH>Supplier</TH>{FEATURES.map((f) => <TH key={f} className="text-center">{FEATURE_LABEL[f]}</TH>)}<TH /></TR></THead>
        <TBody>
          {suppliers.map((s) => (
            <TR key={s.id} data-testid="supplier-feature-row">
              <TD><div className="font-medium">{s.name}</div><div className="text-xs text-muted-foreground">{s.inHouse ? "FIRINGI in-house" : s.type === "DISTRIBUTOR" ? "Distributor" : "Wholesaler"} · {s.custom ? "own switches" : "defaults"}{s.pending ? ` · ${s.pending} request(s)` : ""}</div></TD>
              {FEATURES.map((f) => <TD key={f} className="text-center"><FeatureSwitch companyId={s.id} feature={f} on={s.features[FIELD[f]]} canManage={manage} label={`${FEATURE_LABEL[f]} — ${s.name}`} /></TD>)}
              <TD className="text-right">{manage && s.custom && <ResetFeatures companyId={s.id} />}</TD>
            </TR>
          ))}
        </TBody>
      </Table>
    </>
  );
}
