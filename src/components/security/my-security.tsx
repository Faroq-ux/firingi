/** My security page (every portal except the driver app). */
import { getLocale, getTranslations } from "next-intl/server";
import type { Ctx } from "@/server/context";
import { mustSetUpTwoFactor, mySessions, securityPolicy } from "@/server/services/security";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDate } from "@/lib/utils";
import { EndOthersButton, EndSessionButton, TwoFactorPanel } from "./security-panel";
import { PrivacyPanel } from "./privacy-panel";
import { myErasureRequest } from "@/server/services/privacy";

export async function MySecurity({ ctx, required }: { ctx: Ctx; required: boolean }) {
  const [t, tp, locale, sessions, mustSetUp, policy, erasure] = await Promise.all([getTranslations("security"), getTranslations("privacy"), getLocale(), mySessions(ctx), mustSetUpTwoFactor(ctx), securityPolicy(), myErasureRequest(ctx)]);
  const mandatory = (policy.requireTwoFactorStaff && ctx.company.type === "ADMIN") || (policy.requireTwoFactorOwners && ctx.company.type !== "ADMIN" && ctx.membership.isOwner);
  return (
    <>
      <PageHeader title={t("title")} />
      {(required || mustSetUp) && <p className="mb-4 rounded-md border border-warning/60 bg-warning/10 p-3 text-sm" role="alert" data-testid="two-factor-required">{t("required")}</p>}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2">{t("twoFactor")} <Badge variant={ctx.user.twoFactor ? "success" : "secondary"}>{ctx.user.twoFactor ? t("on") : t("off")}</Badge></CardTitle></CardHeader>
          <CardContent><TwoFactorPanel enabled={ctx.user.twoFactor} required={mandatory} /></CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>{t("sessions")}</CardTitle><CardDescription>{t("sessionsIntro")}</CardDescription></CardHeader>
          <CardContent className="space-y-3">
            <ul className="divide-y text-sm" data-testid="sessions">
              {sessions.map((s) => (
                <li key={s.id} className="flex items-center justify-between gap-2 py-2">
                  <div>
                    <div className="font-medium">{s.device} {s.current && <Badge className="ml-1">{t("thisDevice")}</Badge>}</div>
                    <div className="text-xs text-muted-foreground">{s.ip ?? "—"} · {t("signedIn", { date: formatDate(s.createdAt, locale, true) })} · {t("lastActive", { date: formatDate(s.lastActive, locale, true) })}</div>
                  </div>
                  {!s.current && <EndSessionButton id={s.id} />}
                </li>
              ))}
            </ul>
            <EndOthersButton disabled={sessions.length < 2} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>{tp("title")}</CardTitle><CardDescription>{tp("intro")}</CardDescription></CardHeader>
          <CardContent><PrivacyPanel request={erasure && { status: erasure.status, note: erasure.note, requestedAt: erasure.requestedAt.toISOString() }} /></CardContent>
        </Card>
      </div>
    </>
  );
}
