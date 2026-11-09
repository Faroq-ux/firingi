import Link from "next/link";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { deliveryOrder } from "@/server/allocation/delivery-order";
import { NotFoundError } from "@/server/errors";
import { pickLocalized } from "@/i18n/config";
import { PrintButton } from "@/components/orders/print-button";
import { formatDate, formatMoney } from "@/lib/utils";

export async function generateMetadata() {
  return { title: (await getTranslations("deliveryOrder"))("title") };
}

/** Printable Delivery Order from FIRINGI to the supplier (supplier prices only). */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await pagePortal("vendor");
  pagePermission(ctx, ["vendor.orders.view", "vendor.orders.manage"]);
  const { id } = await params;
  const d = await deliveryOrder(ctx, id).catch((e) => { if (e instanceof NotFoundError) notFound(); throw e; });
  const [t, o, locale] = await Promise.all([getTranslations("deliveryOrder"), getTranslations("orders"), getLocale()]);
  const L = (v: unknown) => pickLocalized(v, locale);
  const a = d.deliverTo;
  return (
    <div className="mx-auto max-w-4xl" data-testid="delivery-order">
      <div className="mb-4 flex items-center justify-between print:hidden">
        <Link href={`/vendor/orders/${id}`} className="text-sm text-primary hover:underline">← {o("order")} {d.number}</Link>
        <PrintButton label={t("print")} />
      </div>
      <article className="rounded-xl border bg-card p-6 print:border-0 print:p-0">
        <header className="flex flex-wrap items-start justify-between gap-4 border-b pb-4">
          <div>
            <div className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">FIRINGI</div>
            <h1 className="text-2xl font-semibold">{t("title")} {d.number}</h1>
            <p className="text-sm text-muted-foreground">{formatDate(d.placedAt, locale, true)}{d.requestedDeliveryDate && ` · ${t("requested")}: ${formatDate(d.requestedDeliveryDate, locale)}`}</p>
            {!d.confirmed && <p className="mt-1 text-sm text-warning">{t("notConfirmed")}</p>}
          </div>
          <div className="text-right text-sm">
            <div className="text-muted-foreground">{t("supplier")}</div>
            <div className="font-medium">{d.supplier.legalName}</div>
          </div>
        </header>
        <p className="my-4 rounded-md bg-muted p-3 text-sm">{t("instructions")}</p>
        <div className="grid gap-4 sm:grid-cols-2">
          <section>
            <h2 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t("deliverTo")}</h2>
            <div className="text-sm">
              <div className="font-medium">{d.customer.name}</div>
              <div>{a.label}</div><div>{a.line1}</div>{a.line2 && <div>{a.line2}</div>}<div>{a.postalCode} {a.city}</div>
              {(d.customer.contact || d.customer.phone) && <div className="mt-1 text-muted-foreground">{t("contact")}: {[d.customer.contact, d.customer.phone].filter(Boolean).join(" · ")}</div>}
            </div>
          </section>
          <section>
            <h2 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t("invoiceTo")}</h2>
            {d.invoiceTo ? (
              <div className="text-sm"><div className="font-medium">{d.invoiceTo.legalName}</div><div>{d.invoiceTo.vatNumber}</div><div>{d.invoiceTo.address}</div><div className="text-muted-foreground">{d.invoiceTo.email}</div></div>
            ) : <div className="text-sm">FIRINGI</div>}
            <div className="mt-2 text-sm"><span className="text-muted-foreground">{t("delivery")}: </span>{d.deliveryMode === "FIRINGI_FLEET" ? t("byFiringi") : d.deliveryMode === "CARRIER" ? t("byCarrier") : t("byYou")}</div>
          </section>
        </div>
        <table className="mt-6 w-full text-sm">
          <thead><tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
            <th className="py-2">{o("product")}</th><th className="py-2 text-right">{t("qty")}</th><th className="py-2 text-right">{t("unitPrice")}</th><th className="py-2 text-right">{t("lineTotal")}</th>
          </tr></thead>
          <tbody>
            {d.lines.map((l) => (
              <tr key={l.id} className="border-b">
                <td className="py-2"><div className="font-medium">{L(l.name)}</div><div className="text-xs text-muted-foreground">{L(l.packaging)} · SKU {l.sku}</div></td>
                <td className="py-2 text-right tabular-nums">{l.qty}</td>
                <td className="py-2 text-right tabular-nums">{formatMoney(l.unitNet, locale)}</td>
                <td className="py-2 text-right tabular-nums">{formatMoney(l.lineNet, locale)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot><tr><td colSpan={3} className="pt-3 text-right font-semibold">{t("total")}</td><td className="pt-3 text-right font-semibold tabular-nums" data-testid="do-total">{formatMoney(d.totalNet, locale)}</td></tr></tfoot>
        </table>
        {d.notes && <p className="mt-4 text-sm"><span className="text-muted-foreground">{t("notes")}: </span>{d.notes}</p>}
      </article>
    </div>
  );
}
