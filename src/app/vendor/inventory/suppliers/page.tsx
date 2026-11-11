import { getTranslations } from "next-intl/server";
import { can, pagePermission, pagePortal } from "@/server/rbac/guard";
import { listSuppliers } from "@/server/inventory/purchasing";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { SupplierEdit, SupplierForm } from "@/components/inventory/controls";

export const metadata = { title: "My suppliers" };

export default async function Suppliers() {
  const ctx = await pagePortal("vendor");
  pagePermission(ctx, ["vendor.purchasing.manage", "vendor.inventory.view", "vendor.inventory.manage"]);
  const t = await getTranslations("inventory");
  const rows = await listSuppliers(ctx, { all: true });
  const manage = can(ctx, "vendor.purchasing.manage");
  return (
    <>
      <PageHeader title={t("suppliers")} />
      <Table data-testid="suppliers-table">
        <THead><TR><TH>{t("name")}</TH><TH>{t("vat")}</TH><TH>{t("email")}</TH><TH>{t("phone")}</TH><TH className="text-right">{t("leadTime")}</TH><TH className="text-right">{t("orders")}</TH><TH /></TR></THead>
        <TBody>
          {rows.length === 0 && <TR><TD colSpan={7} className="py-6 text-center text-muted-foreground">{t("empty")}</TD></TR>}
          {rows.map((s) => (
            <TR key={s.id}>
              <TD className="font-medium">{s.name} {!s.isActive && <Badge variant="outline">{t("off")}</Badge>}</TD><TD>{s.vatNumber ?? ""}</TD><TD>{s.email ?? ""}</TD><TD>{s.phone ?? ""}</TD>
              <TD className="text-right tabular-nums">{s.leadTimeDays}</TD><TD className="text-right tabular-nums">{s._count.orders}</TD>
              <TD className="text-right">{manage && <SupplierEdit supplier={s} />}</TD>
            </TR>
          ))}
        </TBody>
      </Table>
      {manage && <Card className="mt-6"><CardHeader><CardTitle>{t("addSupplier")}</CardTitle></CardHeader><CardContent><SupplierForm /></CardContent></Card>}
    </>
  );
}
