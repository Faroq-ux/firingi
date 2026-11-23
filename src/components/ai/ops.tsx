"use client";
/** AI Centre, Phase 67 — automation builder, agent set-up and runs, approvals, AI Governance (English: back office). */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, Check, FlaskConical, Pause, Play, Plus, Save, ThumbsDown, ThumbsUp, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Msg, Spin, useRun } from "@/components/shared/run";
import {
  cancelRunAction, decideAiApprovalAction, deleteAgentAction, deleteWorkflowAction, rateAgentRunAction, runAgentAction, runWorkflowNowAction,
  saveAgentAction, saveGovernanceAction, saveWorkflowAction, setAgentActiveAction, setWorkflowActiveAction, testWorkflowAction,
} from "@/server/actions/ai-ops";
import { AI_MODEL_LABEL, AI_MODELS } from "@/lib/ai";
import { REPORT_LABEL, REPORTS } from "@/lib/ai-centre";
import {
  ACT_TOOLS, AGENT_ICONS, AGENT_TONES, AGENT_TOOLS, AGENT_TOOL_NAMES, AUTONOMY, DATA_AREAS, DATA_AREA_KEYS, DEFAULT_SCHEDULE, EFFORTS, OPS, STAFF_GROUPS, STEP_LABEL, STEP_TYPES, TRIGGERS, TRIGGER_KINDS,
  blankStep, scheduleText, type Autonomy, type Condition, type DataArea, type Effort, type Governance, type ModelChoice, type Op, type Schedule, type StaffGroup, type Step, type StepType, type TriggerKind,
} from "@/lib/ai-ops";

const sel = "h-9 w-full min-w-0 rounded-md border bg-background px-2 text-sm";
const area = "min-h-20 w-full rounded-md border bg-background p-2 text-sm";
const Box = ({ checked, onChange, children, testid, disabled }: { checked: boolean; onChange: (b: boolean) => void; children: React.ReactNode; testid?: string; disabled?: boolean }) => (
  <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-0.5 size-4 shrink-0" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} data-testid={testid} /> <span className="min-w-0">{children}</span></label>
);
const Field = ({ label, children, className = "", htmlFor }: { label: string; children: React.ReactNode; className?: string; htmlFor?: string }) => (
  <div className={`min-w-0 space-y-1 ${className}`}><Label htmlFor={htmlFor}>{label}</Label>{children}</div>
);
const HOURS = Array.from({ length: 24 }, (_, h) => h);
const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

function ScheduleFields({ value, onChange, prefix }: { value: Schedule; onChange: (s: Schedule) => void; prefix: string }) {
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <Field label="Runs" htmlFor={`${prefix}-every`}>
        <select id={`${prefix}-every`} className={sel} value={value.every} onChange={(e) => onChange({ ...value, every: e.target.value as Schedule["every"] })} data-testid={`${prefix}-every`}>
          <option value="HOURLY">Every hour</option><option value="DAILY">Every day</option><option value="WEEKDAYS">Monday to Friday</option><option value="WEEKLY">Every week</option><option value="MONTHLY">Every month</option>
        </select>
      </Field>
      {value.every !== "HOURLY" && <Field label="At (UTC)" htmlFor={`${prefix}-hour`}><select id={`${prefix}-hour`} className={sel} value={value.hour} onChange={(e) => onChange({ ...value, hour: Number(e.target.value) })}>{HOURS.map((h) => <option key={h} value={h}>{String(h).padStart(2, "0")}:00</option>)}</select></Field>}
      {value.every === "WEEKLY" && <Field label="On" htmlFor={`${prefix}-wd`}><select id={`${prefix}-wd`} className={sel} value={value.weekday} onChange={(e) => onChange({ ...value, weekday: Number(e.target.value) })}>{WEEKDAYS.map((d, i) => <option key={d} value={i + 1}>{d}</option>)}</select></Field>}
      {value.every === "MONTHLY" && <Field label="Day of the month" htmlFor={`${prefix}-day`}><Input id={`${prefix}-day`} type="number" min={1} max={28} value={value.day} onChange={(e) => onChange({ ...value, day: Number(e.target.value) })} /></Field>}
    </div>
  );
}

// ── automation builder ──────────────────────────────────────────────────────

export type WorkflowDraft = { name: string; description: string; trigger: TriggerKind; schedule: Schedule; conditions: Condition[]; match: "ALL" | "ANY"; steps: Step[]; maxRunsPerDay: number; template?: string | null };
type TestResult = { sample: boolean; events: { payload: Record<string, unknown>; matched: boolean; steps: string[] }[] };

