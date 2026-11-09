import Link from "next/link";
import { redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { getContext } from "@/server/context";
import { homeFor } from "@/server/rbac/guard";
import { myApplication } from "@/server/data/users";
import { AccountStatusBadge } from "@/components/layout/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { formatDate } from "@/lib/utils";
import { SignOutButton } from "./sign-out";

export const metadata = { title: "Application status" };

/** The only page members of a not-yet-approved company can use (besides onboarding in Phase 2). */
export default async function ApplicationStatusPage() {
  const ctx = await getContext();
  if (!ctx) redirect("/login");
  const [app, t, tc, c, locale] = await Promise.all([
    myApplication(ctx), getTranslations("application"), getTranslations("companyType"), getTranslations("common"), getLocale(),
  ]);
  const key = app.status.toLowerCase() as "pending" | "under_review" | "approved" | "rejected" | "suspended";

  return (
    <Card>
      <CardHeader className="space-y-2">
        <CardTitle className="text-xl">{t("title")}</CardTitle>
        <div className="flex items-center justify-between gap-2 text-sm">
          <span className="font-medium">{app.legalName} · {tc(app.type)}</span>
          <AccountStatusBadge status={app.status} />
        </div>
      </CardHeader>
      <CardContent className="space-y-5 text-sm">
        <p className="rounded-md bg-muted p-3">{t(key)}</p>
        {app.statusReason && <p><span className="font-medium">{t("reason")}:</span> {app.statusReason}</p>}
        <div>
          <h3 className="mb-2 font-medium">{t("history")}</h3>
          <ul className="space-y-1 text-muted-foreground">
            {app.statusHistory.map((h) => (
              <li key={h.id} className="flex justify-between gap-2"><span>{h.toStatus}{h.reason ? ` — ${h.reason}` : ""}</span><span>{formatDate(h.at, locale)}</span></li>
            ))}
          </ul>
        </div>
        <div>
          <h3 className="mb-2 font-medium">{t("documents")}</h3>
          {app.documents.length === 0 ? <p className="text-muted-foreground">{t("noDocuments")}</p> : (
            <ul>{app.documents.map((d) => <li key={d.id}>{d.type} — {d.fileName} ({d.status})</li>)}</ul>
          )}
        </div>
        <div className="flex justify-between">
          {app.status === "APPROVED" ? <Link className={buttonVariants()} href={homeFor(ctx)}>{t("goToPortal")}</Link> : <span />}
          <SignOutButton label={c("signOut")} />
        </div>
      </CardContent>
    </Card>
  );
}
