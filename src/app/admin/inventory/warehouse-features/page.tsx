import { can, pagePermission, pagePortal } from "@/server/rbac/guard";
import { supplierWarehouseFeatures, WAREHOUSE_FEATURES, WH_FIELD, WH_LABEL } from "@/server/warehouse/features";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { ResetWarehouse, WarehouseSwitch } from "@/components/warehouse/admin-controls";

export const metadata = { title: "Warehouse Features" };

export default async function WarehouseFeatures() {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.inventory.view", "admin.inventory.manage"]);
  const manage = can(ctx, "admin.inventory.manage");
  const suppliers = await supplierWarehouseFeatures(ctx);
  const off = suppliers.filter((s) => Object.values(s.features).some((v) => !v)).length;
  return (
    <>
      <PageHeader title="Warehouse Features" description="Switch pick & pack, shelves, lot traceability and the supplier's own recalls on or off for each supplier. Everything is on until you switch it off. Inside a supplier, who may use them is decided by the supplier's own team roles." />
      <Card className="mb-6">
        <CardContent className="space-y-1 pt-6 text-sm text-muted-foreground">
          <p>Switched off: the menu item disappears for that supplier and its pages and actions are refused. Data already recorded (pick lists, shelves, lots) is kept and comes back when switched on again.</p>
          <p>Never switched off: customers&apos; recall notices, recalls started by FIRINGI, and blocking of recalled stock. The scanner stays available while pick & pack or shelves is on.</p>
          <p className="font-medium text-foreground" data-testid="wh-features-summary">{off ? `${off} supplier(s) with something switched off.` : "Everything is on for every supplier."}</p>
        </CardContent>
      </Card>
      <Table data-testid="supplier-warehouse-features">
        <THead><TR><TH>Supplier</TH>{WAREHOUSE_FEATURES.map((f) => <TH key={f} className="text-center">{WH_LABEL[f]}</TH>)}<TH /></TR></THead>
        <TBody>
          {suppliers.map((s) => (
            <TR key={s.id} data-testid="supplier-warehouse-row">
              <TD><div className="font-medium">{s.name}</div><div className="text-xs text-muted-foreground">{s.inHouse ? "FIRINGI in-house" : s.type === "DISTRIBUTOR" ? "Distributor" : "Wholesaler"}{s.custom && Object.values(s.features).some((v) => !v) ? <Badge variant="warning" className="ml-2">limited</Badge> : null}</div></TD>
              {WAREHOUSE_FEATURES.map((f) => <TD key={f} className="text-center"><WarehouseSwitch companyId={s.id} feature={f} on={s.features[WH_FIELD[f]]} canManage={manage} label={`${WH_LABEL[f]} — ${s.name}`} /></TD>)}
              <TD className="text-right">{manage && s.custom && <ResetWarehouse companyId={s.id} />}</TD>
            </TR>
          ))}
        </TBody>
      </Table>
    </>
  );
}
