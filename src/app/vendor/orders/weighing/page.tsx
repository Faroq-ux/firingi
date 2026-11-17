import Link from "next/link";
import { Scale } from "lucide-react";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { vendorReport } from "@/server/catchweight/service";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cwLabels } from "@/components/catchweight/labels";

export const metadata = { title: "Weighing" };
export const dynamic = "force-dynamic";

export default async function VendorWeighingPage() {
  const ctx = await pagePortal("vendor");
  pagePermission(ctx, ["vendor.orders.view", "vendor.orders.manage"]);
  const { l, locale } = await cwLabels();
  const v = await vendorReport(ctx, locale);
  const kg = (n: number) => new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(n);
  const pct = (a: number, b: number) => (b > 0 ? `${a >= b ? "+" : ""}${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(((a - b) / b) * 100)} %` : "—");
  const day = (d: Date | null) => (d ? new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(d) : "—");
  return (
    <>
      <PageHeader title={l.weighingTitle} icon={Scale} description={l.weighingIntro} />
      <Card className="mb-6">
        <CardHeader><CardTitle>{l.toWeighTitle}</CardTitle></CardHeader>
        <CardContent>
          {!v.toWeigh.length ? <p className="py-4 text-center text-sm text-muted-foreground">{l.noneToWeigh}</p> : (
            <ul className="divide-y" data-testid="to-weigh">
              {v.toWeigh.map((t) => (
                <li key={t.id} className="flex flex-wrap items-center gap-2 py-2 text-sm">
                  <Link href={`/vendor/orders/${t.orderId}`} className="font-mono text-xs text-primary hover:underline">{t.number}</Link>
                  <span className="min-w-0 flex-1 basis-48 break-words">{t.product} · {t.units} · ≈ {kg(t.estimatedKg)} kg</span>
                  <span className="text-xs text-muted-foreground">{l["col.date"]}: {day(t.date)}</span>
                  <Link href={`/vendor/orders/${t.orderId}#weights`} className="text-sm text-primary hover:underline">{l.openOrder}</Link>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>{l.reportTitle}</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto">
          {!v.products.length ? <p className="py-4 text-center text-sm text-muted-foreground">{l.noReport}</p> : (
            <table className="w-full min-w-[560px] text-sm" data-testid="cw-report">
              <thead><tr className="text-left text-xs text-muted-foreground"><th className="py-2">{l["col.product"]}</th><th>{l["col.lines"]}</th><th>{l["col.estimated"]}</th><th>{l["col.weighed"]}</th><th>{l["col.billed"]}</th><th>{l["col.variance"]}</th><th>{l["col.capped"]}</th></tr></thead>
              <tbody className="divide-y">
                {v.products.map((p) => (
                  <tr key={p.offerId}><td className="py-2">{p.name}</td><td className="tabular-nums">{p.lines}</td><td className="tabular-nums">{kg(p.estKg)}</td><td className="tabular-nums">{kg(p.actualKg)}</td><td className="tabular-nums">{kg(p.billedKg)}</td><td className="tabular-nums">{pct(p.actualKg, p.estKg)}</td><td className="tabular-nums">{p.capped}</td></tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </>
  );
}
