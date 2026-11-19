import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { SpecialSettingsForm } from "@/components/admin/special-goods";
import { specialCategoryOptions, specialSettings } from "@/server/special/service";
import { ShieldCheck } from "lucide-react";

export const metadata = { title: "Special Goods" };
export const dynamic = "force-dynamic";

export default async function Page() {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.settings.manage"]);
  const [s, cats] = await Promise.all([specialSettings(), specialCategoryOptions(ctx)]);
  return (
    <>
      <PageHeader title="Special Goods" icon={ShieldCheck} description="Tobacco, alcohol, vaping — and any catalogue category you add — are only shown to and sold to businesses that said they sell them and have a matching activity code (CAE in Portugal; the first digits are the EU&apos;s NACE, the same in every country). Licences and approvals still apply on top." />
      <Card><CardHeader><CardTitle>Rules</CardTitle><CardDescription>A buyer&apos;s main and secondary activity codes are checked against the prefixes. Per-company exceptions are on each company page.</CardDescription></CardHeader>
        <CardContent><SpecialSettingsForm initial={s} categories={cats} /></CardContent></Card>
    </>
  );
}
