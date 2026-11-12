import { AlertTriangle, BadgeCheck, CalendarClock, CheckCircle2, Clock, FileWarning, ShieldCheck } from "lucide-react";
import { getLocale, getTranslations } from "next-intl/server";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { myCompliance } from "@/server/compliance/service";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DataTable } from "@/components/ui/data-table";
import { Tile } from "@/components/motion/dashboard-kit";
import { ProgressRing } from "@/components/motion/shapes";
import { CertUploadForm, WithdrawCert } from "@/components/compliance/supplier";
import { certLabel } from "@/components/compliance/badges";
import { pickLocalized } from "@/i18n/config";
import { isBuiltinCert, STATE_TONE, COVERED_STATES, type CertStateKey } from "@/lib/compliance";
import { formatDate } from "@/lib/utils";

export const metadata = { title: "Certificates & compliance" };

export default async function SupplierCompliance() {
  const ctx = await pagePortal("vendor");
  pagePermission(ctx, ["company.documents.manage", "company.profile.manage", "vendor.products.view", "vendor.products.manage"]);
  const canUpload = ctx.permissions.has("company.documents.manage");
  const [d, t, locale, label] = await Promise.all([myCompliance(ctx), getTranslations("compliance"), getLocale(), certLabel()]);
  const desc = (key: string, fallback: string | null) => (isBuiltinCert(key) ? t(`typeDesc.${key}` as "typeDesc.HACCP") : fallback);
  const state = (s: string) => t(`states.${s}` as "states.VALID");
  const count = (s: CertStateKey[]) => d.rows.filter((r) => s.includes(r.state as CertStateKey)).length;
  const missingRequired = d.rows.filter((r) => r.type.required && !COVERED_STATES.includes(r.state as CertStateKey));
  const paused = !!d.pausedWhole || d.pausedOffers > 0;
  const pauseNames = missingRequired.map((r) => label(r.type.key, r.type.name)).join(", ");
  return (
    <>
      <PageHeader title={t("title")} description={t("intro")} icon={ShieldCheck} />
      {paused && (
        <div className="mb-6 flex items-start gap-3 rounded-2xl border border-destructive/40 bg-destructive/10 p-4 text-sm" role="alert" data-testid="paused-banner">
          <AlertTriangle className="mt-0.5 size-5 shrink-0 text-destructive" />
          <div>
            <p className="font-semibold">{t("pausedTitle")}</p>
            <p>{d.pausedWhole ? t("pausedWhole", { certificates: pauseNames }) : t("pausedOffers", { count: d.pausedOffers, certificates: pauseNames })}</p>
          </div>
        </div>
      )}
      <div className="mb-6 grid gap-3 lg:grid-cols-[auto_1fr]">
        <div className="glass-panel flex items-center gap-4 rounded-2xl border p-4" data-testid="compliance-score">
          <ProgressRing value={d.score} label={t("score")} from={d.score >= 80 ? "var(--vivid-teal)" : "var(--vivid-orange)"} to={d.score >= 80 ? "var(--vivid-blue)" : "var(--vivid-pink)"}>
            <span className="text-xl font-bold tabular-nums">{d.score}</span>
          </ProgressRing>
          <div className="max-w-[16rem]"><p className="font-semibold">{t("score")}</p><p className="text-xs text-muted-foreground">{t("scoreHint")}</p></div>
        </div>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Tile icon={CheckCircle2} label={t("valid")} value={count(["VALID", "EXPIRING"])} locale={locale} tone="tone-teal" i={0} />
          <Tile icon={CalendarClock} label={t("expiring")} value={count(["EXPIRING", "GRACE"])} locale={locale} tone="tone-orange" i={1} />
          <Tile icon={FileWarning} label={t("missingRequired")} value={missingRequired.length} locale={locale} tone="tone-pink" i={2} />
          <Tile icon={Clock} label={t("pendingReview")} value={d.rows.filter((r) => r.pendingId).length} locale={locale} tone="tone-violet" i={3} />
        </div>
      </div>

      <h2 className="mb-3 text-lg font-semibold">{t("checklist")}</h2>
      {d.rows.length === 0 ? <p className="mb-6 text-sm text-muted-foreground">{t("nothingAsked")}</p> : (
        <div className="mb-8 grid gap-3 lg:grid-cols-2" data-testid="cert-checklist">
          {d.rows.map((r, i) => {
            const cur = d.history.find((h) => h.id === r.currentId);
            const pend = d.history.find((h) => h.id === r.pendingId);
            const rejected = !r.pendingId && r.state === "REJECTED" ? d.history.find((h) => h.typeId === r.type.id) : null;
            const name = label(r.type.key, r.type.name);
            return (
              <Card key={r.type.id} className="motion-rise" style={{ ["--i" as string]: i }} data-testid={`cert-${r.type.key}`}>
                <CardHeader className="pb-2">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <CardTitle className="flex items-center gap-2 text-base">{name}{r.type.badgeEnabled && <BadgeCheck className="size-4 text-[var(--vivid-teal)]" aria-label={t("badgeEligible")} />}</CardTitle>
                    <Badge variant={STATE_TONE[r.state as CertStateKey]} data-testid="cert-state">{state(r.state)}</Badge>
                  </div>
                  <CardDescription>{desc(r.type.key, r.type.description)}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-2 text-sm">
                  <div className="flex flex-wrap gap-1.5">
                    <Badge variant={r.type.required ? "destructive" : "secondary"}>{r.type.required ? t("required") : t("optional")}</Badge>
                    {r.type.badgeEnabled && <Badge variant="success">{t("badgeEligible")}</Badge>}
                    {r.type.categories.length > 0 && <Badge variant="outline">{t("categoriesOnly", { categories: r.type.categories.map((c) => pickLocalized(c as Record<string, string>, locale)).join(", ") })}</Badge>}
                  </div>
                  {cur && (
                    <p className="text-muted-foreground">
                      {cur.number ? `${t("number")}: ${cur.number} · ` : ""}
                      {cur.expiresOn ? t("expiresOn", { date: formatDate(cur.expiresOn, locale) }) : t("noExpiry")}
                      {r.daysLeft !== null && r.daysLeft >= 0 && r.state === "EXPIRING" ? ` · ${t("daysLeft", { days: r.daysLeft })}` : ""}
                    </p>
                  )}
                  {r.graceUntil && r.state === "GRACE" && <p className="text-amber-700 dark:text-warning">{t("graceUntil", { date: formatDate(r.graceUntil, locale) })}</p>}
                  {r.waiverUntil && <p className="text-muted-foreground">{t("waivedUntil", { date: formatDate(r.waiverUntil, locale) })}</p>}
                  {pend && <p className="text-muted-foreground">{t("pendingUpload", { date: formatDate(pend.createdAt, locale) })}</p>}
                  {rejected?.reviewNote && <p className="text-destructive">{t("rejectedNote", { note: rejected.reviewNote })}</p>}
                  {canUpload && !pend && (
                    <CertUploadForm typeId={r.type.id} needsNumber={r.type.needsNumber} hasExpiry={r.type.hasExpiry} label={cur ? t("renew") : t("uploadNew")} testId={`upload-${r.type.key}`} />
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <div className="grid gap-6 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader><CardTitle>{t("history")}</CardTitle></CardHeader>
          <CardContent>
            <DataTable tableId="vendor.certificates" testId="cert-history" empty={t("historyEmpty")}
              columns={[{ key: "type", label: t("colType"), filter: true }, { key: "number", label: t("number") }, { key: "uploaded", label: t("colUploaded"), type: "date" }, { key: "expires", label: t("colExpires"), type: "date" }, { key: "status", label: t("colStatus"), type: "badge", filter: true }, { key: "file", label: "" }]}
              rows={d.history.map((h) => ({
                id: h.id,
                cells: {
                  type: label(h.typeKey, h.typeName), number: h.number ?? "—",
                  uploaded: { t: formatDate(h.createdAt, locale), v: h.createdAt.getTime() },
                  expires: { t: h.expiresOn ? formatDate(h.expiresOn, locale) : "—", v: h.expiresOn?.getTime() ?? 0 },
                  status: { t: h.supersededAt ? t("superseded") : t(`statuses.${h.status}` as "statuses.PENDING"), tone: h.supersededAt ? "outline" : h.status === "APPROVED" ? "success" : h.status === "PENDING" ? "warning" : "destructive" },
                  file: { t: h.fileName, node: <span className="inline-flex items-center gap-2"><a href={`/api/compliance/certificates/${h.id}`} target="_blank" rel="noreferrer" className="text-primary hover:underline">{t("view")}</a>{canUpload && h.status === "PENDING" && <WithdrawCert id={h.id} />}</span> },
                },
              }))} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><BadgeCheck className="size-5 text-[var(--vivid-teal)]" />{t("badgesTitle")}</CardTitle><CardDescription>{t("badgesHint")}</CardDescription></CardHeader>
          <CardContent>
            {d.badges.length === 0 ? <p className="text-sm text-muted-foreground">{t("badgesNone")}</p> : (
              <ul className="flex flex-wrap gap-2" data-testid="badge-preview">
                {d.badges.map((b) => (
                  <li key={b.key} className={`inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs font-semibold ${b.hidden ? "opacity-50 line-through" : "border-[color:color-mix(in_oklch,var(--vivid-teal)_45%,transparent)] bg-[color:color-mix(in_oklch,var(--vivid-teal)_12%,transparent)]"}`} title={b.hidden ? t("badgeHidden") : undefined}>
                    <BadgeCheck className="size-3.5" />{label(b.key, b.name)}
                  </li>
                ))}
              </ul>
            )}
            {d.badges.some((b) => b.hidden) && <p className="mt-2 text-xs text-muted-foreground">{t("badgeHidden")}</p>}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
