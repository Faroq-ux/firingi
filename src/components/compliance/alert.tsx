/** Supplier dashboard banner (Phase 28): shown only while offers are paused or a certificate needs attention. */
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { AlertTriangle, CalendarClock } from "lucide-react";
import type { Ctx } from "@/server/context";
import { myCompliance } from "@/server/compliance/service";

export async function ComplianceAlert({ ctx }: { ctx: Ctx }) {
  if (ctx.company.type !== "DISTRIBUTOR" && ctx.company.type !== "WHOLESALER") return null;
  const d = await myCompliance(ctx).catch(() => null);
  if (!d) return null;
  const t = await getTranslations("compliance");
  const paused = !!d.pausedWhole || d.pausedOffers > 0;
  const attention = d.rows.filter((r) => r.state === "EXPIRING" || r.state === "GRACE").length;
  if (!paused && !attention) return null;
  return (
    <Link href="/vendor/company/compliance" data-testid="compliance-alert"
      className={`mb-4 flex items-center gap-3 rounded-2xl border p-3 text-sm transition-colors ${paused ? "border-destructive/40 bg-destructive/10 hover:bg-destructive/15" : "border-warning/40 bg-warning/10 hover:bg-warning/15"}`}>
      {paused ? <AlertTriangle className="size-5 shrink-0 text-destructive" /> : <CalendarClock className="size-5 shrink-0 text-amber-600" />}
      <span className="flex-1">{paused ? t("alertPaused", { count: d.pausedOffers }) : t("alertExpiring", { count: attention })}</span>
      <span className="font-medium text-primary">{t("alertOpen")} →</span>
    </Link>
  );
}
