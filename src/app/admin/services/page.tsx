import Link from "next/link";
import { CalendarCheck, Coins, Droplets, Inbox, Recycle, TriangleAlert, Users } from "lucide-react";
import { pagePermission, pagePortal, can } from "@/server/rbac/guard";
import { adminOverview, adminPlans, adminVisits, moneyOpen } from "@/server/servicing/plans";
import { listProviders, listTypes } from "@/server/servicing/catalogue";
import { overrideCompanies, servicesSettings } from "@/server/servicing/settings";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tile } from "@/components/motion/dashboard-kit";
import { TabLinks } from "@/app/admin/ai/_kit";
import { svLabelsEn } from "@/components/services/labels";
import { day, isoDay, money, num, schedText, statusTone } from "@/components/services/text";
import { ProviderVisit } from "@/components/services/client";
import { MarkPrintPaid } from "@/components/services/printing";
import { adminPrint, printMoneyOpen } from "@/server/servicing/printing";
import { AddFiringiProvider, AddProvider, ServiceLanguages, CompanyServicesSwitch, DecideProvider, FindServicesBusiness, InvoiceCommissions, MarkPaid, ReassignPlan, ServicesSettingsForm, TypeEditor, type TypeDraft } from "@/components/services/admin";

export const metadata = { title: "Services & Used Oil" };
export const dynamic = "force-dynamic";

const TABS = ["OVERVIEW", "CATALOGUE", "PROVIDERS", "VISITS", "PRINTING", "MONEY", "SETTINGS"] as const;
type Tab = (typeof TABS)[number];
const n = (v: { toString(): string } | null | undefined) => (v == null ? 0 : Number(v.toString()));
const tname = (t: { name: unknown; code: string }) => String((t.name as Record<string, string>)?.en ?? t.code);
const STATUSES = ["REQUESTED", "SCHEDULED", "CONFIRMED", "DONE", "MISSED", "SKIPPED", "CANCELLED"];

