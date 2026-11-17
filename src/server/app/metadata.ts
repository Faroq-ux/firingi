/** Phase 39: what makes a portal installable — its manifest (in the person's language) and the iPhone settings. */
import type { Metadata } from "next";
import { getLocale } from "next-intl/server";
import { appSettings } from "@/server/app/service";
import type { AppPortal } from "@/lib/app";

export async function appMetadata(portal: AppPortal): Promise<Metadata> {
  const s = await appSettings();
  if (!s.portals[portal]) return {};
  const locale = await getLocale();
  return {
    manifest: `/manifest/${portal}?l=${encodeURIComponent(locale)}`,
    appleWebApp: { capable: true, title: "FIRINGI", statusBarStyle: "default" },
    icons: { apple: "/icons/apple-touch-icon.png" },
  };
}
