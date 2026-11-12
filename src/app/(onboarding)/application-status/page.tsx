import Link from "next/link";
import { redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { CheckCircle2, Circle } from "lucide-react";
import { getContext } from "@/server/context";
import { homeFor } from "@/server/rbac/guard";
import { myApplication } from "@/server/data/users";
import { REQUIRED_DRIVER_DOCUMENTS } from "@/server/onboarding/rules";
import { AccountStatusBadge } from "@/components/layout/status-badge";
import { SignOutButton } from "@/components/layout/sign-out-button";
import { AddressesSection, DocumentsSection, ProfileSection } from "@/components/company/sections";
import { DocumentsManager } from "@/components/company/documents-manager";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { formatDate } from "@/lib/utils";
import { SubmitApplicationButton } from "./submit-button";

export const metadata = { title: "Application" };

/**
 * Onboarding hub: the only area members of a not-yet-approved company (or an applicant
 * driver) can use. They complete their profile, addresses and documents, then submit.
 */
export default async function ApplicationPage() {
  const ctx = await getContext();
  if (!ctx) redirect("/login");
  const app = await myApplication(ctx);
  const [t, ta, tc, c, locale] = await Promise.all([
    getTranslations("onboarding"), getTranslations("application"), getTranslations("companyType"), getTranslations("common"), getLocale(),
  ]);
  const home = homeFor(ctx);

  // ── Applicant driver (member of FIRINGI) ──
  if (!app.isApplicantCompany) {
    if (!app.driver) redirect(home);
    const d = app.driver;
    return (
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-semibold">{t("hub.driverTitle")}</h1>
          <div className="flex items-center gap-2"><AccountStatusBadge status={d.status} /><SignOutButton label={c("signOut")} /></div>
        </div>
        <Card>
          <CardContent className="space-y-4 pt-5">
            <p className="rounded-md bg-muted p-3 text-sm">{d.status === "APPROVED" ? t("hub.driverApproved") : t("hub.driverPending")}</p>
            {d.status === "APPROVED" && <Link className={buttonVariants()} href={home}>{ta("goToPortal")}</Link>}
            <DocumentsManager
              target="driver"
              canEdit={d.status !== "APPROVED" && d.status !== "REJECTED"}
              types={[...REQUIRED_DRIVER_DOCUMENTS, "OTHER"]}
              required={REQUIRED_DRIVER_DOCUMENTS}
              rows={d.documents.map((x) => ({ id: x.id, type: x.type, fileName: x.fileName, status: x.status, reviewNote: x.reviewNote, createdAt: x.createdAt.toISOString(), expiresAt: x.expiresAt?.toISOString() ?? null }))}
            />
          </CardContent>
        </Card>
      </div>
    );
  }

  // ── Applicant company ──
  const co = app.company;
  const statusKey = co.status.toLowerCase() as "pending" | "under_review" | "approved" | "rejected" | "suspended";
  const editable = co.status === "PENDING" || co.status === "UNDER_REVIEW";
  const missingText = (code: string, detail?: string) => {
    const pretty = detail?.split("|").map((k) => (k in { HEAD_OFFICE: 1, BILLING: 1, WAREHOUSE: 1, PICKUP: 1, DELIVERY: 1 } ? t(`addressKinds.${k}`) : t(`docTypes.${k}`))).join(" / ");
    return t(`hub.missing.${code}` as "hub.missing.DOCUMENT_MISSING", { detail: pretty ?? "" });
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{ta("title")}</h1>
          <p className="text-sm text-muted-foreground">{co.country.flag} {co.legalName} · {tc(co.type)}</p>
        </div>
        <div className="flex items-center gap-2"><AccountStatusBadge status={co.status} /><SignOutButton label={c("signOut")} /></div>
      </div>

      <Card>
        <CardContent className="space-y-4 pt-5">
          <p className="rounded-md bg-muted p-3 text-sm">{ta(statusKey)}</p>
          {co.statusReason && <p className="text-sm"><span className="font-medium">{ta("reason")}:</span> {co.statusReason}</p>}
          {co.status === "APPROVED" && <Link className={buttonVariants()} href={home}>{ta("goToPortal")}</Link>}
          {co.status === "PENDING" && (
            <div className="space-y-3">
              <h2 className="font-semibold">{t("hub.checklist")}</h2>
              {app.missing.length === 0 ? (
                <p className="flex items-center gap-2 text-sm text-success"><CheckCircle2 className="size-4" /> {t("hub.ready")}</p>
              ) : (
                <ul className="space-y-1 text-sm">
                  {app.missing.map((m, i) => <li key={i} className="flex items-center gap-2"><Circle className="size-3.5 text-muted-foreground" /> {missingText(m.code, m.detail)}</li>)}
                </ul>
              )}
              <SubmitApplicationButton disabled={app.missing.length > 0} />
            </div>
          )}
          {co.status === "UNDER_REVIEW" && <p className="text-sm text-muted-foreground">{t("hub.waiting")}</p>}
          {app.recommended.length > 0 && (
            <div className="space-y-1.5 rounded-md border border-dashed p-3" data-testid="recommended">
              <p className="text-sm font-medium">{t("hub.recommended")}</p>
              <ul className="space-y-1 text-sm">
                {app.recommended.map((m, i) => <li key={i} className="flex items-center gap-2"><Circle className="size-3.5 text-warning" /> {missingText(m.code, m.detail)}</li>)}
              </ul>
            </div>
          )}
        </CardContent>
      </Card>

      {(editable || co.status === "REJECTED") && (
        <>
          <Card><CardHeader><CardTitle>{t("hub.profile")}</CardTitle></CardHeader><CardContent><ProfileSection ctx={ctx} /></CardContent></Card>
          <Card><CardHeader><CardTitle>{t("hub.addresses")}</CardTitle></CardHeader><CardContent><AddressesSection ctx={ctx} /></CardContent></Card>
          <Card><CardHeader><CardTitle>{t("hub.documents")}</CardTitle></CardHeader><CardContent><DocumentsSection ctx={ctx} /></CardContent></Card>
        </>
      )}

      <Card>
        <CardHeader><CardTitle>{ta("history")}</CardTitle></CardHeader>
        <CardContent>
          <ul className="space-y-1 text-sm text-muted-foreground">
            {co.statusHistory.map((h) => (
              <li key={h.id} className="flex justify-between gap-2"><span>{h.toStatus}{h.reason ? ` — ${h.reason}` : ""}</span><span>{formatDate(h.at, locale, true)}</span></li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
