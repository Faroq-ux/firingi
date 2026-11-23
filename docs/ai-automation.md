# AI Centre: Automation, AI Agents, AI Governance (Phase 67)

Three more sections of FIRINGI's AI Centre (back office, English). **AI still only acts within limits a person set**: every agent action waits for approval unless the agent may act on its own *and* AI Governance allows that action; every automation can stop for a person's approval; one switch stops every call to Claude.

| Section | Address | What it does |
| --- | --- | --- |
| **Automation** | `/admin/ai/automation?tab=` | Workflows, Rules (each automation in one sentence + templates), Approvals (the queue), Schedules, Execution logs |
| **AI Agents** | `/admin/ai/agents?tab=` | Agents (cards), Performance, Templates; each agent: Run & history, Settings & permissions, Performance |
| **AI Governance** | `/admin/ai/governance?tab=` | Overview & switches, Approvals (policy + decisions), Permissions, Audit trail (+ CSV), Models & budget |

The old *AI Activity Log* (`/admin/ai/activity-log`) is now the Audit trail and redirects there. The AI Dashboard shows four more tiles: actions waiting for approval, automations on, agents active, tokens this month.

## Rights

| Right | Lets a person |
| --- | --- |
| `admin.ai.view` | Open the AI Centre (see automations, agents, governance, the audit trail) |
| `admin.ai.automate` | Build, change, switch on/off and run automations |
| `admin.ai.agents` | Create, change and run AI agents |
| `admin.ai.approve` | Decide what agents propose (approval steps of automations name their own group) |
| `admin.ai.govern` | Change AI Governance |

Super Admin holds them all. Other roles get them in *Users & Permissions › Roles*; *AI Governance › Permissions* shows who holds what.

## Automation

A workflow = **when** (trigger) + **only if** (conditions) + **then** (steps in order).

**Triggers**

| Trigger | Values the conditions and texts can use |
| --- | --- |
| An order is placed | `number`, `total` (€ excl. VAT), `buyer`, `supplier`, `country`, `via` |
| An order is held for a fraud check | `number`, `score`, `level`, `buyer`, `total` |
| A customer's invoices are overdue | `buyer`, `open` (€), `invoices`, `daysLate`, `oldestDue` |
| A delivery fails | `number`, `reason`, `supplier` |
| A quality claim is opened | `number`, `reason`, `buyer`, `supplier` |
| A support request is opened | `number`, `subject`, `category`, `priority`, `company` |
| A company registers | `name`, `type`, `country` |
| The AI makes a new suggestion | `title`, `kind`, `area`, `score` |
| On a schedule | hourly, daily, Monday–Friday, weekly, monthly (UTC) |
| Only when started by hand | — |

