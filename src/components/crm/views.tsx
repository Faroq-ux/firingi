/** CRM server views (FIRINGI back office, English). */
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { formatDate, formatMoney } from "@/lib/utils";
import { TaskDoneButton } from "./forms";

export const pretty = (s: string) => s.charAt(0) + s.slice(1).toLowerCase().replace(/_/g, " ");
export const eur = (v: unknown) => formatMoney(String(v ?? 0), "pt-PT");
export const when = (d: Date | null | undefined, time = false) => (d ? formatDate(d, "en-GB", time) : "—");
const KIND_ICON: Record<string, string> = { CALL: "📞", EMAIL: "✉️", WHATSAPP: "💬", MEETING: "👥", VISIT: "🚶", NOTE: "📝" };
const KIND_LABEL: Record<string, string> = { CALL: "Call", EMAIL: "E-mail", WHATSAPP: "WhatsApp", MEETING: "Meeting", VISIT: "Visit", NOTE: "Note" };

type Act = {
  id: string; kind: string; subject: string; body: string | null; at: Date; outbound: boolean; by: { name: string };
  company?: { id: string; legalName: string } | null; lead?: { id: string; number: string; companyName: string } | null; deal?: { id: string; number: string; title: string } | null;
};

/** Activity feed (communications history / notes). */
export function Timeline({ items, showTarget }: { items: Act[]; showTarget?: boolean }) {
  if (!items.length) return <p className="py-6 text-center text-sm text-muted-foreground">Nothing logged yet.</p>;
  return (
    <ol className="space-y-3" data-testid="timeline">
      {items.map((a) => (
        <li key={a.id} className="flex gap-3 text-sm">
          <span aria-hidden className="mt-0.5 w-6 text-center">{KIND_ICON[a.kind]}</span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-baseline gap-x-2">
              <span className="font-medium">{a.subject}</span>
              <span className="text-xs text-muted-foreground">{KIND_LABEL[a.kind]}{a.kind !== "NOTE" ? (a.outbound ? " · we contacted them" : " · they contacted us") : ""} · {when(a.at, true)} · {a.by.name}</span>
            </div>
            {showTarget && (
              <div className="text-xs">
                {a.company && <Link className="text-primary hover:underline" href={`/admin/crm/accounts/${a.company.id}`}>{a.company.legalName}</Link>}
                {!a.company && a.lead && <Link className="text-primary hover:underline" href={`/admin/crm/leads/${a.lead.id}`}>{a.lead.companyName} ({a.lead.number})</Link>}
                {a.deal && <> · <Link className="hover:underline" href={`/admin/crm/pipeline/${a.deal.id}`}>{a.deal.number} {a.deal.title}</Link></>}
              </div>
            )}
            {a.body && <p className="mt-0.5 whitespace-pre-line text-muted-foreground">{a.body}</p>}
          </div>
        </li>
      ))}
    </ol>
  );
}

type Task = {
  id: string; kind: string; title: string; dueAt: Date; status: string; assignee: { name: string };
  company?: { id: string; legalName: string } | null; lead?: { id: string; number: string; companyName: string } | null; deal?: { id: string; number: string; title: string } | null;
};

export function TaskList({ items, showTarget }: { items: Task[]; showTarget?: boolean }) {
  if (!items.length) return <p className="py-6 text-center text-sm text-muted-foreground">No tasks.</p>;
  const startOfToday = new Date(new Date().toDateString()).getTime();
  return (
    <ul className="divide-y text-sm" data-testid="task-list">
      {items.map((t) => {
        const overdue = t.status === "OPEN" && t.dueAt.getTime() < startOfToday;
        return (
          <li key={t.id} className={`flex flex-wrap items-center gap-2 py-2 ${t.status !== "OPEN" ? "text-muted-foreground line-through" : ""}`}>
            <TaskDoneButton id={t.id} done={t.status === "DONE"} />
            <span className="font-medium">{t.title}</span>
            {t.kind === "FOLLOW_UP" && <Badge variant="secondary">Follow-up</Badge>}
            <span className={`text-xs ${overdue ? "font-medium text-destructive" : "text-muted-foreground"}`}>{overdue ? "Overdue · " : ""}due {when(t.dueAt)}</span>
            <span className="text-xs text-muted-foreground">· {t.assignee.name}</span>
            {showTarget && (
              <span className="text-xs">
                {t.company && <Link className="text-primary hover:underline" href={`/admin/crm/accounts/${t.company.id}`}>{t.company.legalName}</Link>}
                {!t.company && t.lead && <Link className="text-primary hover:underline" href={`/admin/crm/leads/${t.lead.id}`}>{t.lead.companyName}</Link>}
                {t.deal && <> · <Link className="hover:underline" href={`/admin/crm/pipeline/${t.deal.id}`}>{t.deal.number}</Link></>}
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

const LEAD_VARIANT: Record<string, "default" | "secondary" | "success" | "warning" | "destructive"> = { NEW: "warning", CONTACTED: "default", QUALIFIED: "default", CONVERTED: "success", LOST: "secondary" };
export const LeadBadge = ({ status }: { status: string }) => <Badge variant={LEAD_VARIANT[status]}>{pretty(status)}</Badge>;
const TICKET_VARIANT: Record<string, "default" | "secondary" | "success" | "warning" | "destructive"> = { OPEN: "warning", PENDING_CUSTOMER: "default", RESOLVED: "success", CLOSED: "secondary" };
const TICKET_LABEL: Record<string, string> = { OPEN: "Waiting for FIRINGI", PENDING_CUSTOMER: "Waiting for the company", RESOLVED: "Resolved", CLOSED: "Closed" };
export const TicketBadge = ({ status }: { status: string }) => <Badge variant={TICKET_VARIANT[status]}>{TICKET_LABEL[status]}</Badge>;
const ACT_VARIANT: Record<string, "default" | "secondary" | "success" | "warning" | "destructive"> = { ACTIVE: "success", NEW: "default", AT_RISK: "warning", DORMANT: "destructive", NEVER_ORDERED: "secondary" };
export const ActivityBadge = ({ status }: { status: string }) => <Badge variant={ACT_VARIANT[status]}>{pretty(status)}</Badge>;

/** Pills that link to ?key=value (keeps other params). */
export function Pills({ items, current, param, base }: { items: { value: string; label: string }[]; current: string; param: string; base: Record<string, string | undefined> }) {
  const href = (v: string) => "?" + new URLSearchParams(Object.entries({ ...base, [param]: v || undefined }).filter(([, x]) => x) as [string, string][]).toString();
  return (
    <div className="flex flex-wrap gap-1 text-sm">
      {items.map((i) => <Link key={i.value} href={href(i.value)} className={`rounded-md border px-3 py-1 ${current === i.value ? "bg-primary text-primary-foreground" : "hover:bg-accent"}`}>{i.label}</Link>)}
    </div>
  );
}
