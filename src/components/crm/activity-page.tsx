/** Communications / Notes pages. */
import type { CrmActivityKind } from "@prisma/client";
import { can } from "@/server/rbac/guard";
import type { Ctx } from "@/server/context";
import { crmTargets, listActivities } from "@/server/services/crm";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { ActivityForm } from "./forms";
import { Pills, Timeline } from "./views";

const KINDS = [{ value: "", label: "All" }, { value: "CALL", label: "Calls" }, { value: "EMAIL", label: "E-mails" }, { value: "WHATSAPP", label: "WhatsApp" }, { value: "MEETING", label: "Meetings" }, { value: "VISIT", label: "Visits" }];

export async function ActivityPage({ ctx, notes, sp }: { ctx: Ctx; notes: boolean; sp: { kind?: string; who?: string; q?: string } }) {
  const kind = !notes && KINDS.some((k) => k.value === sp.kind) ? (sp.kind as CrmActivityKind) || undefined : undefined;
  const [rows, targets] = await Promise.all([listActivities(ctx, { notes, kind, byUserId: sp.who === "me" ? ctx.user.id : undefined, q: sp.q }), crmTargets(ctx)]);
  const t = { companies: targets.companies.map((c) => ({ id: c.id, label: c.legalName })), leads: targets.leads.map((l) => ({ id: l.id, label: `${l.companyName} (${l.number})` })) };
  return (
    <>
      <PageHeader title={notes ? "Notes" : "Communications"} description={notes ? "What the team knows about accounts and leads: preferences, agreements, context." : "Every call, e-mail, WhatsApp, meeting and visit with accounts and leads. Messages FIRINGI's system sends are in Notifications › Message log."} />
      <div className="mb-3 flex flex-wrap items-start gap-3">
        {can(ctx, "admin.crm.manage") && <ActivityForm targets={t} kind={notes ? "NOTE" : undefined} label={notes ? "Add note" : "Log a call, e-mail, visit…"} />}
        {!notes && <Pills items={KINDS} current={sp.kind ?? ""} param="kind" base={{ who: sp.who, q: sp.q }} />}
        <Pills items={[{ value: "", label: "Team" }, { value: "me", label: "Mine" }]} current={sp.who ?? ""} param="who" base={{ kind: sp.kind, q: sp.q }} />
        <form>{sp.kind && <input type="hidden" name="kind" value={sp.kind} />}<input name="q" defaultValue={sp.q} placeholder="Search…" className="h-8 rounded-md border bg-card px-2 text-sm" /></form>
      </div>
      <Card><CardContent className="pt-5"><Timeline items={rows} showTarget /></CardContent></Card>
    </>
  );
}
