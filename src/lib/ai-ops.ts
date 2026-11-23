/**
 * AI Centre, Phase 67 — Automation, AI Agents and AI Governance: the shared vocabulary (triggers,
 * conditions, steps, agent tools, schedules, governance defaults) and the pure helpers used by the
 * server and the forms. No server imports here.
 */
import { AI_MODELS, type AiModel } from "./ai";
import { REPORTS, type ReportKind } from "./ai-centre";

// ── triggers ────────────────────────────────────────────────────────────────

export type FieldType = "number" | "text";
export type TriggerDef = { label: string; hint: string; fields: Record<string, { label: string; type: FieldType }>; sample: Record<string, string | number> };

export const TRIGGERS = {
  ORDER_PLACED: {
    label: "An order is placed", hint: "Each new order, once.",
    fields: { number: { label: "Order number", type: "text" }, total: { label: "Order total (€, excl. VAT)", type: "number" }, buyer: { label: "Customer", type: "text" }, supplier: { label: "Supplier", type: "text" }, country: { label: "Country (code)", type: "text" }, via: { label: "Placed via (WEB, APP, WHATSAPP…)", type: "text" } },
    sample: { number: "ORD-2026-000123", total: 6200, buyer: "Kebab House", supplier: "Lisboa Central", country: "PT", via: "WEB" },
  },
  ORDER_HELD: {
    label: "An order is held for a fraud check", hint: "The risk engine stopped an order at checkout.",
    fields: { number: { label: "Order number", type: "text" }, score: { label: "Risk score (0–100)", type: "number" }, level: { label: "Risk level", type: "text" }, buyer: { label: "Customer", type: "text" }, total: { label: "Order total (€)", type: "number" } },
    sample: { number: "ORD-2026-000124", score: 82, level: "HIGH", buyer: "New Bistro", total: 4100 },
  },
  INVOICE_OVERDUE: {
    label: "A customer's invoices are overdue", hint: "Once per customer each time a new oldest unpaid due date appears.",
    fields: { buyer: { label: "Customer", type: "text" }, open: { label: "Overdue amount (€)", type: "number" }, invoices: { label: "Overdue invoices", type: "number" }, daysLate: { label: "Days late (oldest)", type: "number" }, oldestDue: { label: "Oldest due date", type: "text" } },
    sample: { buyer: "Kebab House", open: 1840.5, invoices: 3, daysLate: 16, oldestDue: "2026-11-07" },
  },
  DELIVERY_FAILED: {
    label: "A delivery fails", hint: "A driver records a failed attempt.",
    fields: { number: { label: "Order number", type: "text" }, reason: { label: "Reason", type: "text" }, supplier: { label: "Delivering company", type: "text" } },
    sample: { number: "ORD-2026-000101", reason: "Customer closed", supplier: "Lisboa Central" },
  },
  CLAIM_OPENED: {
    label: "A quality claim is opened", hint: "A customer reports a problem with delivered goods.",
    fields: { number: { label: "Claim number", type: "text" }, reason: { label: "Reason", type: "text" }, buyer: { label: "Customer", type: "text" }, supplier: { label: "Supplier", type: "text" } },
    sample: { number: "CLM-2026-00012", reason: "DAMAGED", buyer: "Kebab House", supplier: "Lisboa Central" },
  },
  TICKET_OPENED: {
    label: "A support request is opened", hint: "From a customer, supplier or driver.",
    fields: { number: { label: "Request number", type: "text" }, subject: { label: "Subject", type: "text" }, category: { label: "Category", type: "text" }, priority: { label: "Priority", type: "text" }, company: { label: "Company", type: "text" } },
    sample: { number: "SUP-2026-00031", subject: "Missing crates", category: "DELIVERY", priority: "HIGH", company: "Kebab House" },
  },
  COMPANY_REGISTERED: {
    label: "A company registers", hint: "A new customer or supplier signs up (waiting for approval).",
    fields: { name: { label: "Company", type: "text" }, type: { label: "Type (CUSTOMER, WHOLESALER, DISTRIBUTOR)", type: "text" }, country: { label: "Country (code)", type: "text" } },
    sample: { name: "Café Central", type: "CUSTOMER", country: "PT" },
  },
  AI_SUGGESTION: {
    label: "The AI makes a new suggestion", hint: "A new suggestion for FIRINGI staff (Recommendations).",
    fields: { title: { label: "Suggestion", type: "text" }, kind: { label: "Kind (STOCK_OUT, SALES_DROP…)", type: "text" }, area: { label: "Area (SALES, STOCK, ROUTES…)", type: "text" }, score: { label: "Importance (0–100)", type: "number" } },
    sample: { title: "Olive oil 5 L runs out in 2 days", kind: "STOCK_OUT", area: "STOCK", score: 85 },
  },
  SERVICE_REQUESTED: {
    label: "A service is requested", hint: "A customer (or its full used-oil containers) asks for a collection / visit.",
    fields: { number: { label: "Visit number", type: "text" }, service: { label: "Service", type: "text" }, customer: { label: "Customer", type: "text" }, date: { label: "Date", type: "text" }, reason: { label: "Why (CUSTOMER, CONTAINER_FULL, ASSISTANT)", type: "text" } },
    sample: { number: "SV-2026-000042", service: "Used cooking oil collection", customer: "Kebab House", date: "2026-11-25", reason: "CONTAINER_FULL" },
  },
  SERVICE_MISSED: {
    label: "A service visit is missed", hint: "The provider couldn't do it, or nothing was recorded.",
    fields: { number: { label: "Visit number", type: "text" }, service: { label: "Service", type: "text" }, customer: { label: "Customer", type: "text" }, provider: { label: "Provider", type: "text" }, reason: { label: "Reason", type: "text" } },
    sample: { number: "SV-2026-000040", service: "Used cooking oil collection", customer: "Kebab House", provider: "Lisboa Central", reason: "Closed" },
  },
  SCHEDULE: { label: "On a schedule", hint: "Hourly, daily, weekly or monthly.", fields: { date: { label: "Date", type: "text" } }, sample: { date: "2026-11-23" } },
  MANUAL: { label: "Only when started by hand", hint: "The Run button.", fields: { date: { label: "Date", type: "text" } }, sample: { date: "2026-11-23" } },
} satisfies Record<string, TriggerDef>;
export type TriggerKind = keyof typeof TRIGGERS;
export const TRIGGER_KINDS = Object.keys(TRIGGERS) as TriggerKind[];
export const EVENT_TRIGGERS = TRIGGER_KINDS.filter((t) => t !== "SCHEDULE" && t !== "MANUAL");