export function WorkflowEditor({ id, initial, agents, canEdit }: { id: string | null; initial: WorkflowDraft; agents: { id: string; name: string }[]; canEdit: boolean }) {
  const router = useRouter();
  const { pending, error, done, run } = useRun();
  const [w, setW] = useState(initial);
  const [test, setTest] = useState<TestResult | null>(null);
  const fields = TRIGGERS[w.trigger].fields as Record<string, { label: string; type: string }>;
  const input = () => ({ ...w, schedule: w.trigger === "SCHEDULE" ? w.schedule : null, description: w.description || null });
  const setStep = (i: number, s: Step) => setW({ ...w, steps: w.steps.map((x, j) => (j === i ? s : x)) });
  const move = (i: number, d: -1 | 1) => { const s = [...w.steps]; const [x] = s.splice(i, 1); s.splice(i + d, 0, x); setW({ ...w, steps: s }); };
  const tokens = Object.keys(fields).map((k) => `{{${k}}}`).join(" ");
  return (
    <fieldset disabled={!canEdit} className="space-y-6" data-testid="wf-editor">
      <div className="grid gap-3 md:grid-cols-2">
        <Field label="Name" htmlFor="wf-name"><Input id="wf-name" value={w.name} onChange={(e) => setW({ ...w, name: e.target.value })} data-testid="wf-name" /></Field>
        <Field label="What it is for (optional)" htmlFor="wf-desc"><Input id="wf-desc" value={w.description} onChange={(e) => setW({ ...w, description: e.target.value })} /></Field>
      </div>

      <section className="space-y-3 rounded-xl border p-3" aria-label="When">
        <p className="text-sm font-semibold">1. When</p>
        <Field label="Trigger" htmlFor="wf-trigger">
          <select id="wf-trigger" className={sel} value={w.trigger} onChange={(e) => setW({ ...w, trigger: e.target.value as TriggerKind, conditions: [] })} data-testid="wf-trigger">
            {TRIGGER_KINDS.map((t) => <option key={t} value={t}>{TRIGGERS[t].label}</option>)}
          </select>
        </Field>
        <p className="text-xs text-muted-foreground">{TRIGGERS[w.trigger].hint}</p>
        {w.trigger === "SCHEDULE" && <ScheduleFields prefix="wf-sch" value={w.schedule} onChange={(s) => setW({ ...w, schedule: s })} />}
      </section>

      {w.trigger !== "SCHEDULE" && w.trigger !== "MANUAL" && (
        <section className="space-y-3 rounded-xl border p-3" aria-label="Only if">
          <div className="flex flex-wrap items-center gap-2"><p className="text-sm font-semibold">2. Only if</p>
            {w.conditions.length > 1 && <select aria-label="Match" className="h-8 rounded-md border bg-background px-2 text-sm" value={w.match} onChange={(e) => setW({ ...w, match: e.target.value as "ALL" | "ANY" })}><option value="ALL">all of these hold</option><option value="ANY">any of these holds</option></select>}
          </div>
          {!w.conditions.length && <p className="text-xs text-muted-foreground">No conditions: every event runs it.</p>}
          {w.conditions.map((c, i) => (
            <div key={i} className="grid gap-2 sm:grid-cols-[1fr_10rem_1fr_auto]" data-testid="wf-cond">
              <select aria-label="Value" className={sel} value={c.field} onChange={(e) => setW({ ...w, conditions: w.conditions.map((x, j) => (j === i ? { ...x, field: e.target.value } : x)) })}>{Object.entries(fields).map(([k, f]) => <option key={k} value={k}>{f.label}</option>)}</select>
              <select aria-label="Compare" className={sel} value={c.op} onChange={(e) => setW({ ...w, conditions: w.conditions.map((x, j) => (j === i ? { ...x, op: e.target.value as Op } : x)) })}>{Object.entries(OPS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
              <Input aria-label="Compared with" value={c.value} onChange={(e) => setW({ ...w, conditions: w.conditions.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)) })} data-testid="wf-cond-value" />
              <Button type="button" variant="ghost" size="icon" aria-label="Remove condition" onClick={() => setW({ ...w, conditions: w.conditions.filter((_, j) => j !== i) })}><X className="size-4" /></Button>
            </div>
          ))}
          {w.conditions.length < 10 && <Button type="button" variant="outline" size="sm" onClick={() => setW({ ...w, conditions: [...w.conditions, { field: Object.keys(fields)[0], op: "eq", value: "" }] })} data-testid="wf-add-cond"><Plus className="size-4" /> Add a condition</Button>}
        </section>
      )}

      <section className="space-y-3 rounded-xl border p-3" aria-label="Then">
        <p className="text-sm font-semibold">{w.trigger === "SCHEDULE" || w.trigger === "MANUAL" ? "2" : "3"}. Then, in order</p>
        <p className="text-xs text-muted-foreground">Texts can use the event&apos;s values: <span className="break-words font-mono">{tokens}</span></p>
        {w.steps.map((s, i) => (
          <div key={i} className="space-y-2 rounded-lg border bg-muted/30 p-3" data-testid="wf-step" data-type={s.type}>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="secondary">{i + 1}</Badge>
              <select aria-label={`Step ${i + 1}`} className="h-8 min-w-0 flex-1 rounded-md border bg-background px-2 text-sm" value={s.type} onChange={(e) => setStep(i, blankStep(e.target.value as StepType))}>{STEP_TYPES.map((t) => <option key={t} value={t}>{STEP_LABEL[t]}</option>)}</select>
              <Button type="button" variant="ghost" size="icon" aria-label="Move up" disabled={i === 0} onClick={() => move(i, -1)}><ArrowUp className="size-4" /></Button>
              <Button type="button" variant="ghost" size="icon" aria-label="Move down" disabled={i === w.steps.length - 1} onClick={() => move(i, 1)}><ArrowDown className="size-4" /></Button>
              <Button type="button" variant="ghost" size="icon" aria-label="Remove step" onClick={() => setW({ ...w, steps: w.steps.filter((_, j) => j !== i) })}><Trash2 className="size-4" /></Button>
            </div>
            <StepFields step={s} agents={agents} onChange={(x) => setStep(i, x)} n={i} />
          </div>
        ))}
        {w.steps.length < 10 && (
          <div className="flex flex-wrap gap-2">{(["NOTIFY", "TASK", "AGENT", "APPROVAL", "WAIT", "WEBHOOK", "REPORT"] as StepType[]).map((t) => (
            <Button key={t} type="button" variant="outline" size="sm" onClick={() => setW({ ...w, steps: [...w.steps, blankStep(t)] })} data-testid={`wf-add-${t}`}><Plus className="size-4" /> {STEP_LABEL[t]}</Button>
          ))}</div>
        )}
      </section>

      <Field label="Safety brake: most runs per day" className="sm:w-64" htmlFor="wf-max"><Input id="wf-max" type="number" min={1} max={1000} value={w.maxRunsPerDay} onChange={(e) => setW({ ...w, maxRunsPerDay: Number(e.target.value) })} /></Field>

      <div className="flex flex-wrap items-center gap-3">
        {canEdit && <Button type="button" disabled={pending} onClick={() => run(() => saveWorkflowAction({ id, input: input() }), (d) => { if (!id) router.push(`/admin/ai/automation/${(d as { id: string }).id}`); }, "Saved")} data-testid="wf-save"><Spin on={pending} icon={Save} /> Save</Button>}
        <Button type="button" variant="outline" disabled={pending} onClick={() => run(() => testWorkflowAction({ input: input() }), (d) => setTest(d as TestResult))} data-testid="wf-test"><FlaskConical className="size-4" /> Test (changes nothing)</Button>
        <Msg error={error} done={done} />
      </div>
      {test && (
        <div className="space-y-2 rounded-xl border p-3" data-testid="wf-test-result">
          <p className="text-sm font-medium">{test.sample ? "No recent events of this kind — tested on an example:" : `Tested on the ${test.events.length} latest event${test.events.length === 1 ? "" : "s"}:`}</p>
          <ul className="space-y-2">{test.events.map((e, i) => (
            <li key={i} className="rounded-lg bg-muted/40 p-2 text-sm" data-testid="wf-test-event" data-matched={e.matched}>
              <p className="break-words text-xs text-muted-foreground">{Object.entries(e.payload).map(([k, v]) => `${k}: ${v}`).join(" · ")}</p>
              {e.matched ? <ol className="ml-5 list-decimal">{e.steps.map((s, j) => <li key={j} className="break-words">{s}</li>)}</ol> : <p className="text-muted-foreground">Conditions don&apos;t hold — it would not run.</p>}
            </li>
          ))}</ul>
        </div>
      )}
    </fieldset>
  );
}

