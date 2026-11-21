import { getLocale } from "next-intl/server";
import { unsubscribeNewsletter, landingTexts } from "@/server/landing/service";
import { lookup } from "@/lib/landing";
import { PlainPage } from "@/components/landing/plain";

export const dynamic = "force-dynamic";
export const metadata = { title: "Newsletter", robots: { index: false } };

/** Phase 56: the unsubscribe link from the newsletter e-mail. */
export default async function Page({ searchParams }: { searchParams: Promise<{ t?: string }> }) {
  const { t: token } = await searchParams;
  const r = token ? await unsubscribeNewsletter(token) : null;
  const locale = r?.locale ?? (await getLocale());
  const src = await landingTexts(locale);
  const t = (k: string) => lookup(src, k);
  return (
    <PlainPage locale={locale} langLabel={t("langPicker")} back={t("news.back")}>
      <h1 className="fg-disp" data-testid="news-result">{r ? t("news.unsubTitle") : t("news.invalid")}</h1>
      {r && <p className="body">{t("news.unsubBody")}</p>}
    </PlainPage>
  );
}