// ── conditions ──────────────────────────────────────────────────────────────

export const OPS = { eq: "is", ne: "is not", gt: "is more than", gte: "is at least", lt: "is less than", lte: "is at most", contains: "contains" } as const;
export type Op = keyof typeof OPS;
export type Condition = { field: string; op: Op; value: string };
export type Payload = Record<string, string | number | null | undefined>;

export function conditionHolds(c: Condition, p: Payload): boolean {
  const v = p[c.field];
  if (v === undefined || v === null) return false;
  const nA = Number(v), nB = Number(c.value);
  const numeric = typeof v === "number" || (c.value.trim() !== "" && !Number.isNaN(nA) && !Number.isNaN(nB));
  const a = String(v).toLowerCase(), b = c.value.trim().toLowerCase();
  switch (c.op) {
    case "eq": return numeric ? nA === nB : a === b;
    case "ne": return numeric ? nA !== nB : a !== b;
    case "gt": return numeric && nA > nB;
    case "gte": return numeric && nA >= nB;
    case "lt": return numeric && nA < nB;
    case "lte": return numeric && nA <= nB;
    case "contains": return a.includes(b);
  }
}
export const matches = (conds: Condition[], match: "ALL" | "ANY", p: Payload) => !conds.length || (match === "ALL" ? conds.every((c) => conditionHolds(c, p)) : conds.some((c) => conditionHolds(c, p)));

/** "{{buyer}} owes €{{open}}" → the event's values (unknown names stay visible, so mistakes show). */
export const fill = (text: string, p: Payload) => text.replace(/\{\{\s*(\w+)\s*\}\}/g, (m, k: string) => (p[k] === undefined || p[k] === null ? m : String(p[k])));