function StepFields({ step: s, agents, onChange, n }: { step: Step; agents: { id: string; name: string }[]; onChange: (s: Step) => void; n: number }) {
  const group = (g: StaffGroup, set: (g: StaffGroup) => void, label = "Who") => (
    <Field label={label} htmlFor={`st-${n}-group`}><select id={`st-${n}-group`} className={sel} value={g} onChange={(e) => set(e.target.value as StaffGroup)}>{Object.entries(STAFF_GROUPS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
  );
  switch (s.type) {
    case "NOTIFY": return (
      <div className="grid gap-2 md:grid-cols-2">
        {group(s.group, (g) => onChange({ ...s, group: g }))}
        <Field label="Title" htmlFor={`st-${n}-title`}><Input id={`st-${n}-title`} value={s.title} onChange={(e) => onChange({ ...s, title: e.target.value })} data-testid="st-title" /></Field>
        <Field label="Message" className="md:col-span-2" htmlFor={`st-${n}-body`}><textarea id={`st-${n}-body`} className={area} value={s.body} onChange={(e) => onChange({ ...s, body: e.target.value })} /></Field>
      </div>
    );
    case "TASK": return (
      <div className="grid gap-2 md:grid-cols-[1fr_8rem]">
        <Field label="Task" htmlFor={`st-${n}-title`}><Input id={`st-${n}-title`} value={s.title} onChange={(e) => onChange({ ...s, title: e.target.value })} data-testid="st-title" /></Field>
        <Field label="Due in (days)" htmlFor={`st-${n}-due`}><Input id={`st-${n}-due`} type="number" min={0} max={30} value={s.dueDays} onChange={(e) => onChange({ ...s, dueDays: Number(e.target.value) })} /></Field>
        <Field label="Notes" className="md:col-span-2" htmlFor={`st-${n}-notes`}><textarea id={`st-${n}-notes`} className={area} value={s.notes} onChange={(e) => onChange({ ...s, notes: e.target.value })} /></Field>
        <p className="text-xs text-muted-foreground md:col-span-2">For the company of the event, assigned to its account manager (or the automation&apos;s owner).</p>
      </div>
    );
    case "AGENT": return (
      <div className="grid gap-2">
        <Field label="Agent" htmlFor={`st-${n}-agent`}><select id={`st-${n}-agent`} className={sel} value={s.agentId} onChange={(e) => onChange({ ...s, agentId: e.target.value })} data-testid="st-agent"><option value="">Choose…</option>{agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></Field>
        <Field label="Task for the agent" htmlFor={`st-${n}-task`}><textarea id={`st-${n}-task`} className={area} value={s.task} onChange={(e) => onChange({ ...s, task: e.target.value })} data-testid="st-task" /></Field>
        <p className="text-xs text-muted-foreground">The agent also gets the event&apos;s values. Its proposals go to the approval queue as usual.</p>
      </div>
    );
    case "APPROVAL": return (
      <div className="grid gap-2 md:grid-cols-2">
        <Field label="Question" htmlFor={`st-${n}-title`}><Input id={`st-${n}-title`} value={s.title} onChange={(e) => onChange({ ...s, title: e.target.value })} data-testid="st-title" /></Field>
        {group(s.group, (g) => onChange({ ...s, group: g }), "Who may approve")}
        <p className="text-xs text-muted-foreground md:col-span-2">The run waits here. Approved → the next steps run; rejected or not decided in time → it stops.</p>
      </div>
    );
    case "WAIT": return <Field label="Hours" className="sm:w-40" htmlFor={`st-${n}-hours`}><Input id={`st-${n}-hours`} type="number" min={1} max={720} value={s.hours} onChange={(e) => onChange({ ...s, hours: Number(e.target.value) })} /></Field>;
    case "WEBHOOK": return (
      <div className="space-y-1"><Field label="Address (https://…)" htmlFor={`st-${n}-url`}><Input id={`st-${n}-url`} value={s.url} onChange={(e) => onChange({ ...s, url: e.target.value })} placeholder="https://hooks.example.com/firingi" /></Field>
        <p className="text-xs text-muted-foreground">FIRINGI POSTs the event as JSON (Slack, Teams, Zapier, your own system).</p></div>
    );
    case "REPORT": return (
      <div className="grid gap-2 sm:grid-cols-2">
        <Field label="Report" htmlFor={`st-${n}-kind`}><select id={`st-${n}-kind`} className={sel} value={s.kind} onChange={(e) => onChange({ ...s, kind: e.target.value as typeof s.kind })}>{REPORTS.map((r) => <option key={r} value={r}>{REPORT_LABEL[r]}</option>)}</select></Field>
        <Field label="Period (days)" htmlFor={`st-${n}-days`}><Input id={`st-${n}-days`} type="number" min={1} max={90} value={s.days} onChange={(e) => onChange({ ...s, days: Number(e.target.value) })} /></Field>
      </div>
    );
  }
}

export function WorkflowControls({ id, active, manual, canEdit }: { id: string; active: boolean; manual: boolean; canEdit: boolean }) {
  const router = useRouter();
  const { pending, error, done, run } = useRun();
  if (!canEdit) return null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button size="sm" variant={active ? "outline" : "default"} disabled={pending} onClick={() => run(() => setWorkflowActiveAction({ id, active: !active }), undefined, active ? "Switched off" : "Switched on")} data-testid="wf-toggle">
        {active ? <Pause className="size-4" /> : <Play className="size-4" />} {active ? "Switch off" : "Switch on"}
      </Button>
      <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => runWorkflowNowAction({ id }), undefined, manual ? "Ran" : "Ran on the latest matching event")} data-testid="wf-run"><Play className="size-4" /> Run now</Button>
      <Button size="sm" variant="ghost" disabled={pending} onClick={() => { if (confirm("Delete this automation and its history?")) run(() => deleteWorkflowAction({ id }), () => router.push("/admin/ai/automation")); }} data-testid="wf-delete"><Trash2 className="size-4" /> Delete</Button>
      <Msg error={error} done={done} />
    </div>
  );
}