/** Phase 68: FIRINGI's Services & Used Oil (English). */
export default async function AdminServicesPage({ searchParams }: { searchParams: Promise<{ tab?: string; status?: string; page?: string }> }) {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.services.view", "admin.services.manage"]);
  const sp = await searchParams;
  const tab: Tab = TABS.includes(sp.tab as Tab) ? (sp.tab as Tab) : "OVERVIEW";
  const manage = can(ctx, "admin.services.manage");
  const finance = can(ctx, "admin.finance.manage");
  const { l } = svLabelsEn();
  const locale = "en";
  const [o, settings] = await Promise.all([adminOverview(ctx), servicesSettings()]);
  const providersPending = tab === "PROVIDERS" || tab === "OVERVIEW" ? await listProviders(ctx) : [];
  return (
    <>
      <PageHeader title="Services & Used Oil" icon={Recycle}
        description="Used cooking oil collection and kitchen services: the catalogue, providers (suppliers or FIRINGI), customers' plans and requests, money and switches. FIRINGI decides per service — and per provider — who invoices the customer." />
      {!settings.enabled && <p className="mb-4 rounded-lg border border-dashed p-3 text-sm text-muted-foreground" data-testid="svs-off">Services are switched off (Settings).</p>}
      <TabLinks testid="sv-tabs" active={tab} href={(x) => `/admin/services?tab=${x}`} tabs={[
        { key: "OVERVIEW", label: "Overview" }, { key: "CATALOGUE", label: "Catalogue" }, { key: "PROVIDERS", label: "Providers", count: providersPending.filter((p) => p.status === "PENDING").length || undefined },
        { key: "VISITS", label: "Plans & Visits", count: o.requested || undefined }, { key: "PRINTING", label: "Printing" }, { key: "MONEY", label: "Money" }, { key: "SETTINGS", label: "Settings" },
      ]} />

      {tab === "OVERVIEW" && <Overview o={o} pending={providersPending.filter((p) => p.status === "PENDING").length} />}
      {tab === "CATALOGUE" && <Catalogue ctx={ctx} manage={manage} />}
      {tab === "PROVIDERS" && <Providers ctx={ctx} manage={manage} rows={providersPending} />}
      {tab === "VISITS" && <Visits ctx={ctx} l={l} manage={manage} status={sp.status ?? null} page={Number(sp.page ?? 1) || 1} />}
      {tab === "PRINTING" && <Printing ctx={ctx} finance={finance && manage} status={sp.status ?? null} />}
      {tab === "MONEY" && <Money finance={finance && manage} />}
      {tab === "SETTINGS" && <Settings ctx={ctx} manage={can(ctx, ["admin.services.manage", "admin.settings.manage"])} s={settings} />}
    </>
  );

  async function Printing({ ctx, finance, status }: { ctx: Parameters<typeof adminPrint>[0]; finance: boolean; status: string | null }) {
    const [d, m] = await Promise.all([adminPrint(ctx, status), printMoneyOpen()]);
    const PS = ["REQUESTED", "QUOTED", "ACCEPTED", "PRINTING", "DELIVERED", "REJECTED", "CANCELLED"];
    return (
      <div className="space-y-6">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Tile icon={Inbox} label="Open print orders" value={d.open} locale="en" tone="tone-orange" i={0} testId="pa-open" />
          <Tile icon={CalendarCheck} label="Products on sale" value={d.products} locale="en" tone="tone-teal" i={1} />
          <Tile icon={Coins} label="Owed to print suppliers" value={m.provider} locale="en" tone="tone-pink" i={2} fmt="money" />
          <Tile icon={Coins} label="Commission to invoice" value={m.commission} locale="en" tone="tone-violet" i={3} fmt="money" />
        </div>
        <Card>
          <CardHeader><CardTitle>Print orders</CardTitle><CardDescription>Print suppliers are approved under Providers (service “Printing”); who invoices and the commission are set in Catalogue › Printing and per provider. Customers never see the supplier&apos;s amount or the commission.</CardDescription></CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap gap-1 text-xs">
              <Link href="/admin/services?tab=PRINTING" className={`rounded-full border px-2 py-0.5 ${!status ? "bg-primary text-primary-foreground" : ""}`}>All</Link>
              {PS.map((s) => <Link key={s} href={`/admin/services?tab=PRINTING&status=${s}`} className={`rounded-full border px-2 py-0.5 ${status === s ? "bg-primary text-primary-foreground" : ""}`}>{s.toLowerCase()} {d.counts[s] ? `(${d.counts[s]})` : ""}</Link>)}
            </div>
            {!d.jobs.length ? <p className="text-sm text-muted-foreground" data-testid="pa-none">No print orders.</p> : (
              <ul className="divide-y" data-testid="pa-jobs">
                {d.jobs.map((j) => (
                  <li key={j.id} className="flex flex-wrap items-center gap-2 py-2 text-sm" data-testid="pa-job">
                    <span className="w-28 shrink-0 tabular-nums text-xs text-muted-foreground">{j.number}</span>
                    <span className="min-w-0 flex-1 basis-60 break-words"><span className="font-medium">{j.customer}</span> → {j.supplier} · {j.product.name} × {j.qty}
                      <span className="block text-xs text-muted-foreground">{money("en", n(j.priceNet))}{j.status === "DELIVERED" ? ` · ${j.invoicedBy === "FIRINGI" ? `FIRINGI invoiced · supplier ${money("en", n(j.providerAmount))}${j.providerPaidAt ? " (paid)" : ""}` : `supplier invoiced ${j.providerInvoiceNo ?? ""} · commission ${money("en", n(j.commissionNet))}${j.commissionInvoiceId ? " (invoiced)" : ""}`}` : ""}</span></span>
                    <Badge variant={j.status === "DELIVERED" ? "success" : j.status === "REJECTED" || j.status === "CANCELLED" ? "secondary" : "warning"}>{j.status.toLowerCase()}</Badge>
                    {(j.pdfKey || j.artworkKeys.length > 0) && <a className="text-xs text-primary hover:underline" href={`/api/services/print/${j.id}/file/${j.pdfKey ? "pdf" : "0"}`} target="_blank" rel="noreferrer">File</a>}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Owed to print suppliers</CardTitle><CardDescription>Delivered orders FIRINGI invoiced: the supplier&apos;s amount (price minus commission). Commissions on orders suppliers invoiced go on FIRINGI&apos;s monthly commission invoice (Money tab button or the hourly job on the 1st).</CardDescription></CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p>{money("en", m.provider)} to pay · {money("en", m.commission)} commission to invoice</p>
            {finance && <MarkPrintPaid ids={m.rows.filter((r) => r.invoicedBy === "FIRINGI").map((r) => r.id)} />}
          </CardContent>
        </Card>
      </div>
    );
  }

  function Overview({ o, pending }: { o: Awaited<ReturnType<typeof adminOverview>>; pending: number }) {
    return (
      <div className="space-y-6">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Tile icon={Users} label="Active plans" value={o.plans} locale={locale} tone="tone-teal" testId="sv-kpi-plans" />
          <Tile icon={Inbox} label="Open requests" value={o.requested} locale={locale} tone="tone-orange" i={1} href="/admin/services?tab=VISITS&status=REQUESTED" hint={`${o.open} visits in the next 7 days`} />
          <Tile icon={CalendarCheck} label="Visits done (30 days)" value={o.done30} locale={locale} tone="tone-blue" i={2} hint={`${o.missed30} missed`} />
          <Tile icon={Droplets} label="Used oil collected (30 days)" value={o.oilLitres30} locale={locale} tone="tone-lime" i={3} hint={`≈ ${num(locale, o.oilLitres30 * 2.5)} kg CO₂e avoided`} />
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Tile icon={Coins} label="FIRINGI-invoiced (30 days)" value={o.revenue30} fmt="money" locale={locale} tone="tone-violet" />
          <Tile icon={Coins} label="Commission earned (30 days)" value={o.commission30} fmt="money" locale={locale} tone="tone-pink" i={1} hint={`${money(locale, o.money.commission)} not invoiced yet`} />
          <Tile icon={Coins} label="Owed to providers" value={o.money.provider} fmt="money" locale={locale} tone="tone-blue" i={2} href="/admin/services?tab=MONEY" />
          <Tile icon={Coins} label="Oil buy-back to pay" value={o.money.buyback} fmt="money" locale={locale} tone="tone-teal" i={3} href="/admin/services?tab=MONEY" />
        </div>
        {(pending > 0 || o.missed30 > 0) && (
          <Card><CardContent className="space-y-1 pt-6 text-sm">
            {pending > 0 && <p className="flex items-center gap-2"><TriangleAlert className="size-4 text-amber-600" /> {pending} provider application{pending === 1 ? "" : "s"} to review — <Link className="text-primary hover:underline" href="/admin/services?tab=PROVIDERS">Providers</Link></p>}
            {o.missed30 > 0 && <p className="flex items-center gap-2"><TriangleAlert className="size-4 text-destructive" /> {o.missed30} visit{o.missed30 === 1 ? "" : "s"} missed in 30 days — <Link className="text-primary hover:underline" href="/admin/services?tab=VISITS&status=MISSED">see them</Link></p>}
          </CardContent></Card>
        )}
      </div>
    );
  }
}

async function Catalogue({ ctx, manage }: { ctx: Awaited<ReturnType<typeof pagePortal>>; manage: boolean }) {
  const types = await listTypes(ctx, { all: true });
  const draft = (t: (typeof types)[number]): TypeDraft => ({
    code: t.code, name: tname(t), namePt: String((t.name as Record<string, string>)?.["pt-PT"] ?? (t.name as Record<string, string>)?.pt ?? ""), description: String((t.description as Record<string, string> | null)?.en ?? ""), kind: t.kind as TypeDraft["kind"], allowExtras: t.allowExtras, unit: t.unit, isOil: t.isOil,
    wasteCode: t.wasteCode ?? "", needsDocument: t.needsDocument, frequencies: t.frequencies, feeNet: n(t.feeNet), pricePerUnit: n(t.pricePerUnit), buybackPerUnit: n(t.buybackPerUnit), providerPerVisit: n(t.providerPerVisit),
    providerPerUnit: n(t.providerPerUnit), invoicedBy: t.invoicedBy as TypeDraft["invoicedBy"], commissionPct: n(t.commissionPct), commissionPerVisit: n(t.commissionPerVisit), commissionPerUnit: n(t.commissionPerUnit), countries: t.countries.join(", "), active: t.active,
  });
  return (
    <div className="space-y-4">
      {manage && <TypeEditor id={null} />}
      <div className="grid gap-4 lg:grid-cols-2">
        {types.map((t) => (
          <Card key={t.id} data-testid="svt-row" data-code={t.code}>
            <CardHeader>
              <CardTitle className="flex flex-wrap items-center gap-2"><span className="min-w-0 break-words">{tname(t)}</span><span className="text-xs font-normal text-muted-foreground">{t.code}</span>{!t.active && <Badge variant="secondary">off</Badge>}</CardTitle>
              <CardDescription>{t.kind === "COLLECTION" ? `Collection · ${t.unit}` : t.kind === "PRINT" ? "Printing" : "Visit"}{t.wasteCode ? ` · LER ${t.wasteCode}` : ""} · {t.frequencies.map((f) => f.toLowerCase().replace("_", " ")).join(", ")}{t.countries.length ? ` · ${t.countries.join(", ")}` : ""}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <p data-testid="svt-by" data-by={t.invoicedBy}><Badge variant={t.invoicedBy === "PROVIDER" ? "warning" : "default"}>{t.invoicedBy === "PROVIDER" ? "Provider invoices · commission" : "FIRINGI invoices"}</Badge></p>
              <p className="text-xs text-muted-foreground">
                Customer: {money("en", n(t.feeNet))}/visit{n(t.pricePerUnit) > 0 ? ` + ${money("en", n(t.pricePerUnit))}/${t.unit}` : ""}{n(t.buybackPerUnit) > 0 ? ` · paid ${money("en", n(t.buybackPerUnit))}/${t.unit}` : ""}
                {t.invoicedBy === "PROVIDER" ? ` · commission ${n(t.commissionPct)}%${n(t.commissionPerVisit) > 0 ? ` + ${money("en", n(t.commissionPerVisit))}/visit` : ""}${n(t.commissionPerUnit) > 0 ? ` + ${money("en", n(t.commissionPerUnit))}/${t.unit}` : ""}` : ` · provider ${money("en", n(t.providerPerVisit))}/visit${n(t.providerPerUnit) > 0 ? ` + ${money("en", n(t.providerPerUnit))}/${t.unit}` : ""}`}
              </p>
              <p className="text-xs text-muted-foreground">{t._count.plans} active plans · {t._count.providers} approved providers</p>
              {manage && <ServiceLanguages key={t.updatedAt.toISOString()} id={t.id} names={(t.name ?? {}) as Record<string, string>} descriptions={(t.description ?? {}) as Record<string, string>} />}
              {manage && <TypeEditor id={t.id} initial={draft(t)} />}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

async function Providers({ ctx, manage, rows }: { ctx: Awaited<ReturnType<typeof pagePortal>>; manage: boolean; rows: Awaited<ReturnType<typeof listProviders>> }) {
  const types = await listTypes(ctx, { all: true });
  return (
    <div className="space-y-4">
      {manage && <Card><CardContent className="space-y-6 pt-6"><AddProvider types={types.map((t) => ({ id: t.id, name: tname(t), needsDocument: t.needsDocument }))} /><AddFiringiProvider types={types.map((t) => ({ id: t.id, name: tname(t) }))} /></CardContent></Card>}
      <Card>
        <CardHeader><CardTitle>Providers</CardTitle><CardDescription>FIRINGI adds the providers (or provides a service itself) and sets who invoices the customer and the commission. Suppliers can only apply themselves if Settings allows it.</CardDescription></CardHeader>
        <CardContent>
          {!rows.length ? <p className="text-sm text-muted-foreground">No providers yet.</p> : (
            <ul className="divide-y">
              {rows.map((p) => (
                <li key={p.id} className="space-y-2 py-3" data-testid="svp-row" data-status={p.status} data-company={p.company}>
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="min-w-0 break-words font-medium">{p.company}</span><span className="text-xs text-muted-foreground">{p.companyType.toLowerCase()}</span>
                    <span>· {tname(p.serviceType)}</span>
                    <Badge variant={statusTone(p.status)}>{p.status.toLowerCase()}</Badge>
                    <Badge variant={p.pricing.invoicedBy === "PROVIDER" ? "warning" : "default"}>{p.pricing.invoicedBy === "PROVIDER" ? `provider invoices · ${num("en", p.pricing.commissionPct)}%` : "FIRINGI invoices"}{p.invoicedBy ? " (own)" : ""}</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">{p.countries.join(", ") || "all countries"} · {p._count.plans} active plans{p.licenceNumber ? ` · licence ${p.licenceNumber}` : ""}{p.licenceExpiresAt ? ` until ${isoDay(p.licenceExpiresAt)}` : ""}{p.note ? ` · “${p.note}”` : ""}</p>
                  {manage && <DecideProvider id={p.id} status={p.status} invoicedBy={p.invoicedBy} commissionPct={p.commissionPct == null ? null : n(p.commissionPct)} typeInvoicedBy={p.serviceType.invoicedBy} />}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

async function Visits({ ctx, l, manage, status, page }: { ctx: Awaited<ReturnType<typeof pagePortal>>; l: Record<string, string>; manage: boolean; status: string | null; page: number }) {
  const [plans, visits, providers] = await Promise.all([adminPlans(ctx), adminVisits(ctx, { status: status && STATUSES.includes(status) ? status : null, page }), listProviders(ctx, { status: "APPROVED" })]);
  const optsFor = (typeId: string) => providers.filter((p) => p.serviceTypeId === typeId).map((p) => ({ id: p.id, label: p.company }));
  const q = (x: Record<string, string | number | null>) => `/admin/services?${new URLSearchParams(Object.entries({ tab: "VISITS", ...x }).filter(([, v]) => v != null && v !== "").map(([k, v]) => [k, String(v)]))}`;
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader><CardTitle>Visits <span className="text-sm font-normal text-muted-foreground">{visits.total}</span></CardTitle>
          <nav className="flex flex-wrap gap-2 pt-2" aria-label="Status">{[null, ...STATUSES].map((s) => <a key={s ?? "all"} href={q({ status: s })} aria-current={s === status ? "page" : undefined} className={`rounded-full border px-3 py-0.5 text-xs ${s === status ? "border-primary bg-primary/10" : "hover:bg-muted"}`}>{s ? s.toLowerCase() : "all"}</a>)}</nav></CardHeader>
        <CardContent>
          {!visits.rows.length ? <p className="text-sm text-muted-foreground">No visits.</p> : (
            <ul className="divide-y" data-testid="sva-visits">
              {visits.rows.map((v) => (
                <li key={v.id} className="space-y-1 py-2" data-testid="sva-visit-row" data-status={v.status}>
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="w-28 shrink-0 tabular-nums">{day("en", v.date)}</span>
                    <span className="min-w-0 flex-1 basis-56 break-words">{v.customer} · {tname(v.serviceType)} <span className="text-xs text-muted-foreground">{v.number} · {v.providerName} · {v.origin.toLowerCase()}</span></span>
                    <Badge variant={statusTone(v.status)}>{v.status.toLowerCase()}</Badge>
                    {v.status === "DONE" && <span className="text-xs text-muted-foreground">{v.quantity != null ? `${num("en", n(v.quantity))} ${v.serviceType.unit} · ` : ""}{v.invoicedBy === "PROVIDER" ? `commission ${money("en", n(v.commissionNet))}` : `fee ${money("en", n(v.feeNet))} · provider ${money("en", n(v.providerAmount))}`}</span>}
                    {v.status === "DONE" && <a className="text-xs text-primary hover:underline" href={`/api/services/visits/${v.id}/document`} target="_blank" rel="noreferrer">PDF</a>}
                  </div>
                  {v.status === "MISSED" && v.missedReason && <p className="text-xs text-muted-foreground">{v.missedReason}</p>}
                  {manage && v.provider?.companyId === ctx.company.id && ["REQUESTED", "SCHEDULED", "CONFIRMED"].includes(v.status) && (
                    <ProviderVisit l={l} v={{ id: v.id, status: v.status, date: isoDay(v.date), isCollection: v.serviceType.kind === "COLLECTION", unit: v.serviceType.unit, needsSignature: v.serviceType.needsDocument, youInvoice: false, containers: 0 }} />
                  )}
                </li>
              ))}
            </ul>
          )}
          {visits.pages > 1 && <p className="flex gap-3 pt-3 text-sm">{page > 1 && <a className="text-primary hover:underline" href={q({ status, page: page - 1 })}>← Newer</a>}<span className="text-muted-foreground">Page {page} of {visits.pages}</span>{page < visits.pages && <a className="text-primary hover:underline" href={q({ status, page: page + 1 })}>Older →</a>}</p>}
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Plans <span className="text-sm font-normal text-muted-foreground">{plans.length}</span></CardTitle><CardDescription>Move a plan to another approved provider; its coming visits follow.</CardDescription></CardHeader>
        <CardContent>
          {!plans.length ? <p className="text-sm text-muted-foreground">No plans yet.</p> : (
            <ul className="divide-y">
              {plans.map((p) => (
                <li key={p.id} className="flex flex-wrap items-center gap-2 py-2 text-sm" data-testid="sva-plan-row">
                  <span className="min-w-0 flex-1 basis-56 break-words"><span className="font-medium">{p.customer}</span> · {tname(p.serviceType)} <span className="text-xs text-muted-foreground">{p.number} · {p.frequency.toLowerCase().replace("_", " ")} · {schedText(l, p)} · {p._count.visits} done</span></span>
                  <Badge variant={statusTone(p.status)}>{p.status.toLowerCase()}</Badge>
                  {manage ? <ReassignPlan planId={p.id} providerId={p.providerId} options={optsFor(p.serviceTypeId)} /> : <span className="text-xs text-muted-foreground">{p.providerName}</span>}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

async function Money({ finance }: { finance: boolean }) {
  const m = await moneyOpen();
  const buy = m.rows.filter((r) => r.invoicedBy === "FIRINGI" && !r.buybackPaidAt && n(r.buybackNet) > 0);
  const prov = m.rows.filter((r) => r.invoicedBy === "FIRINGI" && !r.providerPaidAt && n(r.providerAmount) > 0);
  const comm = m.rows.filter((r) => r.invoicedBy === "PROVIDER" && !r.commissionInvoiceId && n(r.commissionNet) > 0);
  const table = (rows: typeof m.rows, amount: (r: (typeof m.rows)[number]) => number, who: (r: (typeof m.rows)[number]) => string, testid: string) => (!rows.length ? <p className="text-sm text-muted-foreground">Nothing open.</p> : (
    <ul className="divide-y" data-testid={testid}>{rows.map((r) => <li key={r.id} className="flex flex-wrap items-center gap-2 py-1.5 text-sm"><span className="w-24 shrink-0 tabular-nums text-muted-foreground">{r.doneAt ? isoDay(r.doneAt) : "—"}</span><span className="min-w-0 flex-1 basis-48 break-words">{who(r)} · {r.service} <span className="text-xs text-muted-foreground">{r.number}{r.quantity != null ? ` · ${num("en", n(r.quantity))} ${r.serviceType.unit}` : ""}</span></span><span className="font-medium tabular-nums">{money("en", amount(r))}</span></li>)}</ul>
  ));
  return (
    <div className="grid gap-6 xl:grid-cols-3">
      <Card><CardHeader><CardTitle>Oil buy-back to pay · {money("en", m.buyback)}</CardTitle><CardDescription>FIRINGI pays customers for their used oil.</CardDescription></CardHeader>
        <CardContent className="space-y-3">{table(buy, (r) => n(r.buybackNet), (r) => r.customer, "svm-buyback")}{finance && <MarkPaid ids={buy.map((r) => r.id)} what="BUYBACK" label="Mark all paid" />}</CardContent></Card>
      <Card><CardHeader><CardTitle>Owed to providers · {money("en", m.provider)}</CardTitle><CardDescription>Services FIRINGI invoiced: the providers&apos; amounts.</CardDescription></CardHeader>
        <CardContent className="space-y-3">{table(prov, (r) => n(r.providerAmount), (r) => r.provider, "svm-provider")}{finance && <MarkPaid ids={prov.map((r) => r.id)} what="PROVIDER" label="Mark all paid" />}</CardContent></Card>
      <Card><CardHeader><CardTitle>Commission to invoice · {money("en", m.commission)}</CardTitle><CardDescription>Providers invoiced their customers; FIRINGI invoices its commission to them (automatically on the 1st of each month).</CardDescription></CardHeader>
        <CardContent className="space-y-3">{table(comm, (r) => n(r.commissionNet), (r) => r.provider, "svm-commission")}{finance && <InvoiceCommissions disabled={!comm.length} />}</CardContent></Card>
      {!finance && <p className="text-xs text-muted-foreground xl:col-span-3">Recording payments and invoicing need the Finance right.</p>}
    </div>
  );
}

async function Settings({ ctx, manage, s }: { ctx: Awaited<ReturnType<typeof pagePortal>>; manage: boolean; s: Awaited<ReturnType<typeof servicesSettings>> }) {
  const overrides = await overrideCompanies(ctx);
  const { companies: _c, ...form } = s;
  void _c;
  return (
    <div className="space-y-6">
      <Card><CardHeader><CardTitle>Switches</CardTitle></CardHeader><CardContent>{manage ? <ServicesSettingsForm initial={form} /> : <p className="text-sm text-muted-foreground">Your role can&apos;t change these.</p>}</CardContent></Card>
      <Card>
        <CardHeader><CardTitle>Per business</CardTitle><CardDescription>Switch services on or off for one business, whatever its type.</CardDescription></CardHeader>
        <CardContent className="space-y-4">
          {!!overrides.length && <ul className="divide-y rounded-lg border">{overrides.map((c) => <li key={c.id} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm"><span className="min-w-0 flex-1 break-words">{c.name} <span className="text-xs text-muted-foreground">· {c.type.toLowerCase()}</span></span>{manage ? <CompanyServicesSwitch companyId={c.id} state={c.state} /> : <Badge>{c.state}</Badge>}</li>)}</ul>}
          {manage && <FindServicesBusiness />}
        </CardContent>
      </Card>
    </div>
  );
}
