import Link from "next/link";
import { Coins } from "lucide-react";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { listCurrencies } from "@/server/data/geo";
import { currencySettings, localCountries } from "@/server/currency/service";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { CurrencySettingsForm } from "@/components/currency/admin";

export const metadata = { title: "Currencies" };
export const dynamic = "force-dynamic";

export default async function CurrencyPage() {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.international.view", "admin.international.manage", "admin.settings.view"]);
  const [rows, s, countries] = await Promise.all([listCurrencies(ctx), currencySettings(), localCountries()]);
  const on = new Set<string>(countries.filter((c) => s.enabled && s.countries[c.code]).map((c) => c.currency));
  return (
    <>
      <PageHeader title="Currencies" icon={Coins} description="FIRINGI's books are in EUR. Customers in the countries switched on here see, order, get invoices and pay in their own currency (rate locked when they order); suppliers there price and are paid in theirs. Every part is a switch."
        actions={<span className="flex flex-wrap gap-2 text-sm"><Link className="text-primary hover:underline" href="/admin/international/exchange-rates">Exchange rates</Link><Link className="text-primary hover:underline" href="/admin/international/currency/alerts">Rate alerts</Link><Link className="text-primary hover:underline" href="/admin/finance/fx">Gains & losses</Link></span>} />
      <Card className="mb-4"><CardContent className="pt-5"><CurrencySettingsForm initial={s} countries={countries} /></CardContent></Card>
      <Card>
        <CardHeader><CardTitle>Currencies</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <THead><TR><TH>Code</TH><TH>Name</TH><TH>Symbol</TH><TH>Decimals</TH><TH>Used by</TH><TH>Billing</TH></TR></THead>
            <TBody>
              {rows.map((c) => (
                <TR key={c.code}>
                  <TD className="font-medium">{c.code} {c.code === "EUR" && <Badge className="ml-1">Books</Badge>}</TD>
                  <TD>{c.name}</TD><TD>{c.symbol}</TD><TD>{c.decimals}</TD>
                  <TD className="text-muted-foreground">{c._count.countries} countries</TD>
                  <TD>{c.code === "EUR" ? <Badge variant="secondary">default</Badge> : on.has(c.code) ? <Badge variant="success" data-testid={`ccy-on-${c.code}`}>on</Badge> : <span className="text-xs text-muted-foreground">off</span>}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </CardContent>
      </Card>
    </>
  );
}