export function WorkflowToggle({ id, active }: { id: string; active: boolean }) {
  const { pending, error, run } = useRun();
  return (
    <span className="inline-flex items-center gap-2">
      <label className="inline-flex cursor-pointer items-center gap-2 text-xs">
        <input type="checkbox" className="size-4" checked={active} disabled={pending} onChange={(e) => run(() => setWorkflowActiveAction({ id, active: e.target.checked }))} data-testid="wf-row-toggle" aria-label={active ? "Switch off" : "Switch on"} />
        {active ? "On" : "Off"}
      </label>
      {error && <span className="text-xs text-destructive">{error}</span>}
    </span>
  );
}

export function CancelRun({ id }: { id: string }) {
  const { pending, error, run } = useRun();
  return <span><Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => cancelRunAction({ id }))}><X className="size-4" /> Cancel</Button>{error && <span className="text-xs text-destructive">{error}</span>}</span>;
}

// ── approvals ───────────────────────────────────────────────────────────────

export function ApprovalButtons({ id }: { id: string }) {
  const { pending, error, done, run } = useRun();
  const [note, setNote] = useState("");
  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="ap-buttons">
      <Input className="h-8 w-full min-w-0 sm:w-56" placeholder="Note (optional)" aria-label="Note" value={note} onChange={(e) => setNote(e.target.value)} />
      <Button size="sm" disabled={pending} onClick={() => run(() => decideAiApprovalAction({ id, approve: true, note }), undefined, "Approved")} data-testid="ap-approve"><Spin on={pending} icon={Check} /> Approve</Button>
      <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => decideAiApprovalAction({ id, approve: false, note }), undefined, "Rejected")} data-testid="ap-reject"><X className="size-4" /> Reject</Button>
      <Msg error={error} done={done} />
    </div>
  );
}

