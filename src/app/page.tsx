import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getLocale } from "next-intl/server";
import { getContext, getSessionUser } from "@/server/context";
import { homeFor } from "@/server/rbac/guard";
import { landingSettings, landingTexts } from "@/server/landing/service";
import { lookup } from "@/lib/landing";
import { AppLandingView } from "@/components/landing/app-view";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const src = await landingTexts(await getLocale());
  return { title: { absolute: lookup(src, "meta.title") }, description: lookup(src, "meta.description"), openGraph: { title: lookup(src, "meta.title"), description: lookup(src, "meta.description"), type: "website" } };
}

/** Entry point: signed-in users go to their portal; visitors see the landing page (Phase 56) unless FIRINGI switched it off. */
export default async function Home() {
  const ctx = await getContext();
  if (ctx) redirect(homeFor(ctx));
  if (await getSessionUser()) redirect("/no-access");
  if (!(await landingSettings()).enabled) redirect("/login");
  return <AppLandingView locale={await getLocale()} />;
}
