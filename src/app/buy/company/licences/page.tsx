import { BadgeCheck } from "lucide-react";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { myLicences } from "@/server/excise/service";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { LicenceUploadForm, WithdrawLicence } from "@/components/excise/client";
import { exLabels, fill } from "@/components/excise/labels";

export const metadata = { title: "Licences" };
export const dynamic = "force-dynamic";

const TONE = { PENDING: "warning", APPROVED: "success", REJECTED: "destructive", EXPIRED: "destructive", REVOKED: "destructive", SUPERSEDED: "outline" } as const;

export default async function BuyerLicencesPage() {
  const ctx = await pagePortal("buy");
  pagePermission(ctx, ["buyer.compliance.manage", "company.documents.manage", "buyer.orders.place", "buyer.orders.view"]);
  const { l, locale } = await exLabels();
  const v = await myLicences(ctx, locale);
  const day = (d: Date | null) => (d ? new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(new Date(d)) : "—");
  return (
    <>
      <PageHeader title={l.licencesTitle} icon={BadgeCheck} description={l.licencesIntro} />
      <Card className="mb-6">
        <CardContent className="space-y-3 pt-5 text-sm">
          <p className="text-muted-foreground" data-testid="licence-rule">{!v.rule.needed ? l.notNeeded : v.rule.enforcement === "WARN" ? l.warnOnly : l.blockInfo}</p>
          <ul className="flex flex-wrap gap-2" data-testid="licence-kinds">
            {v.types.map((t) => <li key={t.id} className="min-w-0 max-w-full"><Badge variant={t.ok ? "success" : "outline"} className="h-auto whitespace-normal break-words text-left" data-testid="licence-kind" data-ok={t.ok ? "1" : "0"}>{t.name} · {t.ok ? l.covered : l.notCovered}</Badge></li>)}
          </ul>
        </CardContent>
      </Card>
      <Card className="mb-6">
        <CardHeader><CardTitle>{l.upload}</CardTitle><CardDescription>{l.licencesIntro}</CardDescription></CardHeader>
        <CardContent><LicenceUploadForm l={l} types={v.types} /></CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>{l.yourLicences}</CardTitle></CardHeader>
        <CardContent>
          {!v.licences.length ? <p className="py-4 text-center text-sm text-muted-foreground">{l.none}</p> : (
            <ul className="divide-y" data-testid="licence-list">
              {v.licences.map((x) => {
                const st = x.superseded ? "SUPERSEDED" : x.status;
                return (
                  <li key={x.id} className="flex flex-wrap items-center gap-2 py-3 text-sm" data-testid="licence-row" data-status={st}>
                    <span className="min-w-0 flex-1 basis-56 break-words font-medium">{x.type}{x.number ? <span className="font-mono text-xs font-normal"> · {x.number}</span> : null}<span className="text-xs font-normal text-muted-foreground">{x.issuer ? ` · ${x.issuer}` : ""} · {l.expiresOn}: {day(x.expiresOn)}</span></span>
                    <Badge variant={TONE[st as keyof typeof TONE]}>{st === "SUPERSEDED" ? l.superseded : l[`status.${st}`]}</Badge>
                    {x.valid && x.daysLeft != null && x.daysLeft <= 30 && <Badge variant="warning">{fill(l.daysLeft, { days: x.daysLeft })}</Badge>}
                    {x.hasFile && <a href={`/api/excise/licences/${x.id}`} className="text-xs text-primary hover:underline">{l.download}</a>}
                    {x.status === "PENDING" && <WithdrawLicence l={l} id={x.id} />}
                    {x.reviewNote && x.status !== "APPROVED" && <p className="basis-full text-xs text-muted-foreground">{fill(l.fbNote, { note: x.reviewNote })}</p>}
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </>
  );
}