// ── schedules ───────────────────────────────────────────────────────────────

export type Schedule = { every: "HOURLY" | "DAILY" | "WEEKDAYS" | "WEEKLY" | "MONTHLY"; hour: number; weekday: number; day: number };
export const DEFAULT_SCHEDULE: Schedule = { every: "DAILY", hour: 7, weekday: 1, day: 1 };
const WD = ["", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
export function scheduleText(s: Schedule) {
  const at = `${String(s.hour).padStart(2, "0")}:00 UTC`;
  switch (s.every) {
    case "HOURLY": return "every hour";
    case "DAILY": return `every day at ${at}`;
    case "WEEKDAYS": return `Monday to Friday at ${at}`;
    case "WEEKLY": return `every ${WD[s.weekday]} at ${at}`;
    case "MONTHLY": return `on day ${s.day} of each month at ${at}`;
  }
}
/** The next time after `from` (UTC). */
export function nextRun(s: Schedule, from: Date): Date {
  const d = new Date(from.getTime());
  if (s.every === "HOURLY") { d.setUTCMinutes(0, 0, 0); d.setUTCHours(d.getUTCHours() + 1); return d; }
  const c = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), s.hour));
  for (let i = 0; i < 400; i++) {
    const t = new Date(c.getTime() + i * 86400_000);
    if (t <= from) continue;
    const wd = ((t.getUTCDay() + 6) % 7) + 1; // 1 = Monday
    if (s.every === "DAILY") return t;
    if (s.every === "WEEKDAYS" && wd <= 5) return t;
    if (s.every === "WEEKLY" && wd === s.weekday) return t;
    if (s.every === "MONTHLY" && t.getUTCDate() === s.day) return t;
  }
  return new Date(from.getTime() + 86400_000);
}

// ── workflow steps ──────────────────────────────────────────────────────────

export const STAFF_GROUPS = {
  "admin.ai.view": "AI Centre users", "admin.ai.approve": "AI approvers", "admin.finance.manage": "Finance team", "admin.orders.manage": "Order desk",
  "admin.risk.manage": "Risk & fraud team", "admin.delivery.manage": "Delivery team", "admin.vendors.approve": "Supplier managers", "admin.crm.manage": "Sales & CRM team",
  "admin.support.manage": "Support team", "admin.customers.approve": "Onboarding (approvals)",
} as const;
export type StaffGroup = keyof typeof STAFF_GROUPS;

export type Step =
  | { type: "NOTIFY"; group: StaffGroup; title: string; body: string }
  | { type: "TASK"; title: string; notes: string; dueDays: number }
  | { type: "AGENT"; agentId: string; task: string }
  | { type: "APPROVAL"; title: string; group: StaffGroup }
  | { type: "WAIT"; hours: number }
  | { type: "WEBHOOK"; url: string }
  | { type: "REPORT"; kind: ReportKind; days: number };
export type StepType = Step["type"];
export const STEP_LABEL: Record<StepType, string> = {
  NOTIFY: "Notify staff", TASK: "Create a follow-up task", AGENT: "Ask an AI agent", APPROVAL: "Wait for a person's approval",
  WAIT: "Wait", WEBHOOK: "Send to another system (webhook)", REPORT: "Make an AI report",
};
export const STEP_TYPES = Object.keys(STEP_LABEL) as StepType[];
export function blankStep(type: StepType): Step {
  switch (type) {
    case "NOTIFY": return { type, group: "admin.ai.view", title: "", body: "" };
    case "TASK": return { type, title: "", notes: "", dueDays: 1 };
    case "AGENT": return { type, agentId: "", task: "" };
    case "APPROVAL": return { type, title: "Continue?", group: "admin.ai.approve" };
    case "WAIT": return { type, hours: 24 };
    case "WEBHOOK": return { type, url: "" };
    case "REPORT": return { type, kind: "EXECUTIVE", days: 7 };
  }
}
export function stepText(s: Step, agentName?: (id: string) => string) {
  switch (s.type) {
    case "NOTIFY": return `notify ${STAFF_GROUPS[s.group] ?? s.group}: “${s.title}”`;
    case "TASK": return `create a follow-up task “${s.title}” (due in ${s.dueDays} day${s.dueDays === 1 ? "" : "s"})`;
    case "AGENT": return `ask ${agentName?.(s.agentId) ?? "an agent"}: “${s.task.slice(0, 80)}”`;
    case "APPROVAL": return `wait for approval by ${STAFF_GROUPS[s.group] ?? s.group}`;
    case "WAIT": return `wait ${s.hours} hour${s.hours === 1 ? "" : "s"}`;
    case "WEBHOOK": return `send to ${safeHost(s.url)}`;
    case "REPORT": return `make the ${s.kind.toLowerCase().replace("_", " ")} report (${s.days} days)`;
  }
}
const safeHost = (u: string) => { try { return new URL(u).host; } catch { return "a webhook"; } };