// ── agents ──────────────────────────────────────────────────────────────────

export type AgentDraft = {
  name: string; role: string; instructions: string; icon: (typeof AGENT_ICONS)[number]; tone: (typeof AGENT_TONES)[number]; tools: string[]; dataAreas: DataArea[];
  autonomy: Autonomy; model: ModelChoice; effort: Effort; maxRunsPerDay: number; active: boolean; schedule: Schedule | null; scheduleTask: string | null; template?: string | null;
};

export function AgentEditor({ id, initial, canEdit, autoActions }: { id: string | null; initial: AgentDraft; canEdit: boolean; autoActions: string[] }) {
  const router = useRouter();
  const { pending, error, done, run } = useRun();
  const [a, setA] = useState(initial);
  const toggle = (list: string[], x: string, on: boolean) => (on ? [...new Set([...list, x])] : list.filter((y) => y !== x));
  const needs = (t: string) => AGENT_TOOLS[t].area;
  return (
    <fieldset disabled={!canEdit} className="space-y-6" data-testid="ag-editor">
      <div className="grid gap-3 md:grid-cols-2">
        <Field label="Name" htmlFor="ag-name"><Input id="ag-name" value={a.name} onChange={(e) => setA({ ...a, name: e.target.value })} data-testid="ag-name" /></Field>
        <Field label="Its job, in one line" htmlFor="ag-role"><Input id="ag-role" value={a.role} onChange={(e) => setA({ ...a, role: e.target.value })} data-testid="ag-role" /></Field>
        <Field label="Look" htmlFor="ag-icon">
          <div className="flex gap-2"><select id="ag-icon" className={sel} value={a.icon} onChange={(e) => setA({ ...a, icon: e.target.value as AgentDraft["icon"] })}>{AGENT_ICONS.map((i) => <option key={i} value={i}>{i}</option>)}</select>
            <select aria-label="Colour" className={sel} value={a.tone} onChange={(e) => setA({ ...a, tone: e.target.value as AgentDraft["tone"] })}>{AGENT_TONES.map((t) => <option key={t} value={t}>{t.replace("tone-", "")}</option>)}</select></div>
        </Field>
        <Box checked={a.active} onChange={(b) => setA({ ...a, active: b })} testid="ag-active">Active (runs on its schedule and from automations)</Box>
      </div>
      <Field label="Instructions — what it does, what to look at, what good output looks like" htmlFor="ag-instr"><textarea id="ag-instr" className={`${area} min-h-40`} value={a.instructions} onChange={(e) => setA({ ...a, instructions: e.target.value })} data-testid="ag-instructions" /></Field>

      <section className="space-y-3 rounded-xl border p-3" aria-label="Tools">
        <p className="text-sm font-semibold">Tools</p>
        <div className="grid gap-2 md:grid-cols-2">{AGENT_TOOL_NAMES.map((t) => {
          const d = AGENT_TOOLS[t], lacks = d.area && !a.dataAreas.includes(d.area);
          return (
            <Box key={t} checked={a.tools.includes(t)} onChange={(b) => setA({ ...a, tools: toggle(a.tools, t, b) })} testid={`ag-tool-${t}`}>
              <span className="font-medium">{d.label}</span> {d.kind === "ACT" && <Badge variant="warning" className="ml-1">acts</Badge>}
              <span className="block text-xs text-muted-foreground">{d.hint}{lacks && a.tools.includes(t) ? ` — needs “${DATA_AREAS[needs(t)!].label}” below` : ""}</span>
            </Box>
          );
        })}</div>
      </section>

      <section className="space-y-3 rounded-xl border p-3" aria-label="Permissions">
        <p className="text-sm font-semibold">Permissions</p>
        <p className="text-xs text-muted-foreground">The data it may read. A run never sees more than the person it runs for (its owner for schedules and automations).</p>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{DATA_AREA_KEYS.map((k) => <Box key={k} checked={a.dataAreas.includes(k)} onChange={(b) => setA({ ...a, dataAreas: toggle(a.dataAreas, k, b) as DataArea[] })} testid={`ag-area-${k}`}>{DATA_AREAS[k].label}</Box>)}</div>
        <Field label="How freely it may act" htmlFor="ag-auto">
          <select id="ag-auto" className={sel} value={a.autonomy} onChange={(e) => setA({ ...a, autonomy: e.target.value as Autonomy })} data-testid="ag-autonomy">{(Object.keys(AUTONOMY) as Autonomy[]).map((k) => <option key={k} value={k}>{AUTONOMY[k].label}</option>)}</select>
        </Field>
        <p className="text-xs text-muted-foreground">{AUTONOMY[a.autonomy].hint}{a.autonomy === "AUTO" ? ` Allowed now: ${autoActions.map((x) => AGENT_TOOLS[x]?.label).join(", ") || "nothing"}.` : ""}</p>
      </section>

      <section className="space-y-3 rounded-xl border p-3" aria-label="Model and schedule">
        <p className="text-sm font-semibold">Model &amp; schedule</p>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Model" htmlFor="ag-model"><select id="ag-model" className={sel} value={a.model} onChange={(e) => setA({ ...a, model: e.target.value as ModelChoice })}><option value="default">Default (AI Governance)</option>{AI_MODELS.map((m) => <option key={m} value={m}>{AI_MODEL_LABEL[m]}</option>)}</select></Field>
          <Field label="Effort" htmlFor="ag-effort"><select id="ag-effort" className={sel} value={a.effort} onChange={(e) => setA({ ...a, effort: e.target.value as Effort })}>{EFFORTS.map((x) => <option key={x} value={x}>{x}</option>)}</select></Field>
          <Field label="Most runs per day" htmlFor="ag-max"><Input id="ag-max" type="number" min={1} max={500} value={a.maxRunsPerDay} onChange={(e) => setA({ ...a, maxRunsPerDay: Number(e.target.value) })} /></Field>
        </div>
        <Box checked={!!a.schedule} onChange={(b) => setA({ ...a, schedule: b ? a.schedule ?? DEFAULT_SCHEDULE : null })} testid="ag-scheduled">Runs on a schedule</Box>
        {a.schedule && <>
          <ScheduleFields prefix="ag-sch" value={a.schedule} onChange={(s) => setA({ ...a, schedule: s })} />
          <Field label="Task each time" htmlFor="ag-task"><textarea id="ag-task" className={area} value={a.scheduleTask ?? ""} onChange={(e) => setA({ ...a, scheduleTask: e.target.value })} /></Field>
          <p className="text-xs text-muted-foreground">Runs {scheduleText(a.schedule)}.</p>
        </>}
      </section>

      {canEdit && (
        <div className="flex flex-wrap items-center gap-3">
          <Button type="button" disabled={pending} onClick={() => run(() => saveAgentAction({ id, input: a }), (d) => { if (!id) router.push(`/admin/ai/agents/${(d as { id: string }).id}`); }, "Saved")} data-testid="ag-save"><Spin on={pending} icon={Save} /> Save agent</Button>
          {id && <Button type="button" variant="ghost" disabled={pending} onClick={() => { if (confirm("Delete this agent and its runs?")) run(() => deleteAgentAction({ id }), () => router.push("/admin/ai/agents")); }}><Trash2 className="size-4" /> Delete</Button>}
          <Msg error={error} done={done} />
        </div>
      )}
      {a.autonomy !== "SUGGEST" && !a.tools.some((t) => ACT_TOOLS.includes(t)) && <p className="text-xs text-muted-foreground">Tip: give it an acting tool (follow-up task, notify staff), or set it to “Report only”.</p>}
    </fieldset>
  );
}

