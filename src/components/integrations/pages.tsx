/** Server page bodies shared by the supplier (Sell) and buyer (Buy) portals. */
import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { BookOpen, KeyRound, Webhook } from "lucide-react";
import type { Ctx } from "@/server/context";
import { can } from "@/server/rbac/guard";
import { listOwnApiKeys } from "@/server/services/api-keys";
import { listEndpoints } from "@/server/integrations/webhooks";
import { companyExportsFor } from "@/server/integrations/accounting";
import { OPERATIONS } from "@/server/api/openapi";
import { IntegrationsHero } from "./hero";
import { ApiKeys, Webhooks } from "./connections";
import { CompanyExports } from "./exports";
import { ApiDocs } from "./api-docs";

export const appOrigin = () => (process.env.APP_URL ?? process.env.BETTER_AUTH_URL ?? "http://localhost:3000").replace(/\/$/, "");
const iso = (d: Date | null) => (d ? d.toISOString() : null);

export async function IntegrationsBody({ ctx, base }: { ctx: Ctx; base: "/vendor" | "/buy" }) {
  const [t, locale, keys, hooks] = await Promise.all([getTranslations("integrations"), getLocale(), listOwnApiKeys(ctx), listEndpoints(ctx)]);
  const active = keys.keys.filter((k) => !k.revokedAt);
  const calls = active.reduce((a, k) => a + k.calls7d, 0);
  return (
    <>
      <IntegrationsHero title={t("hub.title")} subtitle={t("hub.subtitle")} live={t("hub.live")} locale={locale}
        stats={[{ label: t("stat.keys"), value: active.length }, { label: t("stat.webhooks"), value: hooks.endpoints.filter((h) => h.active).length }, { label: t("stat.calls"), value: calls }]}>
        <Link href={`${base}/company/integrations/api`} className="glass inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold text-white" data-testid="docs-link"><BookOpen className="size-4" aria-hidden />{t("docs.open")}</Link>
      </IntegrationsHero>
      <section className="mb-8">
        <h2 className="mb-1 flex items-center gap-2 text-lg font-semibold"><KeyRound className="size-5 text-[var(--vivid-violet)]" aria-hidden />{t("keys.title")}</h2>
        <p className="mb-3 text-sm text-muted-foreground">{t("keys.intro")}</p>
        <ApiKeys locale={locale} scopes={keys.scopes.map((s) => s.key)}
          keys={keys.keys.map((k) => ({ id: k.id, name: k.name, prefix: k.prefix, scopes: k.scopes, revokedAt: iso(k.revokedAt), lastUsedAt: iso(k.lastUsedAt), actsAs: k.actsAs, calls7d: k.calls7d, errors7d: k.errors7d }))}
          recent={keys.recent.map((r) => ({ id: r.id, keyName: r.keyName, method: r.method, path: r.path, status: r.status, ms: r.ms, at: r.at.toISOString() }))} />
      </section>
      <section>
        <h2 className="mb-1 flex items-center gap-2 text-lg font-semibold"><Webhook className="size-5 text-[var(--vivid-teal)]" aria-hidden />{t("hooks.title")}</h2>
        <p className="mb-3 text-sm text-muted-foreground">{t("hooks.intro")}</p>
        <Webhooks locale={locale} events={hooks.events}
          hooks={hooks.endpoints.map((h) => ({ id: h.id, url: h.url, events: h.events, active: h.active, disabledReason: h.disabledReason, lastSuccessAt: iso(h.lastSuccessAt), lastFailureAt: iso(h.lastFailureAt), failureStreak: h.failureStreak }))}
          recent={hooks.recent.map((r) => ({ id: r.id, endpointId: r.endpointId, event: r.event, status: r.status, attempts: r.attempts, responseCode: r.responseCode, createdAt: r.createdAt.toISOString() }))} />
      </section>
    </>
  );
}

export async function ApiDocsBody({ ctx }: { ctx: Ctx }) {
  const t = await getTranslations("integrations");
  const supplier = ctx.company.type === "DISTRIBUTOR" || ctx.company.type === "WHOLESALER", buyer = ctx.company.type === "CUSTOMER" || ctx.company.type === "WHOLESALER";
  return (
    <>
      <IntegrationsHero title={t("docs.title")} subtitle={t("docs.intro")} locale="en" stats={[]} />
      <ApiDocs ops={OPERATIONS} origin={appOrigin()} side={supplier && buyer ? "BOTH" : supplier ? "SUPPLIER" : "BUYER"} />
    </>
  );
}

export async function ExportsBody({ ctx }: { ctx: Ctx }) {
  const t = await getTranslations("integrations");
  return (
    <>
      <IntegrationsHero title={t("exports.title")} subtitle={t("exports.intro")} locale="en" stats={[]} />
      <CompanyExports kinds={companyExportsFor(ctx)} />
    </>
  );
}

export const canIntegrate = (ctx: Ctx) => can(ctx, "company.integrations.manage");