export function ruleSentence(w: { trigger: string; triggerConfig: unknown; conditions: unknown; match: string; steps: unknown }, agentName?: (id: string) => string) {
  const t = TRIGGERS[w.trigger as TriggerKind];
  const when = w.trigger === "SCHEDULE" ? `Run ${scheduleText({ ...DEFAULT_SCHEDULE, ...((w.triggerConfig as { schedule?: Schedule })?.schedule ?? {}) })}` : w.trigger === "MANUAL" ? "When started by hand" : `When ${t?.label.replace(/^An? /, (x) => x.toLowerCase()) ?? w.trigger}`;
  const conds = ((w.conditions as Condition[]) ?? []).map((c) => `${(t?.fields as Record<string, { label: string }>)?.[c.field]?.label.toLowerCase() ?? c.field} ${OPS[c.op]} ${c.value}`);
  const steps = ((w.steps as Step[]) ?? []).map((s) => stepText(s, agentName));
  return `${when}${conds.length ? ` and ${conds.join(w.match === "ANY" ? " or " : " and ")}` : ""}: ${steps.join(", then ") || "do nothing yet"}.`;
}

export type WorkflowTemplate = { key: string; name: string; description: string; trigger: TriggerKind; schedule?: Schedule; conditions: Condition[]; match: "ALL" | "ANY"; steps: Step[] };
/** Ready-made automations (a staff member adapts and switches them on). AGENT steps are filled in with an agent of that template, when there is one. */
export const WORKFLOW_TEMPLATES: (WorkflowTemplate & { agentTemplate?: string })[] = [
  {
    key: "big-order", name: "Big order alert", description: "Tell the finance team about every order over €5,000.", trigger: "ORDER_PLACED", match: "ALL",
    conditions: [{ field: "total", op: "gt", value: "5000" }],
    steps: [{ type: "NOTIFY", group: "admin.finance.manage", title: "Big order {{number}}: €{{total}}", body: "{{buyer}} ordered €{{total}} (excl. VAT) from {{supplier}}. Check the credit limit and payment terms." }],
  },
  {
    key: "overdue-chase", name: "Chase overdue customers", description: "A call task for the account manager when a customer is 14+ days late; big amounts need finance approval first.", trigger: "INVOICE_OVERDUE", match: "ALL",
    conditions: [{ field: "daysLate", op: "gte", value: "14" }],
    steps: [
      { type: "APPROVAL", title: "Chase {{buyer}} for €{{open}}?", group: "admin.finance.manage" },
      { type: "TASK", title: "Call {{buyer}}: €{{open}} overdue", notes: "{{invoices}} invoices; oldest due {{oldestDue}} ({{daysLate}} days late). Agree a payment date.", dueDays: 1 },
    ],
  },
  {
    key: "fraud-hold", name: "Fraud hold — tell the risk team", description: "Every order the risk engine holds goes straight to the risk team.", trigger: "ORDER_HELD", match: "ALL", conditions: [],
    steps: [{ type: "NOTIFY", group: "admin.risk.manage", title: "Order {{number}} held (risk {{score}})", body: "{{buyer}}, €{{total}}. Review it in Suspicious Orders." }],
  },
  {
    key: "failed-delivery", name: "Failed delivery follow-up", description: "A follow-up task for the customer when a delivery fails.", trigger: "DELIVERY_FAILED", match: "ALL", conditions: [],
    steps: [{ type: "TASK", title: "Rebook delivery of {{number}}", notes: "Failed: {{reason}} (delivered by {{supplier}}). Call the customer and agree a new slot.", dueDays: 0 }],
  },
  {
    key: "new-company", name: "New registration", description: "Tell onboarding when a company signs up.", trigger: "COMPANY_REGISTERED", match: "ALL", conditions: [],
    steps: [{ type: "NOTIFY", group: "admin.customers.approve", title: "New {{type}}: {{name}} ({{country}})", body: "Check the documents and approve or reject the application." }],
  },
  {
    key: "stock-agent", name: "Stock running out → Stock Watcher", description: "When the AI flags an important stock-out, the Stock Watcher agent looks into it.", trigger: "AI_SUGGESTION", match: "ALL",
    conditions: [{ field: "kind", op: "eq", value: "STOCK_OUT" }, { field: "score", op: "gte", value: "80" }],
    steps: [{ type: "AGENT", agentId: "", task: "{{title}}. Who buys it most, how long it lasts, and which supplier could cover?" }], agentTemplate: "stock",
  },
  {
    key: "service-missed", name: "Missed service → call the customer", description: "A follow-up task for the account manager when a service visit is missed.", trigger: "SERVICE_MISSED", match: "ALL", conditions: [],
    steps: [{ type: "TASK", title: "Rebook {{service}} for {{customer}}", notes: "Visit {{number}} missed ({{reason}}), provider {{provider}}. Call and agree a new day.", dueDays: 0 }],
  },
  {
    key: "weekly-report", name: "Monday executive report", description: "The executive report every Monday at 06:00 UTC, and a note to the AI Centre users.", trigger: "SCHEDULE", schedule: { every: "WEEKLY", hour: 6, weekday: 1, day: 1 }, match: "ALL", conditions: [],
    steps: [{ type: "REPORT", kind: "EXECUTIVE", days: 7 }, { type: "NOTIFY", group: "admin.ai.view", title: "This week's executive report is ready", body: "Open AI Reports › Executive." }],
  },
];

