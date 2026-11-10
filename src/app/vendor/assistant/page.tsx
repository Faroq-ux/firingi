import { getLocale, getTranslations } from "next-intl/server";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { assistantStatus, getConversation, listConversations } from "@/server/ai/assistant";
import { PageHeader } from "@/components/layout/page-header";
import { AssistantChat, AssistantOff, type ChatLabels } from "@/components/ai/chat";

export const metadata = { title: "AI Assistant" };
const TOOL_KEYS = ["sales_summary", "breakdown", "demand_forecast", "stock_outlook", "reorder_outlook", "delivery_risk", "supplier_scorecards", "find_orders", "search_catalogue", "open_suggestions"] as const;

export default async function Page({ searchParams }: { searchParams: Promise<{ c?: string }> }) {
  const ctx = await pagePortal("vendor");
  pagePermission(ctx, ["vendor.reports.view", "vendor.dashboard.view"]);
  const [t, locale, status] = await Promise.all([getTranslations("ai"), getLocale(), assistantStatus("VENDOR")]);
  const c = (await searchParams).c ?? null;
  const header = <PageHeader title={t("assistant.title")} description={t("assistant.description")} />;
  if (!status.enabled) return <>{header}<AssistantOff title={t("assistant.offTitle")} text={t("assistant.offText")} /></>;
  const [conversations, active] = await Promise.all([listConversations(ctx, "VENDOR"), c ? getConversation(ctx, "VENDOR", c).catch(() => null) : Promise.resolve(null)]);
  const l: ChatLabels = {
    title: t("assistant.title"), newChat: t("assistant.newChat"), history: t("assistant.history"), noHistory: t("assistant.noHistory"), placeholder: t("assistant.placeholderVendor"),
    send: t("assistant.send"), thinking: t("assistant.thinking"), lookedAt: t("assistant.lookedAt"), you: t("assistant.you"), assistant: t("assistant.assistant"),
    suggestOnly: t("assistant.suggestOnly"), delete: t("assistant.delete"), tryAsking: t("assistant.tryAsking"),
  };
  return (
    <>
      {header}
      <AssistantChat
        side="VENDOR" base="/vendor/assistant" locale={locale} l={l}
        examples={[t("assistant.vendorEx1"), t("assistant.vendorEx2"), t("assistant.vendorEx3"), t("assistant.vendorEx4")]}
        toolLabel={Object.fromEntries(TOOL_KEYS.map((k) => [k, t(`tools.${k}`)]))}
        conversations={conversations.map((x) => ({ id: x.id, title: x.title, updatedAt: x.updatedAt.toISOString() }))}
        active={active?.id ?? null}
        initial={(active?.messages ?? []).map((m) => ({ id: m.id, role: m.role as "user" | "assistant", text: m.text, tools: (m.tools as { name: string; ok: boolean }[] | null) ?? undefined }))}
      />
    </>
  );
}