Events are read from FIRINGI's own tables after the workflow's cursor — switching a workflow on starts from that moment (history doesn't fire). Each event runs a workflow **once**. Overdue customers fire again only when a new oldest unpaid due date appears.

**Conditions**: is / is not / more than / at least / less than / at most / contains, on any value; all or any.

**Steps** (texts can use `{{value}}`):

| Step | Does |
| --- | --- |
| Notify staff | In-app message (and email / push as each person chose) to a staff group: AI Centre users, approvers, finance, order desk, risk, delivery, supplier managers, sales & CRM, support, onboarding |
| Create a follow-up task | CRM task for the event's company, assigned to its account manager (or the owner) |
| Ask an AI agent | Runs an agent with a task and the event's values; its proposals go to the queue |
| Wait for a person's approval | The run waits; approved → the next steps run, rejected or expired → it stops |
| Wait | N hours, then the next steps |
| Send to another system | POST of the event as JSON (Slack, Teams, Zapier, your own system); public addresses only |
| Make an AI report | One of the seven AI reports |

Steps run with the rights of the workflow's **owner** (who created it). **Test** shows what would happen on the latest events (or an example) and changes nothing. **Run now** runs a by-hand / scheduled workflow, or an event workflow on its latest matching event. A safety brake limits runs per day. Every run is logged step by step (*Execution logs*); waiting runs can be cancelled.

Templates: big order alert, chase overdue customers (with finance approval), fraud hold → risk team, failed delivery follow-up, new registration → onboarding, stock running out → Stock Watcher agent, Monday executive report.

## AI Agents

FIRINGI's team creates its own specialist agents (or starts from a template: Sales Analyst, Credit Controller, Stock Watcher, Route Planner, Supplier Quality).

Each agent has:
- **Job & instructions** — what it does, what to look at, what good output looks like.
- **Tools** — read: sales summary, top lists, orders, demand forecast, stock outlook, reorder timing, supplier alternatives, supplier scorecards, margin opportunities, profit & loss, overdue customers, delivery risk, AI suggestions, find a company; act: create a follow-up task, notify staff.
- **Permissions** — the data areas it may read (orders & sales, finance, stock, customers & CRM, suppliers, delivery). A run reads with the rights of the person it runs for (its owner for schedules and automations), **narrowed** to these areas.
- **How freely it acts** — *report only* (no acting tools), *propose, a person approves* (every action waits in the queue), *act on its own within limits* (actions AI Governance allows run at once; others wait).
- **Model & effort**, **most runs per day**, **schedule** with its task, **active / paused**.

Running: *Run now* on the agent's page (needs the agents or approvals right), its schedule, or an automation step. Each run keeps its report, the tools it used (and what went for approval), model, time and tokens; people rate reports 👍 / 👎.

Performance (30 days): runs, success, failed / blocked, average time, proposals, share approved, ratings, tokens, estimated cost.

Without an API key the agents don't run (*blocked: Claude isn't connected*). For development and browser tests `ASSISTANT_SIMULATE=1` uses a rule-based stand-in (never in production).

## Approvals

One queue (*Automation › Approvals*) for agents' proposals and automations' approval steps: what, why, from which agent or automation, when it expires. Approving runs the action **with the approver's rights**. Not decided within the approval time (AI Governance, default 72 h) → expired. Decisions are in *AI Governance › Approvals* and the audit trail.

## AI Governance

- **Switches** — AI on (every call to Claude: assistant, WhatsApp ordering, agents, Claude-written report summaries), AI agents, Automation. Suggestions, forecasts and reports that don't use Claude keep working.
- **Budget** — monthly tokens for all of FIRINGI (0 = no limit); when used up stop agents only or every Claude call; a warning at a set % and at 100% to the governors.
- **Models** — the default model (AI Assistant settings) and a model per feature (assistant & WhatsApp, agents, report summaries); each agent can choose its own. Use by model for 30 days; € per million tokens for cost estimates.
- **Approvals** — what agents that act on their own may do without a person; approval expiry.
- **Data** — emails, phone numbers and IBANs are removed from what agents send to Claude; AI records kept N days (activity, agent runs, finished workflow runs, decided approvals).
- **Permissions** — who holds each AI right, what each agent may read, the customer / supplier Assistant switches.
- **Audit trail** — every AI action and every change to automations, agents and governance: who, when, model, tokens; filter by kind, dates, text; CSV (`/api/admin/ai/audit`).

## Background job

`/api/cron/automation` every 5 minutes: new events → runs, schedules due, waits that are over, expired approvals, scheduled agents, the budget alert; once a day old AI records past the retention period are removed.

The production scheduler (`scripts/ops/scheduler.mjs`) now calls **every** job that has an endpoint — 21 jobs added in phases 41–66 were missing from it (a unit test now checks this).

## Code

- `src/lib/ai-ops.ts` — triggers, conditions, steps, schedules, agent tools / templates, governance defaults (shared with the forms)
- `src/server/ai/ops/` — `workflows.ts` (engine + job), `events.ts`, `agents.ts` (agents, runs, approvals), `agent-tools.ts`, `agent-sim.ts`, `governance.ts`, `notify.ts`, `schema.ts`
- `src/server/actions/ai-ops.ts`, `src/components/ai/ops.tsx`, pages under `src/app/admin/ai/{automation,agents,governance}`
- Tests: `tests/unit/ai-ops.test.ts`, `tests/integration/ai-ops.test.ts`, `tests/e2e/ai-ops.mjs`