// ── agents ──────────────────────────────────────────────────────────────────

/** What an agent may look at (data rights its runs keep; never more than the person running it). */
export const DATA_AREAS = {
  ORDERS: { label: "Orders & sales", perms: ["admin.orders.view", "admin.analytics.view"] },
  FINANCE: { label: "Finance (invoices, payments, profit)", perms: ["admin.finance.view", "admin.invoices.view"] },
  STOCK: { label: "Stock & products", perms: ["admin.inventory.view", "admin.catalogue.view"] },
  CUSTOMERS: { label: "Customers & CRM", perms: ["admin.customers.view", "admin.crm.view"] },
  SUPPLIERS: { label: "Suppliers", perms: ["admin.vendors.view"] },
  DELIVERY: { label: "Delivery & routes", perms: ["admin.delivery.view", "admin.fleet.view"] },
} as const;
export type DataArea = keyof typeof DATA_AREAS;
export const DATA_AREA_KEYS = Object.keys(DATA_AREAS) as DataArea[];

export type AgentToolDef = { label: string; kind: "READ" | "ACT"; hint: string; area?: DataArea };
export const AGENT_TOOLS: Record<string, AgentToolDef> = {
  sales_summary: { label: "Sales summary", kind: "READ", hint: "Orders, sales, average order for a period", area: "ORDERS" },
  breakdown: { label: "Top lists & timelines", kind: "READ", hint: "Top products / suppliers / customers, by week or month", area: "ORDERS" },
  find_orders: { label: "Find orders", kind: "READ", hint: "Orders by status, customer, supplier", area: "ORDERS" },
  demand_forecast: { label: "Demand forecast", kind: "READ", hint: "Expected units per product", area: "STOCK" },
  stock_outlook: { label: "Stock outlook", kind: "READ", hint: "What runs out and when", area: "STOCK" },
  reorder_outlook: { label: "Reorder timing", kind: "READ", hint: "Customers due to reorder", area: "CUSTOMERS" },
  supplier_alternatives: { label: "Supplier alternatives", kind: "READ", hint: "Cheaper / better suppliers", area: "SUPPLIERS" },
  supplier_scorecards: { label: "Supplier scorecards", kind: "READ", hint: "Fill rate, on time, claims", area: "SUPPLIERS" },
  margin_opportunities: { label: "Margin opportunities", kind: "READ", hint: "Products below the margin target", area: "FINANCE" },
  profit_and_loss: { label: "Profit & loss", kind: "READ", hint: "Monthly P&L", area: "FINANCE" },
  overdue_customers: { label: "Overdue customers", kind: "READ", hint: "Who owes how much, how late", area: "FINANCE" },
  delivery_risk: { label: "Delivery risk", kind: "READ", hint: "Orders that may arrive late", area: "DELIVERY" },
  open_suggestions: { label: "Open AI suggestions", kind: "READ", hint: "What the AI Centre found" },
  services_overview: { label: "Services & used oil", kind: "READ", hint: "Requests, visits, missed, oil collected, money open", area: "CUSTOMERS" },
  find_company: { label: "Find a company", kind: "READ", hint: "Customer / supplier by name", area: "CUSTOMERS" },
  create_task: { label: "Create a follow-up task", kind: "ACT", hint: "A CRM task for a company (call, chase, review)" },
  notify_staff: { label: "Notify staff", kind: "ACT", hint: "A message to a staff group" },
};
export const AGENT_TOOL_NAMES = Object.keys(AGENT_TOOLS);
export const ACT_TOOLS = AGENT_TOOL_NAMES.filter((t) => AGENT_TOOLS[t].kind === "ACT");

