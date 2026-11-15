import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { assistantStatus, getConversation, listConversations } from "@/server/ai/assistant";
import { PageHeader } from "@/components/layout/page-header";
import { AssistantChat, AssistantOff, type AgentLabels, type ChatLabels, type ChatTool } from "@/components/ai/chat";

export const metadata = { title: "Assistant" };
const TOOL_KEYS = ["sales_summary", "breakdown", "demand_forecast", "stock_outlook", "reorder_outlook", "delivery_risk", "supplier_scorecards", "find_orders", "search_catalogue", "open_suggestions"] as const;
const AGENT_TOOLS = ["add_to_cart", "view_cart", "my_invoices", "my_claims", "my_statements", "handover"] as const;

export default async function Page({ searchParams }: { searchParams: Promise<{ c?: string }> }) {
  const ctx = await pagePortal("buy");
  pagePermission(ctx, ["buyer.orders.view", "buyer.orders.place"]);
  const [t, locale, status] = await Promise.all([getTranslations("ai"), getLocale(), assistantStatus("BUYER", ctx.company.id)]);
  if (!status.switchedOn) notFound(); // FIRINGI switches the Assistant on per company
  const c = (await searchParams).c ?? null;
  const header = <PageHeader title={t("assistant.title")} description={t("agent.descriptionBuyer")} />;
  if (!status.enabled) return <>{header}<AssistantOff title={t("agent.offTitle")} text={t("agent.offText")} /></>;
  const [conversations, active] = await Promise.all([listConversations(ctx, "BUYER"), c ? getConversation(ctx, "BUYER", c).catch(() => null) : Promise.resolve(null)]);
  const l: ChatLabels = {
    title: t("assistant.title"), newChat: t("assistant.newChat"), history: t("assistant.history"), noHistory: t("assistant.noHistory"), placeholder: t("agent.placeholderBuyer"),
    send: t("assistant.send"), thinking: t("assistant.thinking"), lookedAt: t("assistant.lookedAt"), you: t("assistant.you"), assistant: t("assistant.assistant"),
    suggestOnly: t("agent.introBuyer"), delete: t("assistant.delete"), tryAsking: t("assistant.tryAsking"),
  };
  const agent: AgentLabels = {
    addedToCart: t("agent.addedToCart"), cartNow: t("agent.cartNow"), openCart: t("agent.openCart"), handoverTitle: t("agent.handoverTitle"),
    handoverText: t("agent.handoverText"), handoverSend: t("agent.handoverSend"), handoverSent: t("agent.handoverSent"), openRequest: t("agent.openRequest"),
    media: {
      photo: t("agent.addPhoto"), photo1: t("agent.photo"), scan: t("agent.scan"), stopScan: t("agent.stopScan"), scanning: t("agent.scanning"),
      removePhoto: t("agent.removePhoto"), photoHint: t("agent.photoHint"), tooMany: t("agent.tooMany"), cameraBlocked: t("agent.cameraBlocked"),
    },
  };
  return (
    <>
      {header}
      <AssistantChat
        side="BUYER" base="/buy/assistant" locale={locale} l={l}
        examples={[t("agent.buyerEx1"), t("agent.buyerEx2"), t("agent.buyerEx3"), t("agent.buyerEx4")]} agent={agent}
        toolLabel={{ ...Object.fromEntries(TOOL_KEYS.map((k) => [k, t(`tools.${k}`)])), ...Object.fromEntries(AGENT_TOOLS.map((k) => [k, t(`agent.tools.${k}`)])) }}
        conversations={conversations.map((x) => ({ id: x.id, title: x.title, updatedAt: x.updatedAt.toISOString() }))}
        active={active?.id ?? null}
        initial={(active?.messages ?? []).map((m) => ({ id: m.id, role: m.role as "user" | "assistant", text: m.text, photos: m.photoKeys.length, tools: (m.tools as ChatTool[] | null) ?? undefined }))}
      />
    </>
  );
}
