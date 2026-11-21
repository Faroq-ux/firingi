import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { getLocale } from "next-intl/server";
import { landingSettings, landingTexts } from "@/server/landing/service";
import { lookup } from "@/lib/landing";
import { SellLandingView } from "@/components/landing/app-view";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const src = await landingTexts(await getLocale());
  return { title: { absolute: lookup(src, "sellPage.title") }, description: lookup(src, "sellPage.description"), openGraph: { title: lookup(src, "sellPage.title"), description: lookup(src, "sellPage.description"), type: "website" } };
}

/** Phase 56: "Sell on FIRINGI" — the vendors' page, linked only from the landing page's menu and footer. */
export default async function Page() {
  const s = await landingSettings();
  if (!s.enabled) redirect("/login");
  if (!s.sections.vendors) notFound();
  return <SellLandingView locale={await getLocale()} />;
}
