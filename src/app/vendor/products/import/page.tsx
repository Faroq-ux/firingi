import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { History, Radio } from "lucide-react";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { importRuns } from "@/server/integrations/catalogue-import";
import { listProfiles } from "@/server/integrations/feeds";
import { IntegrationsHero } from "@/components/integrations/hero";
import { ImportWizard } from "@/components/integrations/import-wizard";
import { Feeds } from "@/components/integrations/feeds";
import { Badge } from "@/components/ui/badge";

export const dynamic = "force-dynamic";
export const metadata = { title: "Import & Sync" };

export default async function Page() {
  const ctx = await pagePortal("vendor");
  pagePermission(ctx, ["vendor.products.manage", "vendor.pricing.manage", "vendor.stock.manage"]);
  const [t, locale, runs, profiles] = await Promise.all([getTranslations("integrations"), getLocale(), importRuns(ctx, 25), listProfiles(ctx)]);
  const week = Date.now() - 7 * 86400_000;
  const applied = runs.filter((r) => r.status === "APPLIED" && r.createdAt.getTime() > week);
  const changed = applied.reduce((a, r) => a + ((r.summary as { applied?: number }).applied ?? 0), 0);
  const waiting = runs.filter((r) => r.status === "PREVIEW").length;
  return (
    <>
      <IntegrationsHero title={t("import.title")} subtitle={t("import.subtitle")} live={profiles.some((p) => p.feedUrl && p.enabled) ? t("hub.live") : undefined} locale={locale}
        stats={[{ label: t("stat.feeds"), value: profiles.filter((p) => p.feedUrl && p.enabled).length }, { label: t("runStatus.APPLIED"), value: changed }, { label: t("runStatus.PREVIEW"), value: waiting }]} />
      <section className="mb-8 rounded-2xl border bg-card/60 p-4 sm:p-6"><ImportWizard /></section>
      <section className="mb-8">
        <h2 className="mb-1 flex items-center gap-2 text-lg font-semibold"><Radio className="size-5 text-[var(--vivid-teal)]" aria-hidden />{t("feeds.title")}</h2>
        <p className="mb-3 text-sm text-muted-foreground">{t("feeds.intro")}</p>
        <Feeds locale={locale} profiles={profiles.map((p) => ({ id: p.id, name: p.name, mapping: p.mapping as Record<string, string>, feedUrl: p.feedUrl, everyHours: p.everyHours, enabled: p.enabled, lastRunAt: p.lastRunAt?.toISOString() ?? null, last: p.runs[0] ? { status: p.runs[0].status, heldReason: p.runs[0].heldReason, error: p.runs[0].error } : null }))} />
      </section>
      <section>
        <h2 className="mb-3 flex items-center gap-2 text-lg font-semibold"><History className="size-5 text-[var(--vivid-violet)]" aria-hidden />{t("history.title")}</h2>
        {!runs.length ? <p className="text-sm text-muted-foreground">{t("history.empty")}</p> : (
          <ul className="divide-y overflow-hidden rounded-xl border bg-card" data-testid="import-history">
            {runs.map((r) => {
              const s = r.summary as { total?: number; updates?: number; newOffers?: number; applied?: number; errors?: number; bigChanges?: number };
              const st = r.status === "PREVIEW" && r.heldReason ? "HELD" : r.status;
              return (
                <li key={r.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
                  <Badge variant={st === "APPLIED" ? "success" : st === "FAILED" ? "destructive" : st === "CANCELLED" ? "outline" : "warning"}>{t(`runStatus.${st}`)}</Badge>
                  <span className="rounded bg-muted px-1.5 py-0.5 text-xs">{t(`source.${r.source}`)}</span>
                  <span className="min-w-0 flex-1 basis-32 truncate font-medium">{r.fileName ?? "—"}</span>
                  <span className="text-xs text-muted-foreground">{r.error ?? (st === "HELD" && s.bigChanges ? t("run.bigWarn", { count: s.bigChanges }) : `${t("run.summary.total")} ${s.total ?? 0} · ${t("run.summary.updates")} ${(s.updates ?? 0) + (s.newOffers ?? 0)}${s.applied !== undefined ? ` · ${t("runStatus.APPLIED")} ${s.applied}` : ""}`)}</span>
                  <span className="text-xs tabular-nums text-muted-foreground">{r.createdAt.toLocaleString(locale, { dateStyle: "short", timeStyle: "short" })}</span>
                  {r.status !== "FAILED" && <Link href={`/vendor/products/import/${r.id}`} className="text-sm font-medium text-primary hover:underline">{t("history.open")}</Link>}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </>
  );
}
