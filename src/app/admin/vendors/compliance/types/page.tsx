import { BadgeCheck, ListChecks } from "lucide-react";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { canManageCompliance, listTypes, typeFormOptions } from "@/server/compliance/service";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { TypeBadgeSwitch, TypeForm } from "@/components/compliance/admin";
import { EMPTY_TYPE } from "@/lib/compliance";

export const metadata = { title: "Certificate Types & Badges" };

export default async function CertificateTypes() {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.vendors.view", "admin.vendors.approve", "admin.risk.view", "admin.risk.manage"]);
  const manage = canManageCompliance(ctx);
  const [types, opts] = await Promise.all([listTypes(ctx), typeFormOptions(ctx)]);
  const country = new Map(opts.countries.map((c) => [c.id, c.label]));
  const category = new Map(opts.categories.map((c) => [c.id, c.label.replace(/^(— )+/, "")]));
  return (
    <>
      <PageHeader title="Certificate Types & Badges" icon={ListChecks} description="What FIRINGI asks suppliers for. Required types pause the supplier (or only its offers in the chosen categories) when the certificate is missing or expired — after the grace days. The badge switch decides whether customers see a verified badge for it." />
      <div className="mb-6 overflow-x-auto rounded-2xl border">
        <table className="w-full min-w-[44rem] text-sm" data-testid="types-table">
          <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr><th className="p-3">Certificate</th><th className="p-3">Rules</th><th className="p-3">Coverage</th><th className="p-3"><span className="inline-flex items-center gap-1"><BadgeCheck className="size-3.5" />Customer badge</span></th></tr>
          </thead>
          <tbody className="divide-y">
            {types.map((t) => (
              <tr key={t.id} className={t.isActive ? "" : "opacity-60"} data-testid={`type-row-${t.key}`}>
                <td className="p-3 align-top"><div className="font-medium">{t.name}</div><div className="text-xs text-muted-foreground">{t.description}</div></td>
                <td className="p-3 align-top">
                  <div className="flex flex-wrap gap-1">
                    {t.required ? <Badge variant="destructive">required</Badge> : <Badge variant="outline">optional</Badge>}
                    {!t.isActive && <Badge variant="outline">inactive</Badge>}
                    {t.hasExpiry ? <Badge variant="secondary">expires{t.graceDays ? ` · ${t.graceDays} grace days` : ""}</Badge> : <Badge variant="secondary">no expiry</Badge>}
                    {t.recheckMonths && <Badge variant="secondary">re-check {t.recheckMonths} mo</Badge>}
                    {t.publicDownload && <Badge variant="secondary">downloadable</Badge>}
                    {t.appliesTo.length < 2 && <Badge variant="secondary">{t.appliesTo[0] === "DISTRIBUTOR" ? "distributors" : "wholesalers"} only</Badge>}
                  </div>
                  {(t.countryIds.length > 0 || t.categoryIds.length > 0) && <p className="mt-1 text-xs text-muted-foreground">{[t.countryIds.map((id) => country.get(id)).join(", "), t.categoryIds.length ? `categories: ${t.categoryIds.map((id) => category.get(id)).join(", ")}` : ""].filter(Boolean).join(" · ")}</p>}
                </td>
                <td className="p-3 align-top tabular-nums">{t.covered}/{t.suppliers}</td>
                <td className="p-3 align-top">{manage ? <TypeBadgeSwitch id={t.id} enabled={t.badgeEnabled} name={t.key} /> : t.badgeEnabled ? "on" : "off"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {manage && (
        <div className="grid gap-6 xl:grid-cols-2">
          <Card>
            <CardHeader><CardTitle>Add a certificate type</CardTitle><CardDescription>Saving re-applies the rules to every supplier at once.</CardDescription></CardHeader>
            <CardContent><TypeForm initial={EMPTY_TYPE} countries={opts.countries} categories={opts.categories} /></CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Edit a certificate type</CardTitle><CardDescription>Making a type required pauses every supplier it applies to that doesn&apos;t hold it — check the coverage first, or grant grace periods.</CardDescription></CardHeader>
            <CardContent className="space-y-2">
              {types.map((t) => (
                <details key={t.id} className="rounded-xl border p-3" data-testid={`edit-${t.key}`}>
                  <summary className="cursor-pointer font-medium">{t.name}</summary>
                  <div className="mt-3"><TypeForm countries={opts.countries} categories={opts.categories} initial={{ id: t.id, name: t.name, description: t.description, appliesTo: t.appliesTo as ("DISTRIBUTOR" | "WHOLESALER")[], countryIds: t.countryIds, categoryIds: t.categoryIds, required: t.required, needsNumber: t.needsNumber, hasExpiry: t.hasExpiry, recheckMonths: t.recheckMonths, graceDays: t.graceDays, badgeEnabled: t.badgeEnabled, publicDownload: t.publicDownload, isActive: t.isActive }} /></div>
                </details>
              ))}
            </CardContent>
          </Card>
        </div>
      )}
    </>
  );
}
