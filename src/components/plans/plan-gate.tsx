/** Phase 36: a section of the supplier portal outside the supplier's plan shows an upgrade card instead. */
import Link from "next/link";
import { Sparkles } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { getContext } from "@/server/context";
import { planAllows } from "@/server/plans/service";
import type { PlanFeature } from "@/lib/plans";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export async function PlanGate({ feature, children }: { feature: PlanFeature; children: React.ReactNode }) {
  const ctx = await getContext();
  if (!ctx || (await planAllows(ctx.company.id, feature))) return <>{children}</>;
  const t = await getTranslations("plans");
  return (
    <div className="mx-auto max-w-xl py-10" data-testid="plan-gate">
      <Card>
        <CardContent className="space-y-4 pt-6 text-center">
          <span className="mx-auto flex size-12 items-center justify-center rounded-2xl bg-[linear-gradient(135deg,var(--vivid-blue),var(--vivid-violet))] text-white"><Sparkles className="size-6" /></span>
          <h1 className="text-xl font-semibold">{t("gateTitle", { feature: t(`features.${feature}`) })}</h1>
          <p className="text-sm text-muted-foreground">{t("gateBody")}</p>
          <Link href="/vendor/company/plan" className={buttonVariants()} data-testid="plan-gate-upgrade">{t("seePlans")}</Link>
        </CardContent>
      </Card>
    </div>
  );
}
