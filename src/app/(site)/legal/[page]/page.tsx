import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getLocale } from "next-intl/server";
import { landingTexts, legalPage } from "@/server/landing/service";
import { LEGAL_PAGES, lookup, type LegalPage } from "@/lib/landing";
import { PlainPage } from "@/components/landing/plain";

export const dynamic = "force-dynamic";
const PAGES = [...LEGAL_PAGES, "company"] as const;

export async function generateMetadata({ params }: { params: Promise<{ page: string }> }): Promise<Metadata> {
  const { page } = await params;
  if (!(PAGES as readonly string[]).includes(page)) return {};
  return { title: lookup(await landingTexts(await getLocale()), `legal.${page}`) };
}

/** Phase 56: terms, privacy, cookies (FIRINGI's text per language, English when missing) and company details (from the settings). */
export default async function Page({ params }: { params: Promise<{ page: string }> }) {
  const { page } = await params;
  if (!(PAGES as readonly string[]).includes(page)) notFound();
  const locale = await getLocale();
  const src = await landingTexts(locale);
  const t = (k: string) => lookup(src, k);
  const legal = await legalPage(page === "company" ? "terms" : (page as LegalPage), locale);
  const fmt = (d: string) => new Intl.DateTimeFormat(locale, { dateStyle: "long" }).format(new Date(d));
  return (
    <PlainPage locale={locale} langLabel={t("langPicker")} back={t("legal.back")}>
      <h1 className="fg-disp" data-testid="legal-title">{t(`legal.${page}`)}</h1>
      {page === "company" ? (
        <div className="body" data-testid="legal-company">
          {[legal.company.legalName || "FIRINGI", legal.company.nif && `NIF ${legal.company.nif}`, legal.company.address, legal.email, legal.phone].filter(Boolean).join("\n")}
        </div>
      ) : (
        <>
          {legal.updated && legal.text && <p className="meta">{t("legal.updated").replace("{date}", fmt(legal.updated))}</p>}
          <div className="body" data-testid="legal-body">{legal.text || t("legal.empty")}</div>
        </>
      )}
    </PlainPage>
  );
}
