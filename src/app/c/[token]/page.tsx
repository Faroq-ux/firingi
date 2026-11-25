/**
 * A FIRINGI marketing catalogue, public (no sign-in): the cover texts, the products by section (photo, name, pack,
 * barcode, minimum order, price — as FIRINGI chose), each opening in the shop, and the PDF to download.
 * Shown in the catalogue's own language. FIRINGI's own uploaded PDF is shown as a download.
 */
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Download, LogIn, Package, UserPlus } from "lucide-react";
import { catalogueEntries, publicCatalogue } from "@/server/marketing/catalogues";
import { mergeOptions, type McOptions } from "@/lib/marketing-catalogue";
import { Wordmark } from "@/components/brand/wordmark";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ token: string }> }): Promise<Metadata> {
  const c = await publicCatalogue((await params).token, false).catch(() => null);
  return c ? { title: { absolute: `${c.title} · FIRINGI` }, description: c.subtitle ?? c.intro ?? undefined, robots: { index: false } } : { title: "FIRINGI", robots: { index: false } };
}

export default async function PublicCataloguePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const c = await publicCatalogue(token);
  if (!c) notFound();
  const [t, entries] = await Promise.all([getTranslations({ locale: c.locale, namespace: "mktCatalogue" }), c.uploadKey ? Promise.resolve([]) : catalogueEntries(c)]);
  const o = mergeOptions(c.options as McOptions);
  const nf = new Intl.NumberFormat(c.locale, { style: "currency", currency: "EUR" });
  const price = (net: string | null, gross: string | null) => o.price === "GROSS" ? (gross ? t("priceGross", { price: nf.format(Number(gross)) }) : null) : o.price === "NET" && net ? t("priceNet", { price: nf.format(Number(net)) }) : null;
  return (
    <main lang={c.locale} className="min-h-screen bg-background text-foreground" data-testid="public-catalogue">
      <header className="border-b bg-card">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-4">
          <Wordmark className="h-8" />
          <div className="flex flex-wrap gap-2 text-sm">
            <a href={`/c/${token}/pdf`} className="inline-flex items-center gap-1.5 rounded-md border px-3 py-2 font-medium hover:bg-accent" data-testid="pc-download"><Download className="size-4" /> {t("download")}</a>
            <Link href="/login?next=/buy/catalogue/browse" className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 font-medium text-primary-foreground hover:opacity-90"><LogIn className="size-4" /> {t("order")}</Link>
          </div>
        </div>
      </header>
      <section className="mx-auto max-w-6xl px-4 py-8">
        <h1 className="text-3xl font-bold tracking-tight sm:text-4xl" data-testid="pc-title">{c.title}</h1>
        {c.subtitle && <p className="mt-2 text-lg text-muted-foreground">{c.subtitle}</p>}
        {c.intro && <p className="mt-4 max-w-3xl whitespace-pre-line">{c.intro}</p>}
        {!c.uploadKey && <p className="mt-3 text-sm text-muted-foreground">{t("products", { n: entries.length })}{o.price !== "NONE" ? ` · ${t(o.price === "GROSS" ? "pricesNoteGross" : "pricesNoteNet")}` : ""}</p>}
      </section>
      {!c.uploadKey && (
        <section className="mx-auto max-w-6xl px-4 pb-16">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {entries.map((e) => (
              <div key={e.offerId} className="contents">
                {e.section && <h2 className="col-span-full mt-4 border-b-2 border-[#FFC800] pb-1 text-lg font-bold text-[#E10600]">{e.section}</h2>}
                <Link href={`/buy/catalogue/offers/${e.offerId}`} className="flex min-w-0 flex-col rounded-xl border bg-card p-3 transition hover:shadow-md" data-testid="pc-item">
                  <div className="mb-2 flex aspect-square items-center justify-center overflow-hidden rounded-lg bg-muted">
                    {e.imageKey
                      ? <img src={`/api/c/${token}/img/${e.productId}`} alt="" className="size-full object-contain" loading="lazy" />
                      : <Package className="size-10 text-muted-foreground" aria-hidden />}
                  </div>
                  <div className="break-words font-semibold leading-tight">{e.name}</div>
                  {e.brand && <div className="text-xs text-muted-foreground">{e.brand}</div>}
                  {o.qty && <div className="text-xs">{e.pack}{e.minQty > 1 ? ` · ${t("minOrder", { qty: e.minQty })}` : ""}</div>}
                  {e.supplier && <div className="text-xs text-muted-foreground">{t("soldBy", { name: e.supplier })}</div>}
                  {e.gtin && <div className="font-mono text-[11px] text-muted-foreground">{t("barcode", { code: e.gtin })}</div>}
                  {price(e.priceNet, e.priceGross) && <div className="mt-auto pt-2 font-bold text-[#E10600]" data-testid="pc-price">{price(e.priceNet, e.priceGross)}</div>}
                </Link>
              </div>
            ))}
          </div>
        </section>
      )}
      <footer className="border-t py-6 text-center text-sm text-muted-foreground">
        <Link href="/register" className="inline-flex items-center gap-1.5 hover:text-primary"><UserPlus className="size-4" /> {t("register")}</Link>
      </footer>
    </main>
  );
}
