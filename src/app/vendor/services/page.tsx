import { notFound } from "next/navigation";
import { FileText, Recycle } from "lucide-react";
import { pagePermission, pagePortal, can } from "@/server/rbac/guard";
import { providerAccess } from "@/server/servicing/settings";
import { providerBoard } from "@/server/servicing/plans";
import { listTypes } from "@/server/servicing/catalogue";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { svLabels } from "@/components/services/labels";
import { day, fill, isoDay, money, num, schedText, statusTone, unitText, type L } from "@/components/services/text";
import { ApplyForm, ProviderVisit } from "@/components/services/client";
import { localName } from "@/lib/services";

export const metadata = { title: "Services" };
export const dynamic = "force-dynamic";

type Board = Awaited<ReturnType<typeof providerBoard>>;
type Visit = Board["upcoming"][number];
const n = (v: { toString(): string } | null | undefined) => (v == null ? 0 : Number(v.toString()));

/** Phase 68: a supplier providing services — apply, requests, coming visits (confirm / move / record), customers, recent. */
export default async function VendorServicesPage() {
  const ctx = await pagePortal("vendor");
  pagePermission(ctx, ["vendor.services.manage", "vendor.services.visit"]);
  const access = await providerAccess(ctx.company);
  if (!access.on) notFound();
  const [{ l, locale }, b, types] = await Promise.all([svLabels(), providerBoard(ctx), listTypes(ctx)]);
  const manage = can(ctx, "vendor.services.manage");
  const tname = (t: { name: unknown; code: string }) => localName(t.name, t.code, locale);
  const mine = new Map(b.providers.map((p) => [p.serviceTypeId, p]));
  const canApply = types.filter((t) => mine.get(t.id)?.status !== "APPROVED" && mine.get(t.id)?.status !== "PENDING").map((t) => ({ id: t.id, name: tname(t), needsDocument: t.needsDocument }));
  const row = (v: Visit, work: boolean) => {
    const p = mine.get(v.serviceTypeId);
    return (
      <li key={v.id} className="space-y-1 py-3" data-testid="pv-visit-row" data-status={v.status} data-number={v.number}>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="w-28 shrink-0 font-medium tabular-nums">{day(locale, v.date)}</span>
          <span className="min-w-0 flex-1 basis-48 break-words">{v.customer} · {tname(v.serviceType)} <span className="text-xs text-muted-foreground">{v.number}</span></span>
          <Badge variant={statusTone(v.status)}>{l[`st.${v.status}`] ?? v.status}</Badge>
          {v.status === "DONE" && <a className="inline-flex items-center gap-1 text-xs text-primary hover:underline" href={`/api/services/visits/${v.id}/document`} target="_blank" rel="noreferrer" data-testid="pv-doc"><FileText className="size-3.5" /> {l.openPdf}</a>}
        </div>
        <p className="text-xs text-muted-foreground">
          {v.address ?? "—"}{v.timeWindow && v.timeWindow !== "ANY" ? ` · ${l[`window.${v.timeWindow}`]}` : ""}
          {v.origin === "REQUESTED" && v.requestReason ? ` · ${l[`reason.${v.requestReason}`]}` : ""}{v.requestNote ? ` · ${v.requestNote}` : ""}
          {v.status === "DONE" && v.quantity != null ? ` · ${num(locale, n(v.quantity))} ${unitText(l, v.serviceType.unit)}` : ""}
          {v.status === "DONE" && n(v.extrasNet) > 0 ? ` · ${fill(l["extras.shown"], { amount: money(locale, n(v.extrasNet)), note: v.extrasNote ?? "" })}` : ""}
          {v.status === "DONE" && v.invoicedBy === "FIRINGI" && n(v.providerAmount) > 0 ? ` · ${fill(l.yourAmount, { amount: money(locale, n(v.providerAmount)) })}` : ""}
          {v.status === "MISSED" && v.missedReason ? ` · ${v.missedReason}` : ""}
        </p>
        {work && <ProviderVisit l={l} v={{ id: v.id, status: v.status, date: isoDay(v.date), isCollection: v.serviceType.kind === "COLLECTION", unit: v.serviceType.unit, needsSignature: v.serviceType.needsDocument, youInvoice: (p?.pricing.invoicedBy ?? "FIRINGI") === "PROVIDER" && ctx.company.type !== "ADMIN", containers: v.plan?.containers ?? 0, allowExtras: v.serviceType.allowExtras }} />}
      </li>
    );
  };
  const list = (rows: Visit[], empty: string, work: boolean, testid: string) => (!rows.length ? <p className="text-sm text-muted-foreground" data-testid={`${testid}-empty`}>{empty}</p> : <ul className="divide-y" data-testid={testid}>{rows.map((v) => row(v, work))}</ul>);
  return (
    <>
      <PageHeader title={l.vTitle} description={l.vIntro} icon={Recycle} />
      <div className="space-y-6">
        <div className="grid gap-6 xl:grid-cols-2">
          <Card>
            <CardHeader><CardTitle>{l.myServices}</CardTitle></CardHeader>
            <CardContent>
              {!b.providers.length ? <p className="text-sm text-muted-foreground" data-testid="pv-none">{l.noProviderYet}</p> : (
                <ul className="divide-y">
                  {b.providers.map((p) => (
                    <li key={p.id} className="space-y-1 py-2 text-sm" data-testid="pv-provider-row" data-status={p.status}>
                      <div className="flex flex-wrap items-center gap-2"><span className="min-w-0 break-words font-medium">{tname(p.serviceType)}</span><Badge variant={statusTone(p.status)}>{l[`st.${p.status}`] ?? p.status}</Badge></div>
                      {p.status === "APPROVED" && <ProviderTerms l={l} locale={locale} p={p} />}
                      <p className="text-xs text-muted-foreground">{p.countries.join(", ") || "—"}{p.licenceNumber ? ` · ${l.licence}: ${p.licenceNumber}` : ""}{p.licenceExpiresAt ? ` · ${l.licenceUntil}: ${day(locale, p.licenceExpiresAt)}` : ""}{p.decisionNote ? ` · ${p.decisionNote}` : ""}</p>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
          {manage && access.s.selfApply && canApply.length > 0 && ctx.company.type !== "ADMIN" && (
            <Card><CardHeader><CardTitle>{l.apply}</CardTitle></CardHeader><CardContent><ApplyForm l={l} types={canApply} country={ctx.company.countryCode} /></CardContent></Card>
          )}
        </div>
        <Card><CardHeader><CardTitle>{l.requests} <span className="text-sm font-normal text-muted-foreground">{b.requests.length}</span></CardTitle></CardHeader><CardContent>{list(b.requests, l.noRequests, true, "pv-requests")}</CardContent></Card>
        <Card><CardHeader><CardTitle>{l.toDo} <span className="text-sm font-normal text-muted-foreground">{b.upcoming.length}</span></CardTitle></CardHeader><CardContent>{list(b.upcoming, l.noVisits, true, "pv-upcoming")}</CardContent></Card>
        <div className="grid gap-6 xl:grid-cols-2">
          <Card>
            <CardHeader><CardTitle>{l.plansV} <span className="text-sm font-normal text-muted-foreground">{b.plans.length}</span></CardTitle></CardHeader>
            <CardContent>
              {!b.plans.length ? <p className="text-sm text-muted-foreground">—</p> : (
                <ul className="divide-y">
                  {b.plans.map((p) => (
                    <li key={p.id} className="py-2 text-sm" data-testid="pv-plan-row">
                      <p className="flex flex-wrap items-center gap-2"><span className="min-w-0 break-words font-medium">{p.customer}</span><span className="text-xs text-muted-foreground">{p.number}</span>{p.status !== "ACTIVE" && <Badge variant={statusTone(p.status)}>{l[`st.${p.status}`]}</Badge>}</p>
                      <p className="text-xs text-muted-foreground">{tname(p.serviceType)} · {l[`freq.${p.frequency}`]}{p.frequency !== "ON_REQUEST" ? ` · ${schedText(l, p)}` : ""}{p.containerLitres > 0 ? ` · ${p.containers} × ${p.containerLitres} L` : ""}{p.address ? ` · ${p.address}` : ""}{p.notes ? ` · ${p.notes}` : ""}</p>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
          <Card><CardHeader><CardTitle>{l.recent}</CardTitle></CardHeader><CardContent>{list(b.recent.slice(0, 40), l.noRecent, false, "pv-recent")}</CardContent></Card>
        </div>
      </div>
    </>
  );
}

function ProviderTerms({ l, locale, p }: { l: L; locale: string; p: Board["providers"][number] }) {
  const pr = p.pricing;
  if (pr.invoicedBy === "PROVIDER") {
    const parts = [pr.commissionPct > 0 ? `${num(locale, pr.commissionPct)}%` : null, pr.commissionPerVisit > 0 ? money(locale, pr.commissionPerVisit) : null, pr.commissionPerUnit > 0 ? `${money(locale, pr.commissionPerUnit)}/${unitText(l, p.serviceType.unit)}` : null].filter(Boolean).join(" + ");
    return <p className="text-xs" data-testid="pv-terms" data-by="PROVIDER">{l.youInvoice}{parts ? ` ${fill(l.commission, { value: parts })}` : ""}</p>;
  }
  const amt = [pr.providerPerVisit > 0 ? money(locale, pr.providerPerVisit) : null, pr.providerPerUnit > 0 ? `${money(locale, pr.providerPerUnit)}/${unitText(l, p.serviceType.unit)}` : null].filter(Boolean).join(" + ");
  return <p className="text-xs" data-testid="pv-terms" data-by="FIRINGI">{l.firingiInvoices}{amt ? ` ${fill(l.yourAmount, { amount: amt })}` : ""}</p>;
}