export function AgentRunBox({ id, defaultTask, canRun }: { id: string; defaultTask: string; canRun: boolean }) {
  const { pending, error, done, run } = useRun();
  const [task, setTask] = useState(defaultTask);
  if (!canRun) return <p className="text-sm text-muted-foreground">Running agents needs the AI agents or AI approvals right.</p>;
  return (
    <div className="space-y-2" data-testid="ag-runbox">
      <Label htmlFor="ag-run-task">Task</Label>
      <textarea id="ag-run-task" className={area} value={task} onChange={(e) => setTask(e.target.value)} data-testid="ag-run-task" />
      <div className="flex flex-wrap items-center gap-3">
        <Button disabled={pending} onClick={() => run(() => runAgentAction({ id, task }), (d) => { const r = d as { status: string; error?: string | null }; if (r.status !== "DONE") alert(`The agent didn't run: ${r.error ?? r.status}`); }, "Finished — see the run below")} data-testid="ag-run"><Spin on={pending} icon={Play} /> {pending ? "Working…" : "Run now"}</Button>
        <Msg error={error} done={done} />
      </div>
    </div>
  );
}

export function AgentToggle({ id, active }: { id: string; active: boolean }) {
  const { pending, error, run } = useRun();
  return <span><Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => setAgentActiveAction({ id, active: !active }))} data-testid="ag-toggle">{active ? <Pause className="size-4" /> : <Play className="size-4" />} {active ? "Pause" : "Switch on"}</Button>{error && <span className="ml-2 text-xs text-destructive">{error}</span>}</span>;
}

