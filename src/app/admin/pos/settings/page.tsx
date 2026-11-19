import { Cog } from "lucide-react";
import { getLocale } from "next-intl/server";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { posSettings } from "@/server/pos/settings";
import { PosSettingsForm } from "@/components/pos/admin";

export const metadata = { title: "Till Settings" };
export const dynamic = "force-dynamic";

export default async function Page() {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.settings.manage"]);
  const [s, locale] = await Promise.all([posSettings(), getLocale()]);
  let dn: Intl.DisplayNames | null = null;
  try { dn = new Intl.DisplayNames([locale === "pt-PT" ? "en" : "en"], { type: "region" }); } catch { /* keep codes */ }
  const names = Object.fromEntries(Object.keys(s.countries).map((c) => [c, dn?.of(c) ?? c]));
  return (
    <>
      <PageHeader title="Till Settings" icon={Cog} description="The till (POS) for suppliers' counters and customers' own shops and restaurants: who gets it, which features, and how receipts work in each country." />
      <Card><CardContent className="pt-5"><PosSettingsForm initial={s} countryNames={names} /></CardContent></Card>
    </>
  );
}
