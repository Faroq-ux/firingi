import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getLocale } from "next-intl/server";
import { landingSettings, landingTexts } from "@/server/landing/service";
import { aboutPage } from "@/server/landing/careers";
import { lookup } from "@/lib/landing";
import { PlainPage } from "@/components/landing/plain";
import { LandingFooter } from "@/components/landing/view";

export const dynamic = "force-dynamic";
export async function generateMetadata(): Promise<Metadata> {
  return { title: lookup(await landingTexts(await getLocale()), "about.sustainability.title") };
}

/** Footer page (FIRINGI only): FIRINGI's sustainability — its own text per language, or the starting text. */
export default async function Page() {
  const locale = await getLocale();
  const p = await aboutPage("sustainability", locale);
  if (!p.on) notFound();
  const s = await landingSettings();
  const src = await landingTexts(locale, s);
  const t = (k: string, v?: Record<string, string | number>) => lookup(src, k).replace(/\{(\w+)\}/g, (_, x: string) => String(v?.[x] ?? `{${x}}`));
  return (
    <PlainPage locale={locale} langLabel={t("langPicker")} back={t("legal.back")} footer={<LandingFooter s={s} t={t} locale={locale} home={false} />}>
      <h1 className="fg-disp" data-testid="about-title">{t("about.sustainability.title")}</h1>
      <p className="meta">{t("about.sustainability.lead")}</p>
      <div className="body" data-testid="about-body">{p.text}</div>
    </PlainPage>
  );
}
