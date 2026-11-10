/** Help & Support for customers and suppliers (translated). */
import Link from "next/link";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import type { Ctx } from "@/server/context";
import { CATEGORIES, listTickets, ticketDetail, ticketOrderOptions } from "@/server/services/support";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyRow, TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { formatDate } from "@/lib/utils";
import { NewTicketForm, ReplyForm } from "./ticket-forms";
import { Thread } from "./ticket-views";

const VARIANT: Record<string, "default" | "secondary" | "success" | "warning"> = { OPEN: "warning", PENDING_CUSTOMER: "default", RESOLVED: "success", CLOSED: "secondary" };

export async function SupportList({ ctx, base }: { ctx: Ctx; base: string }) {
  const [t, locale, rows, orders] = await Promise.all([getTranslations("support"), getLocale(), listTickets(ctx), ticketOrderOptions(ctx)]);
  const l = { category: t("category"), order: t("order"), noOrder: t("noOrder"), subject: t("subject"), message: t("message"), send: t("send") };
  return (
    <>
      <PageHeader title={t("title")} description={t("intro")} />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        <Card>
          <CardHeader><CardTitle>{t("new")}</CardTitle></CardHeader>
          <CardContent>
            <NewTicketForm l={l} base={base} categories={CATEGORIES.map((c) => ({ value: c, label: t(`categories.${c}`) }))} orders={orders.map((o) => ({ id: o.id, label: `${o.number} · ${formatDate(o.placedAt, locale)}` }))} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>{t("mine")}</CardTitle></CardHeader>
          <CardContent>
            <Table data-testid="my-tickets">
              <THead><TR><TH>{t("number")}</TH><TH>{t("subject")}</TH><TH>{t("updated")}</TH><TH>{t("status")}</TH></TR></THead>
              <TBody>
                {rows.map((r) => (
                  <TR key={r.id}>
                    <TD><Link className="font-medium text-primary hover:underline" href={`${base}/${r.id}`}>{r.number}</Link></TD>
                    <TD>{r.subject}<div className="text-xs text-muted-foreground">{t(`categories.${r.category}`)}{r.order ? ` · ${r.order.number}` : ""}</div></TD>
                    <TD className="text-xs">{formatDate(r.lastMessageAt, locale, true)}</TD>
                    <TD><Badge variant={VARIANT[r.status]}>{t(`statuses.${r.status}`)}</Badge></TD>
                  </TR>
                ))}
                {!rows.length && <EmptyRow colSpan={4}>{t("none")}</EmptyRow>}
              </TBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </>
  );
}

export async function SupportTicket({ ctx, id, base, sent }: { ctx: Ctx; id: string; base: string; sent?: boolean }) {
  const r = await ticketDetail(ctx, id).catch(() => null);
  if (!r) notFound();
  const [t, locale] = await Promise.all([getTranslations("support"), getLocale()]);
  const k = r.ticket;
  return (
    <>
      <Link href={base} className="text-sm text-primary hover:underline">← {t("back")}</Link>
      <PageHeader title={`${k.number} · ${k.subject}`} description={<span className="flex flex-wrap items-center gap-2"><Badge variant={VARIANT[k.status]}>{t(`statuses.${k.status}`)}</Badge> {t(`categories.${k.category}`)}{k.order ? ` · ${k.order.number}` : ""}</span>} />
      {sent && <p role="status" className="mb-3 rounded-md bg-success/10 p-2 text-sm text-success">{t("sent")}</p>}
      <Card><CardContent className="space-y-4 pt-5">
        <Thread messages={k.messages} locale={locale} staff={false} l={{ you: t("you"), firingi: t("firingi"), internalNote: "" }} />
        {(k.status === "RESOLVED" || k.status === "CLOSED") && <p className="text-sm text-muted-foreground">{t("reopenHint")}</p>}
        <ReplyForm id={k.id} l={{ reply: t("reply"), replyPlaceholder: t("replyPlaceholder"), send: t("send"), sendResolve: "", internal: "", addNote: "" }} />
      </CardContent></Card>
    </>
  );
}