export const AUTONOMY = {
  SUGGEST: { label: "Report only", hint: "Reads and writes a report. Can't act." },
  APPROVAL: { label: "Propose, a person approves", hint: "Every action waits in the approval queue." },
  AUTO: { label: "Act on its own (within limits)", hint: "Actions FIRINGI allows in AI Governance run straight away; the rest wait for approval." },
} as const;
export type Autonomy = keyof typeof AUTONOMY;
export const EFFORTS = ["low", "medium", "high"] as const;
export type Effort = (typeof EFFORTS)[number];

export const AGENT_ICONS = ["Bot", "TrendingUp", "Boxes", "Wallet", "Route", "Truck", "Users", "ShieldCheck", "Sparkles", "Megaphone"] as const;
export const AGENT_TONES = ["tone-blue", "tone-violet", "tone-teal", "tone-pink", "tone-orange", "tone-lime"] as const;

export type AgentTemplate = { key: string; name: string; role: string; icon: (typeof AGENT_ICONS)[number]; tone: (typeof AGENT_TONES)[number]; instructions: string; tools: string[]; data: DataArea[]; autonomy: Autonomy; schedule: Schedule | null; task: string };
export const AGENT_TEMPLATES: AgentTemplate[] = [
  {
    key: "sales", name: "Sales Analyst", role: "Watches sales and tells the team what changed and why.", icon: "TrendingUp", tone: "tone-blue",
    instructions: "You look at FIRINGI's sales every week. Compare the last 7 days with the 7 before: total, top customers, suppliers and products that rose or fell. Explain the 3 biggest changes with numbers and say what the sales team should do. Where a customer dropped sharply, propose a follow-up task for that customer.",
    tools: ["sales_summary", "breakdown", "find_orders", "reorder_outlook", "find_company", "create_task"], data: ["ORDERS", "CUSTOMERS"], autonomy: "APPROVAL",
    schedule: { every: "WEEKLY", hour: 6, weekday: 1, day: 1 }, task: "Weekly sales review: what changed, why, and what to do.",
  },
  {
    key: "credit", name: "Credit Controller", role: "Chases overdue invoices before they become a problem.", icon: "Wallet", tone: "tone-orange",
    instructions: "You keep cash coming in. List customers with overdue invoices, most money first. For each of the top 5 propose one follow-up task (who to call, how much, how late, what to say). Flag customers who are both overdue and still ordering a lot.",
    tools: ["overdue_customers", "find_orders", "sales_summary", "find_company", "create_task", "notify_staff"], data: ["FINANCE", "ORDERS", "CUSTOMERS"], autonomy: "APPROVAL",
    schedule: { every: "WEEKDAYS", hour: 7, weekday: 1, day: 1 }, task: "Daily overdue check: who to chase today.",
  },
  {
    key: "stock", name: "Stock Watcher", role: "Spots products about to run out and suppliers to switch to.", icon: "Boxes", tone: "tone-pink",
    instructions: "You protect availability. Find products that run out within 7 days and those with rising demand. For each, say the days left, which customers buy it most, and whether another supplier could cover. Notify the supplier managers when something important is about to run out.",
    tools: ["stock_outlook", "demand_forecast", "supplier_alternatives", "open_suggestions", "notify_staff"], data: ["STOCK", "SUPPLIERS"], autonomy: "AUTO",
    schedule: { every: "DAILY", hour: 5, weekday: 1, day: 1 }, task: "What runs out this week, and what to do about it.",
  },
  {
    key: "routes", name: "Route Planner", role: "Finds late deliveries and shorter, cheaper routes.", icon: "Route", tone: "tone-lime",
    instructions: "You look after deliveries. List orders that may arrive late and why, and the route savings the AI Centre found (km, fuel or energy, €, CO₂). Suggest which to act on first.",
    tools: ["delivery_risk", "open_suggestions", "find_orders"], data: ["DELIVERY", "ORDERS"], autonomy: "SUGGEST",
    schedule: { every: "WEEKDAYS", hour: 6, weekday: 1, day: 1 }, task: "Today's delivery risks and route savings.",
  },
  {
    key: "services", name: "Services Coordinator", role: "Keeps oil collections and other services on time.", icon: "Truck", tone: "tone-teal",
    instructions: "You look after FIRINGI's services (used cooking oil collection, cleaning, pest control). Check requests waiting, missed visits and money still open. For each customer with a missed visit, propose a follow-up task to call them and rebook; tell the delivery team when requests have waited more than 2 days.",
    tools: ["services_overview", "open_suggestions", "find_company", "create_task", "notify_staff"], data: ["CUSTOMERS", "DELIVERY"], autonomy: "APPROVAL",
    schedule: { every: "WEEKDAYS", hour: 7, weekday: 1, day: 1 }, task: "Services today: requests waiting, missed visits, what to do.",
  },
  {
    key: "suppliers", name: "Supplier Quality", role: "Reviews supplier performance and margins.", icon: "ShieldCheck", tone: "tone-teal",
    instructions: "You review suppliers monthly: fill rate, on-time delivery, claims and margin. Name the 3 weakest suppliers with the numbers and propose a review task with each one's account manager.",
    tools: ["supplier_scorecards", "margin_opportunities", "supplier_alternatives", "find_company", "create_task"], data: ["SUPPLIERS", "FINANCE"], autonomy: "APPROVAL",
    schedule: { every: "MONTHLY", hour: 6, weekday: 1, day: 1 }, task: "Monthly supplier review.",
  },
];

