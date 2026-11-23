import Link from "next/link";
import { notFound } from "next/navigation";
import { Truck } from "lucide-react";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { loadDetail } from "@/server/vansales/service";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { LoadButtons, LoadGoods, RemoveGoods, UnloadForm } from "@/components/vansales/client";
import { LoadBadge, MethodBadge, SaleBadge, Tiles } from "@/components/vansales/views";
import { fill, vsLabels } from "@/components/vansales/labels";
import { formatMoney } from "@/lib/utils";

export const metadata = { title: "Van load" };
export const dynamic = "force-dynamic";

export default async function VanLoadPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await pagePortal("vendor");
  pagePermission(ctx, "vendor.vansales.manage");
  const { id } = await params;
  const [{ l, locale }, v] = await Promise.all([vsLabels(), loadDetail(ctx, id).catch(() => null)]);
  if (!v) notFound();
  const m = (n: number) => formatMoney(n, locale);
  const d = (s: string | null) => (s ? new Date(s).toLocaleString(locale, { dateStyle: "short", timeStyle: "short" }) : "—");
  return (
    <>
      <PageHeader title={fill(l.yourVan, { number: v.number })} description={`${v.seller} · ${v.warehouse}${v.vehicle ? ` · ${v.vehicle}` : ""}`} icon={Truck}
        actions={<div className="flex items-center gap-2"><LoadBadge l={l} status={v.status} /><Link href="/vendor/van" className="text-sm underline-offset-2 hover:underline">{l.loads}</Link></div>} />
      <Tiles items={[
        { label: l.started, value: d(v.loadedAt) },
        { label: l.total, value: m(v.gross), testid: "vl-gross" },
        { label: l.cashExpected, value: m(v.cashExpected), testid: "vl-expected" },
        { label: l.variance, value: v.cashVariance == null ? "—" : m(v.cashVariance), testid: "vl-final-variance" },
      ]} />
      <Card className="mb-6">
        <CardHeader><CardTitle>{l.goods}</CardTitle>{v.status === "OPEN" && <CardDescription>{l.addGoodsHint}</CardDescription>}</CardHeader>
        <CardContent className="space-y-4">
          {!v.products.length ? <p className="text-sm text-muted-foreground">{l.noGoods}</p> : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-sm" data-testid="vl-goods">
                <thead><tr className="border-b text-left text-xs text-muted-foreground"><th className="py-2 pr-2">{l.product}</th><th className="px-2 text-right">{l.loaded}</th><th className="px-2 text-right">{l.sold}</th><th className="px-2 text-right">{l.back}</th><th className="px-2 text-right">{l.missing}</th><th className="px-2 text-right">{l.left}</th><th className="px-2">{l.nextExpiry}</th>{v.status === "OPEN" && <th />}</tr></thead>
                <tbody>
                  {v.products.map((p) => (
                    <tr key={p.offerId} className="border-b last:border-0" data-testid="vl-good" data-offer={p.offerId}>
                      <td className="py-2 pr-2"><span className="break-words">{p.name}</span> <span className="text-xs text-muted-foreground">· {p.packaging}</span></td>
                      <td className="px-2 text-right tabular-nums">{p.loaded}</td><td className="px-2 text-right tabular-nums" data-testid="vl-good-sold">{p.sold}</td><td className="px-2 text-right tabular-nums">{p.back}</td>
                      <td className={`px-2 text-right tabular-nums ${p.lost ? "text-destructive" : ""}`}>{p.lost}</td><td className="px-2 text-right font-medium tabular-nums" data-testid="vl-good-left">{p.left}</td>
                      <td className="px-2 text-xs">{p.nextExpiry ?? "—"}{p.left > p.sellable && <Badge variant="destructive" className="ml-1">{l.recalled}</Badge>}</td>
                      {v.status === "OPEN" && <td className="text-right"><RemoveGoods l={l} loadId={v.id} offerId={p.offerId} /></td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {(v.status === "OPEN" || v.status === "ON_ROAD") && (
            <div className="space-y-2 border-t pt-4">
              <p className="font-medium">{l.addGoods}</p>
              <LoadGoods l={l} loadId={v.id} />
            </div>
          )}
          {v.status === "OPEN" && <div className="space-y-1 border-t pt-4"><LoadButtons l={l} loadId={v.id} /><p className="text-xs text-muted-foreground">{l.startHint}</p></div>}
        </CardContent>
      </Card>
      <Card className="mb-6">
        <CardHeader>
          <CardTitle>{l.salesTitle}</CardTitle>
          <CardDescription className="flex flex-wrap gap-2">{Object.entries(v.byMethod).filter(([, n]) => n > 0).map(([k, n]) => <span key={k}>{l[`method.${k}`] ?? k}: {m(n)}</span>)}</CardDescription>
        </CardHeader>
        <CardContent>
          {!v.sales.length ? <p className="text-sm text-muted-foreground">{l.noSales}</p> : (
            <ul className="divide-y" data-testid="vl-sales">
              {v.sales.map((s) => (
                <li key={s.id} className="flex flex-wrap items-center gap-2 py-3 text-sm" data-testid="vl-sale" data-number={s.number}>
                  <span className="font-medium">{s.number}</span><SaleBadge l={l} status={s.status} /><MethodBadge l={l} method={s.method} />
                  <span className="min-w-0 flex-1 basis-40 break-words">{s.customer}</span>
                  <span className="tabular-nums">{m(s.gross)}</span>
                  {s.orderId && <Link href={`/vendor/orders/${s.orderId}`} className="underline-offset-2 hover:underline">{s.orderNumber}</Link>}
                  {s.invoiceNumber && <span className="text-xs text-muted-foreground">{s.invoiceNumber}</span>}
                  {s.hasSignature && <a href={`/api/vansales/sales/${s.id}/signature`} target="_blank" rel="noreferrer" className="text-xs underline-offset-2 hover:underline">{l.signature}</a>}
                  <span className="text-xs text-muted-foreground">{d(s.soldAt)}</span>
                  {s.error && <p className="w-full text-xs text-destructive">{fill(l.failed, { error: s.error })}</p>}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
      {v.status === "ON_ROAD" && (
        <Card>
          <CardHeader><CardTitle>{l.unload}</CardTitle></CardHeader>
          <CardContent><UnloadForm key={`${v.cashExpected}-${v.products.map((p) => p.left).join(".")}`} l={l} locale={locale} loadId={v.id} cashExpected={v.cashExpected} products={v.products.filter((p) => p.left > 0).map((p) => ({ offerId: p.offerId, name: p.name, packaging: p.packaging, left: p.left }))} /></CardContent>
        </Card>
      )}
      {v.status === "CLOSED" && (
        <Card>
          <CardHeader><CardTitle>{l.unloadedAt} · {d(v.closedAt)}</CardTitle></CardHeader>
          <CardContent>
            <dl className="grid grid-cols-3 gap-4 text-sm">
              <div><dt className="text-xs text-muted-foreground">{l.cashExpected}</dt><dd className="tabular-nums">{m(v.cashExpected)}</dd></div>
              <div><dt className="text-xs text-muted-foreground">{l.cashCounted}</dt><dd className="tabular-nums">{v.cashCounted == null ? "—" : m(v.cashCounted)}</dd></div>
              <div><dt className="text-xs text-muted-foreground">{l.variance}</dt><dd className={`tabular-nums ${(v.cashVariance ?? 0) < 0 ? "text-destructive" : ""}`}>{v.cashVariance == null ? "—" : m(v.cashVariance)}</dd></div>
            </dl>
            {v.closeNote && <p className="mt-3 text-sm text-muted-foreground">{v.closeNote}</p>}
          </CardContent>
        </Card>
      )}
    </>
  );
}
