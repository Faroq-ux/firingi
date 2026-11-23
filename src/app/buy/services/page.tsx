import { notFound } from "next/navigation";
import { FileText, Recycle } from "lucide-react";
import { pagePermission, pagePortal, can } from "@/server/rbac/guard";
import { servicesAccess } from "@/server/servicing/settings";
import { myServices } from "@/server/servicing/plans";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { svLabels } from "@/components/services/labels";
import { day, fill, isoDay, money, num, schedText, statusTone, unitText } from "@/components/services/text";
import { PlanControls, RequestService, TakeService, VisitControls } from "@/components/services/client";

export const metadata = { title: "My Services" };
export const dynamic = "force-dynamic";

/** Phase 68: the customer's services — catalogue, plans with their schedule, coming visits, requests and history. */
export default async function BuyServicesPage() {
  const ctx = await pagePortal("buy");
  pagePermission(ctx, ["buyer.services.manage", "buyer.services.log"]);
  if (!(await servicesAccess(ctx.company)).on) notFound();
  const { l, locale } = await svLabels();
  const d = await myServices(ctx, new Date(), locale);
  const manage = can(ctx, "buyer.services.manage");
  const earliest = isoDay(new Date(Date.now() + d.settings.requestLeadDays * 86400_000));
  const price = (t: (typeof d.types)[number]) => {
    const u = unitText(l, t.unit);
    const parts = [t.feeNet > 0 ? fill(l.priceVisit, { amount: money(locale, t.feeNet) }) : null, t.pricePerUnit > 0 ? fill(l.priceUnit, { amount: money(locale, t.pricePerUnit), unit: u }) : null].filter(Boolean);
    return parts.length ? parts.join(" + ") : l.free;
  };
  return (
    <>
      <PageHeader title={l.title} description={l.intro} icon={Recycle} />
      <div className="space-y-8">
        <section aria-labelledby="sv-cat" className="space-y-3">
          <h2 id="sv-cat" className="text-lg font-semibold">{l.catalogue}</h2>
          <div className="grid gap-4 md:grid-cols-2">
            {d.types.map((t) => (
              <Card key={t.id} data-testid="sv-type" data-code={t.code}>
                <CardHeader><CardTitle className="flex flex-wrap items-center gap-2"><span className="min-w-0 break-words">{t.name}</span>{t.planId && <Badge variant="success">{l["st.ACTIVE"]}</Badge>}</CardTitle>
                  {t.description && <CardDescription>{t.description}</CardDescription>}</CardHeader>
                <CardContent className="space-y-3 text-sm">
                  <p className="font-medium">{price(t)}</p>
                  {t.buybackPerUnit > 0 && <p className="text-[color:var(--success,#16a34a)]">{fill(l.buyback, { amount: money(locale, t.buybackPerUnit), unit: unitText(l, t.unit) })}</p>}
                  <p className="text-xs text-muted-foreground">{t.frequencies.map((f) => l[`freq.${f}`] ?? f).join(" · ")}{t.wasteCode ? ` · ${fill(l.wasteCode, { code: t.wasteCode })}` : ""} · {t.invoicedBy === "PROVIDER" ? l.invoicedByProvider : l.invoicedByFiringi}</p>
                  {!t.available ? <p className="text-muted-foreground" data-testid="sv-unavailable">{l.noProvider}</p> : (
                    <div className="flex flex-wrap items-start gap-2">
                      {!t.planId && manage && (d.settings.parts.scheduled || t.frequencies.includes("ON_REQUEST")) && <TakeService l={l} type={{ id: t.id, code: t.code, frequencies: t.frequencies.filter((f) => (f === "ON_REQUEST" ? d.settings.parts.onRequest : d.settings.parts.scheduled)), isCollection: t.kind === "COLLECTION", isOil: t.isOil }} addresses={d.addresses} />}
                      {d.settings.parts.onRequest && (t.planId || t.frequencies.includes("ON_REQUEST")) && <RequestService l={l} serviceTypeId={t.id} code={t.code} label={t.kind === "COLLECTION" ? l.request : l.requestVisit} earliest={earliest} />}
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        </section>

        <Card>
          <CardHeader><CardTitle>{l.yourPlans}</CardTitle></CardHeader>
          <CardContent>
            {!d.plans.length ? <p className="text-sm text-muted-foreground" data-testid="sv-no-plans">{l.noPlans}</p> : (
              <ul className="divide-y">
                {d.plans.map((p) => (
                  <li key={p.id} className="space-y-2 py-3" data-testid="sv-plan-row" data-status={p.status}>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="min-w-0 break-words font-medium">{p.service}</span>
                      <span className="text-xs text-muted-foreground">{p.number}</span>
                      <Badge variant={statusTone(p.status)}>{l[`st.${p.status}`] ?? p.status}</Badge>
                    </div>
                    <p className="text-sm">{l[`freq.${p.frequency}`]}{p.frequency !== "ON_REQUEST" ? ` · ${schedText(l, p)}` : ""}{p.isCollection && p.containerLitres > 0 ? ` · ${p.containers} × ${p.containerLitres} L` : ""}</p>
                    <p className="text-xs text-muted-foreground">{l.provider}: {p.providerName}{p.next ? ` · ${l.next}: ${day(locale, p.next.date)}` : ""}{p.status === "PAUSED" && p.pausedUntil ? ` · ${fill(l.pausedUntil, { date: day(locale, p.pausedUntil) })}` : ""}</p>
                    {manage && <PlanControls l={l} addresses={d.addresses} plan={{ id: p.id, status: p.status, frequencies: p.frequencies, isCollection: p.isCollection, isOil: p.isOil, frequency: p.frequency, weekday: p.weekday, dayA: p.dayA, dayB: p.dayB, timeWindow: p.timeWindow, addressId: p.addressId ?? "", containers: p.containers, containerLitres: p.containerLitres, autoRequestWhenFull: p.autoRequestWhenFull, notes: p.notes ?? "" }} />}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <div className="grid gap-6 xl:grid-cols-2">
          <Card>
            <CardHeader><CardTitle>{l.upcoming}</CardTitle></CardHeader>
            <CardContent>
              {!d.upcoming.length ? <p className="text-sm text-muted-foreground" data-testid="sv-no-upcoming">{l.noUpcoming}</p> : (
                <ul className="divide-y">
                  {d.upcoming.map((v) => (
                    <li key={v.id} className="space-y-1 py-2" data-testid="sv-visit-row" data-status={v.status} data-origin={v.origin}>
                      <div className="flex flex-wrap items-center gap-2 text-sm">
                        <span className="w-28 shrink-0 font-medium tabular-nums">{day(locale, v.date)}</span>
                        <span className="min-w-0 flex-1 basis-40 break-words">{v.service} <span className="text-xs text-muted-foreground">{v.number}</span></span>
                        <Badge variant={statusTone(v.status)}>{l[`st.${v.status}`] ?? v.status}</Badge>
                      </div>
                      {v.origin === "REQUESTED" && v.requestReason && <p className="text-xs text-muted-foreground">{l[`reason.${v.requestReason}`]}{v.requestNote ? ` · ${v.requestNote}` : ""}</p>}
                      <VisitControls l={l} id={v.id} date={isoDay(v.date)} canSkip={manage} />
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>{l.history}</CardTitle></CardHeader>
            <CardContent>
              {!d.history.length ? <p className="text-sm text-muted-foreground" data-testid="sv-no-history">{l.noHistory}</p> : (
                <ul className="divide-y">
                  {d.history.map((v) => (
                    <li key={v.id} className="flex flex-wrap items-center gap-2 py-2 text-sm" data-testid="sv-history-row" data-status={v.status}>
                      <span className="w-28 shrink-0 tabular-nums">{day(locale, v.date)}</span>
                      <span className="min-w-0 flex-1 basis-40 break-words">{v.service}{v.isCollection && v.quantity != null ? ` · ${num(locale, v.quantity)} ${unitText(l, v.unit)}` : ""}
                        {v.status === "MISSED" && v.missedReason ? <span className="block text-xs text-muted-foreground">{v.missedReason}</span> : null}
                        {v.status === "DONE" && (v.feeNet ?? 0) > 0 && v.invoicedBy === "FIRINGI" ? <span className="block text-xs text-muted-foreground">{l.fee}: {money(locale, v.feeNet ?? 0)}</span> : null}
                        {v.status === "DONE" && (v.buybackNet ?? 0) > 0 ? <span className="block text-xs text-[color:var(--success,#16a34a)]">{l.paidYou}: {money(locale, v.buybackNet ?? 0)}</span> : null}</span>
                      <Badge variant={statusTone(v.status)}>{l[`st.${v.status}`] ?? v.status}</Badge>
                      {v.status === "DONE" && d.settings.parts.documents && <a className="inline-flex items-center gap-1 text-xs text-primary hover:underline" href={`/api/services/visits/${v.id}/document`} target="_blank" rel="noreferrer" data-testid="sv-doc"><FileText className="size-3.5" /> {l.openPdf}</a>}
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