// ── governance ──────────────────────────────────────────────────────────────

export type ModelChoice = "default" | AiModel;
export type Governance = {
  /** every call to Claude (assistant, WhatsApp, agents, Claude-written reports) */
  enabled: boolean;
  agents: boolean;
  automation: boolean;
  models: { assistant: ModelChoice; agents: ModelChoice; reports: ModelChoice };
  /** tokens per calendar month for all of FIRINGI; 0 = no limit */
  monthlyTokens: number;
  /** when the budget is used up: stop agents only, or every Claude call */
  budgetStops: "AGENTS" | "ALL";
  alertPct: number;
  /** what agents set to "act on their own" may do without a person */
  autoActions: string[];
  /** emails, phone numbers and IBANs are removed from what agents send to Claude */
  redact: boolean;
  /** an AI proposal not decided within this many hours expires */
  approvalHours: number;
  /** all agents together, per day */
  agentRunsPerDay: number;
  /** days the AI activity log and agent runs are kept */
  retentionDays: number;
  /** € per million tokens (for cost estimates; 0 = not shown) */
  pricePerMTokIn: number;
  pricePerMTokOut: number;
};
export const DEFAULT_GOVERNANCE: Governance = {
  enabled: true, agents: true, automation: true,
  models: { assistant: "default", agents: "default", reports: "default" },
  monthlyTokens: 0, budgetStops: "AGENTS", alertPct: 80,
  autoActions: ["notify_staff"], redact: true, approvalHours: 72, agentRunsPerDay: 200, retentionDays: 365,
  pricePerMTokIn: 0, pricePerMTokOut: 0,
};
const int = (v: unknown, d: number, lo: number, hi: number) => (typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v))) : d);
const num = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.round(v * 100) / 100 : d);
const model = (v: unknown): ModelChoice => (v === "default" || AI_MODELS.includes(v as AiModel) ? (v as ModelChoice) : "default");
export function mergeGovernance(v: Partial<Governance> | null | undefined): Governance {
  const s = v ?? {}, d = DEFAULT_GOVERNANCE;
  return {
    enabled: s.enabled ?? d.enabled, agents: s.agents ?? d.agents, automation: s.automation ?? d.automation,
    models: { assistant: model(s.models?.assistant), agents: model(s.models?.agents), reports: model(s.models?.reports) },
    monthlyTokens: int(s.monthlyTokens, d.monthlyTokens, 0, 10_000_000_000), budgetStops: s.budgetStops === "ALL" ? "ALL" : "AGENTS", alertPct: int(s.alertPct, d.alertPct, 10, 100),
    autoActions: (s.autoActions ?? d.autoActions).filter((a) => ACT_TOOLS.includes(a)), redact: s.redact ?? d.redact,
    approvalHours: int(s.approvalHours, d.approvalHours, 1, 720), agentRunsPerDay: int(s.agentRunsPerDay, d.agentRunsPerDay, 1, 5000), retentionDays: int(s.retentionDays, d.retentionDays, 30, 3650),
    pricePerMTokIn: num(s.pricePerMTokIn, d.pricePerMTokIn), pricePerMTokOut: num(s.pricePerMTokOut, d.pricePerMTokOut),
  };
}
export const tokenCost = (g: Pick<Governance, "pricePerMTokIn" | "pricePerMTokOut">, tin: number, tout: number) => (g.pricePerMTokIn || g.pricePerMTokOut ? Math.round(((tin * g.pricePerMTokIn + tout * g.pricePerMTokOut) / 1e6) * 100) / 100 : null);

