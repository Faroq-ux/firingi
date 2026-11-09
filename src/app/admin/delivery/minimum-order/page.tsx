import Link from "next/link";
import { can, pagePermission, pagePortal } from "@/server/rbac/guard";
import { listFiringiRules } from "@/server/services/delivery-rules";
import { pickLocalized } from "@/i18n/config";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { FiringiRuleForm } from "@/components/orders/delivery-rule-forms";
import { formatDate, formatMoney } from "@/lib/utils";

export const metadata = { title: "Minimum Order Rules" };

export default async function Page() {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.delivery.view", "admin.delivery.manage", "admin.pricing.view"]);
  const { current, vendors, history } = await listFiringiRules(ctx);
  const edit = can(ctx, "admin.delivery.manage");
  return (
    <>
      <PageHeader
        title="Minimum Order & Delivery Fee"
        description="If an order reaches the supplier's own delivery minimum, the supplier delivers. Otherwise FIRINGI delivers — only if FIRINGI's minimum below is reached — and charges the fee. Below both, checkout is blocked."
      />
      <div className="space-y-4">
        {current.map((r) => (
          <Card key={r.id}>
            <CardHeader><CardTitle>{r.country.flag} {pickLocalized(r.country.name, "en")}</CardTitle></CardHeader>
            <CardContent className="space-y-2 text-sm">
              <p>FIRINGI minimum: <b>{formatMoney(r.minOrderValue!.toString())}</b> · fee <b>{formatMoney(r.firingiDeliveryFeeNet!.toString())}</b> (+ VAT {r.feeTaxCategory?.code.toLowerCase()}) · since {formatDate(r.validFrom)}</p>
              {edit && <FiringiRuleForm countryCode={r.country.code} min={r.minOrderValue!.toString()} fee={r.firingiDeliveryFeeNet!.toString()} />}
            </CardContent>
          </Card>
        ))}
        <Card>
          <CardHeader><CardTitle>Supplier delivery minimums</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <THead><TR><TH>Supplier</TH><TH>Type</TH><TH className="text-right">Delivers itself from</TH><TH>Since</TH></TR></THead>
              <TBody>
                {vendors.map((v) => (
                  <TR key={v.id}>
                    <TD><Link href={`/admin/companies/${v.vendor!.id}`} className="text-primary hover:underline">{v.country.flag} {v.vendor!.legalName}</Link></TD>
                    <TD>{v.vendor!.type.toLowerCase()}</TD>
                    <TD className="text-right tabular-nums">{formatMoney(v.vendorDeliveryMinimum!.toString())}</TD>
                    <TD className="text-xs text-muted-foreground">{formatDate(v.validFrom)}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
            <p className="mt-2 text-xs text-muted-foreground">Suppliers without a minimum never deliver themselves — FIRINGI delivers their orders.</p>
          </CardContent>
        </Card>
        {history.length > 0 && (
          <Card>
            <CardHeader><CardTitle>Previous FIRINGI rules</CardTitle></CardHeader>
            <CardContent className="text-sm">{history.map((h) => <div key={h.id}>{h.country.code}: min {formatMoney(h.minOrderValue!.toString())}, fee {formatMoney(h.firingiDeliveryFeeNet!.toString())} · {formatDate(h.validFrom)} → {formatDate(h.validTo)}</div>)}</CardContent>
          </Card>
        )}
      </div>
    </>
  );
}
