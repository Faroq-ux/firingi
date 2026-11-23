import Link from "next/link";
import { Workflow } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { WorkflowEditor, type WorkflowDraft } from "@/components/ai/ops";
import { agentOptions } from "@/server/ai/ops/agents";
import { mayAutomate } from "@/server/ai/ops/workflows";
import { DEFAULT_SCHEDULE, WORKFLOW_TEMPLATES } from "@/lib/ai-ops";
import { aiPage } from "../../_kit";

export const metadata = { title: "New automation" };
export const dynamic = "force-dynamic";

export default async function NewAutomation({ searchParams }: { searchParams: Promise<{ template?: string }> }) {
  const { ctx } = await aiPage();
  const sp = await searchParams;
  const agents = await agentOptions(ctx);
  const t = WORKFLOW_TEMPLATES.find((x) => x.key === sp.template);
  // a template's agent step gets an agent of that kind, when FIRINGI has one
  const agentFor = (tpl?: string) => agents.find((a) => a.template === tpl)?.id ?? "";
  const initial: WorkflowDraft = t
    ? { name: t.name, description: t.description, trigger: t.trigger, schedule: t.schedule ?? DEFAULT_SCHEDULE, conditions: t.conditions, match: t.match, steps: t.steps.map((s) => (s.type === "AGENT" ? { ...s, agentId: agentFor(t.agentTemplate) } : s)), maxRunsPerDay: 50, template: t.key }
    : { name: "", description: "", trigger: "ORDER_PLACED", schedule: DEFAULT_SCHEDULE, conditions: [], match: "ALL", steps: [{ type: "NOTIFY", group: "admin.ai.view", title: "", body: "" }], maxRunsPerDay: 50 };
  return (
    <>
      <PageHeader title={t ? `New automation: ${t.name}` : "New automation"} icon={Workflow} description={<>It is saved switched off — test it, then switch it on. <Link className="underline" href="/admin/ai/automation?tab=RULES">Templates</Link></>} />
      <Card><CardContent className="pt-6"><WorkflowEditor id={null} initial={initial} agents={agents} canEdit={mayAutomate(ctx)} /></CardContent></Card>
    </>
  );
}
