import { Bot } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { AgentEditor, type AgentDraft } from "@/components/ai/ops";
import { mayManageAgents } from "@/server/ai/ops/agents";
import { governance } from "@/server/ai/ops/governance";
import { AGENT_TEMPLATES } from "@/lib/ai-ops";
import { aiPage } from "../../_kit";

export const metadata = { title: "New AI agent" };
export const dynamic = "force-dynamic";

export default async function NewAgent({ searchParams }: { searchParams: Promise<{ template?: string }> }) {
  const { ctx } = await aiPage();
  const sp = await searchParams;
  const t = AGENT_TEMPLATES.find((x) => x.key === sp.template);
  const g = await governance();
  const initial: AgentDraft = t
    ? { name: t.name, role: t.role, instructions: t.instructions, icon: t.icon, tone: t.tone, tools: t.tools, dataAreas: t.data, autonomy: t.autonomy, model: "default", effort: "medium", maxRunsPerDay: 24, active: true, schedule: t.schedule, scheduleTask: t.task, template: t.key }
    : { name: "", role: "", instructions: "", icon: "Bot", tone: "tone-blue", tools: ["open_suggestions"], dataAreas: [], autonomy: "APPROVAL", model: "default", effort: "medium", maxRunsPerDay: 24, active: true, schedule: null, scheduleTask: null };
  return (
    <>
      <PageHeader title={t ? `New agent: ${t.name}` : "New AI agent"} icon={Bot} description="Give it a job, the tools and data it needs, and decide how freely it may act. You can test it right after saving." />
      <Card><CardContent className="pt-6"><AgentEditor id={null} initial={initial} canEdit={mayManageAgents(ctx)} autoActions={g.autoActions} /></CardContent></Card>
    </>
  );
}