/** Remove emails, phone numbers and IBANs from text sent to Claude. */
export function redact(text: string) {
  return text
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email]")
    .replace(/\b[A-Z]{2}\d{2}(?:\s?[A-Z0-9]{4}){2,7}(?:\s?[A-Z0-9]{1,3})?\b/g, "[iban]")
    .replace(/(?<![\w.-])\+?\d[\d\s().-]{7,}\d(?![\w-])/g, (m) => (m.replace(/\D/g, "").length >= 9 && !/^\d{4}-\d{2}-\d{2}/.test(m.trim()) ? "[phone]" : m));
}

// ── statuses ────────────────────────────────────────────────────────────────

export const RUN_STATUS_LABEL: Record<string, string> = { RUNNING: "Running", WAITING: "Waiting", WAITING_APPROVAL: "Waiting for approval", DONE: "Done", FAILED: "Failed", REJECTED: "Stopped (not approved)", CANCELLED: "Cancelled", BLOCKED: "Blocked" };
export const RUN_TONE: Record<string, "success" | "warning" | "destructive" | "secondary" | "default"> = { DONE: "success", RUNNING: "default", WAITING: "secondary", WAITING_APPROVAL: "warning", FAILED: "destructive", REJECTED: "secondary", CANCELLED: "secondary", BLOCKED: "destructive", PENDING: "warning", APPROVED: "success", EXPIRED: "secondary" };
export { REPORTS };
