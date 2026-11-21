import type { Metadata } from "next";
import { getLocale } from "next-intl/server";
import { landingTexts } from "@/server/landing/service";
import { lookup } from "@/lib/landing";
import { AppLandingView } from "@/components/landing/app-view";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const src = await landingTexts(await getLocale());
  return { title: { absolute: lookup(src, "meta.title") }, description: lookup(src, "meta.description"), robots: { index: false } };
}

/** Phase 56: the landing page for anyone, also signed in (FIRINGI's preview). Not indexed; "/" is the real address. */
export default async function Page() {
  return <AppLandingView locale={await getLocale()} />;
}
