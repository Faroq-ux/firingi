import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AssistantChat, AssistantOff } from "@/components/ai/chat";
import { AiSettingsForm } from "@/components/ai/actions";
import { aiSettings, assistantStatus, getConversation, listConversations } from "@/server/ai/assistant";
import { can } from "@/server/rbac/guard";
import { AI_MODEL_LABEL } from "@/lib/ai";
import { aiPage } from "../_kit";

export const metadata = { title: "AI Assistant" };
const EXAMPLES = [
  "How did sales go in the last 30 days compared with the month before?",
  "Which customers are late with their usual order?",
  "Which products will run out of stock this week?",
  "Where are we below our margin targets?",
  "Which open orders might be delivered late?",
  "Which customers have overdue invoices, and how much?",
  "How much cash comes in over the next 8 weeks?",
  "Which suppliers have the best delivery scores?",
];

export default async function Page({ searchParams }: { searchParams: Promise<{ c?: string }> }) {
  const { ctx } = await aiPage();
  const c = (await searchParams).c ?? null;
  const [status, settings, conversations] = await Promise.all([assistantStatus("STAFF"), aiSettings(), listConversations(ctx, "STAFF")]);
  const active = c ? await getConversation(ctx, "STAFF", c).catch(() => null) : null;
  const settingsCard = can(ctx, "admin.settings.manage") && (
    <Card className="mt-6"><CardHeader><CardTitle>AI settings</CardTitle></CardHeader><CardContent><AiSettingsForm settings={settings} /></CardContent></Card>
  );
  return (
    <>
      <PageHeader title="AI Assistant" description={<>Ask about FIRINGI&apos;s business in plain words. Claude ({AI_MODEL_LABEL[settings.model]}) reads live data through read-only tools with <em>your</em> access rights — it shows only what your role may see and never changes anything. If the model is busy, the Anthropic API answers with a fallback model.</>} />
      {!status.configured ? (
        <AssistantOff title="The assistant isn't connected yet" text="FIRINGI talks to Claude through the Anthropic API. Add the server environment variable ANTHROPIC_API_KEY (from console.anthropic.com) and restart FIRINGI; the assistant switches on by itself. The insight pages of the AI Centre work without it." />
      ) : !status.switchedOn ? (
        <AssistantOff title="The assistant is switched off for staff" text="An administrator can switch it on in the AI settings below." />
      ) : (
        <AssistantChat
          side="STAFF" base="/admin/ai/assistant" locale="en" showModel examples={EXAMPLES}
          conversations={conversations.map((x) => ({ id: x.id, title: x.title, updatedAt: x.updatedAt.toISOString() }))}
          active={active?.id ?? null}
          initial={(active?.messages ?? []).map((m) => ({ id: m.id, role: m.role as "user" | "assistant", text: m.text, tools: (m.tools as { name: string; ok: boolean }[] | null) ?? undefined, model: m.model }))}
        />
      )}
      {settingsCard}
    </>
  );
}
