import Link from "next/link";
import { can, pagePermission, pagePortal } from "@/server/rbac/guard";
import { listFiringiRules } from "@/server/services/delivery-rules";
import { pickLocalized } from "@/i18n/config";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyRow, TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { FiringiRuleForm, RemoveZoneRuleButton } from "@/components/orders/delivery-rule-forms";
import { formatDate, formatMoney } from "@/lib/utils";

export const metadata = { title: "Minimum Order Rules" };
const m = (v: unknown) => (v == null ? "—" : formatMoney(String(v)));

export default async function Page() {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.delivery.view", "admin.delivery.manage", "admin.pricing.view"]);
  const { current, zoneRules, zones, vendors, history } = await listFiringiRules(ctx);
  const edit = can(ctx, "admin.delivery.manage");
  const ruled = new Set(zoneRules.map((z) => z.zoneId));
  const freeZones = zones.filter((z) => !ruled.has(z.id)).map((z) => ({ id: z.id, label: `${z.country.flag} ${z.name}` }));
  const free = (r: { firingiFreeEnabled: boolean; firingiFreeFrom: unknown }) => (r.firingiFreeEnabled && r.firingiFreeFrom != null ? `free from ${m(r.firingiFreeFrom)}` : "free delivery off");
  return (
    <>
      <PageHeader
        title="Minimum Order & Delivery Fee"
        description={<>
          <b>Customer orders (wholesaler → customer):</b> the wholesaler delivers free once its own minimum is reached. Below it FIRINGI delivers: free from FIRINGI&apos;s free-delivery amount when switched on, otherwise at FIRINGI&apos;s flat rate. Below FIRINGI&apos;s minimum order, checkout is blocked. A delivery zone can have its own rule; it overrides the country there.{" "}
          <b>Wholesaler orders (distributor → wholesaler):</b> the distributor always delivers — free from its minimum (amount or units), below it at its own flat rate, which FIRINGI invoices and pays on.
        </>}
      />
      <div className="space-y-4">
        {current.map((r) => (
          <Card key={r.id} data-testid={`country-rule-${r.country.code}`}>
            <CardHeader><CardTitle>{r.country.flag} {pickLocalized(r.country.name, "en")}</CardTitle></CardHeader>
            <CardContent className="space-y-2 text-sm">
              <p>Minimum order <b>{m(r.minOrderValue)}</b> · flat rate <b>{m(r.firingiDeliveryFeeNet)}</b> (+ VAT {r.feeTaxCategory?.code.toLowerCase()}) · <b>{free(r)}</b> · since {formatDate(r.validFrom)}</p>
              {edit && <FiringiRuleForm countryCode={r.country.code} min={r.minOrderValue!.toString()} fee={r.firingiDeliveryFeeNet!.toString()} freeEnabled={r.firingiFreeEnabled} freeFrom={r.firingiFreeFrom?.toString() ?? null} />}
            </CardContent>
          </Card>
        ))}
        <Card>
          <CardHeader><CardTitle>Delivery zones with their own rule</CardTitle></CardHeader>
          <CardContent className="space-y-3 text-sm">
            <Table data-testid="zone-rules">
              <THead><TR><TH>Zone</TH><TH className="text-right">Minimum</TH><TH className="text-right">Flat rate</TH><TH>FIRINGI free delivery</TH><TH>Since</TH>{edit && <TH />}</TR></THead>
              <TBody>
                {zoneRules.map((z) => (
                  <TR key={z.id}>
                    <TD>{z.country.flag} {z.zone?.name}</TD>
                    <TD className="text-right tabular-nums">{m(z.minOrderValue)}</TD>
                    <TD className="text-right tabular-nums">{m(z.firingiDeliveryFeeNet)}</TD>
                    <TD>{free(z)}</TD>
                    <TD className="text-xs text-muted-foreground">{formatDate(z.validFrom)}</TD>
                    {edit && <TD><RemoveZoneRuleButton zoneId={z.zoneId!} /></TD>}
                  </TR>
                ))}
                {!zoneRules.length && <EmptyRow colSpan={edit ? 6 : 5}>No zone rules — the country rule applies everywhere.</EmptyRow>}
              </TBody>
            </Table>
            {edit && (freeZones.length
              ? <FiringiRuleForm zones={freeZones} min={current[0]?.minOrderValue?.toString() ?? "0"} fee={current[0]?.firingiDeliveryFeeNet?.toString() ?? "0"} freeEnabled={false} freeFrom={null} />
              : <p className="text-xs text-muted-foreground">Create delivery zones under <Link className="text-primary hover:underline" href="/admin/delivery/zones">Delivery Zones</Link> to give them their own rule.</p>)}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Supplier delivery rules</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <THead><TR><TH>Supplier</TH><TH>Type</TH><TH className="text-right">Free delivery from</TH><TH className="text-right">Flat rate below</TH><TH>Since</TH></TR></THead>
              <TBody>
                {vendors.map((v) => (
                  <TR key={v.id}>
                    <TD><Link href={`/admin/companies/${v.vendor!.id}`} className="text-primary hover:underline">{v.country.flag} {v.vendor!.legalName}</Link></TD>
                    <TD>{v.vendor!.type.toLowerCase()}</TD>
                    <TD className="text-right tabular-nums">{v.vendorMinimumKind === "UNITS" ? `${v.vendorMinimumUnits} units` : m(v.vendorDeliveryMinimum)}</TD>
                    <TD className="text-right tabular-nums">{v.vendor!.type === "DISTRIBUTOR" ? m(v.vendorFlatFeeNet) : "FIRINGI"}</TD>
                    <TD className="text-xs text-muted-foreground">{formatDate(v.validFrom)}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
            <p className="mt-2 text-xs text-muted-foreground">Wholesalers without a minimum never deliver themselves — FIRINGI delivers their orders. Distributors without a rule deliver every order free.</p>
          </CardContent>
        </Card>
        {history.length > 0 && (
          <Card>
            <CardHeader><CardTitle>Previous FIRINGI rules</CardTitle></CardHeader>
            <CardContent className="text-sm">{history.map((h) => <div key={h.id}>{h.zone ? `${h.country.code} · ${h.zone.name}` : h.country.code}: min {m(h.minOrderValue)}, flat rate {m(h.firingiDeliveryFeeNet)}, {free(h)} · {formatDate(h.validFrom)} → {formatDate(h.validTo)}</div>)}</CardContent>
          </Card>
        )}
      </div>
    </>
  );
}