export function RateRun({ id, rating }: { id: string; rating: number | null }) {
  const { pending, run } = useRun();
  return (
    <span className="inline-flex gap-1" data-testid="ag-rate">
      <Button size="icon" variant={rating === 1 ? "default" : "ghost"} aria-label="Useful" disabled={pending} onClick={() => run(() => rateAgentRunAction({ id, rating: rating === 1 ? 0 : 1 }))}><ThumbsUp className="size-4" /></Button>
      <Button size="icon" variant={rating === -1 ? "destructive" : "ghost"} aria-label="Not useful" disabled={pending} onClick={() => run(() => rateAgentRunAction({ id, rating: rating === -1 ? 0 : -1 }))}><ThumbsDown className="size-4" /></Button>
    </span>
  );
}

// ── governance ──────────────────────────────────────────────────────────────

export function GovernanceForm({ value, canSave, section }: { value: Governance; canSave: boolean; section: "OVERVIEW" | "APPROVALS" | "MODELS" }) {
  const { pending, error, done, run } = useRun();
  const [g, setG] = useState(value);
  const num = (k: "monthlyTokens" | "alertPct" | "approvalHours" | "agentRunsPerDay" | "retentionDays" | "pricePerMTokIn" | "pricePerMTokOut", label: string, step = "1") => (
    <Field label={label} className="sm:w-56" htmlFor={`gov-${k}`}><Input id={`gov-${k}`} type="number" step={step} min={0} value={g[k]} onChange={(e) => setG({ ...g, [k]: Number(e.target.value) })} data-testid={`gov-${k}`} /></Field>
  );
  const model = (k: keyof Governance["models"], label: string) => (
    <Field label={label} htmlFor={`gov-m-${k}`}><select id={`gov-m-${k}`} className={sel} value={g.models[k]} onChange={(e) => setG({ ...g, models: { ...g.models, [k]: e.target.value as ModelChoice } })} data-testid={`gov-model-${k}`}><option value="default">Default model</option>{AI_MODELS.map((m) => <option key={m} value={m}>{AI_MODEL_LABEL[m]}</option>)}</select></Field>
  );
  return (
    <fieldset disabled={!canSave} className="space-y-5" data-testid={`gov-form-${section}`}>
      {section === "OVERVIEW" && <>
        <div className="space-y-2">
          <Box checked={g.enabled} onChange={(b) => setG({ ...g, enabled: b })} testid="gov-enabled"><b>AI on</b> — every call to Claude: assistant, WhatsApp ordering, agents, Claude-written reports. Off stops them all at once.</Box>
          <Box checked={g.agents} onChange={(b) => setG({ ...g, agents: b })} testid="gov-agents"><b>AI agents</b> may run</Box>
          <Box checked={g.automation} onChange={(b) => setG({ ...g, automation: b })} testid="gov-automation"><b>Automation</b> — workflows pick up events and schedules</Box>
          <Box checked={g.redact} onChange={(b) => setG({ ...g, redact: b })} testid="gov-redact">Remove emails, phone numbers and IBANs from what agents send to Claude</Box>
        </div>
        <div className="flex flex-wrap gap-4">
          {num("monthlyTokens", "Monthly token budget (0 = no limit)")}
          <Field label="When it is used up, stop" className="sm:w-56" htmlFor="gov-stops"><select id="gov-stops" className={sel} value={g.budgetStops} onChange={(e) => setG({ ...g, budgetStops: e.target.value as "AGENTS" | "ALL" })}><option value="AGENTS">AI agents only</option><option value="ALL">Every Claude call</option></select></Field>
          {num("alertPct", "Warn at (% of the budget)")}
          {num("agentRunsPerDay", "All agents: most runs per day")}
          {num("retentionDays", "Keep AI records (days)")}
        </div>
      </>}
      {section === "APPROVALS" && <>
        <p className="text-sm">Agents set to <b>act on their own</b> may do these without a person; everything else waits in the approval queue:</p>
        <div className="flex flex-wrap gap-4">{ACT_TOOLS.map((t) => <Box key={t} checked={g.autoActions.includes(t)} onChange={(b) => setG({ ...g, autoActions: b ? [...g.autoActions, t] : g.autoActions.filter((x) => x !== t) })} testid={`gov-auto-${t}`}>{AGENT_TOOLS[t].label}</Box>)}</div>
        <div className="flex flex-wrap gap-4">{num("approvalHours", "A proposal expires after (hours)")}</div>
      </>}
      {section === "MODELS" && <>
        <div className="grid gap-3 sm:grid-cols-3">{model("assistant", "AI Assistant & WhatsApp")}{model("agents", "AI agents (each can choose its own)")}{model("reports", "Report summaries")}</div>
        <p className="text-xs text-muted-foreground">“Default model” is the one set in AI Assistant settings.</p>
        <div className="flex flex-wrap gap-4">{num("pricePerMTokIn", "€ per million input tokens (for cost estimates)", "0.01")}{num("pricePerMTokOut", "€ per million output tokens", "0.01")}</div>
      </>}
      {canSave && (
        <div className="flex flex-wrap items-center gap-3">
          <Button disabled={pending} onClick={() => run(() => saveGovernanceAction({ ...g, autoActions: g.autoActions as ("create_task" | "notify_staff")[] }), undefined, "Saved")} data-testid="gov-save"><Spin on={pending} icon={Save} /> Save</Button>
          <Msg error={error} done={done} />
        </div>
      )}
    </fieldset>
  );
}
