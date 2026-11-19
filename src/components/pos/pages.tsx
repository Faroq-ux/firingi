/** Phase 47 — the till's pages, shared by the supplier (/vendor/pos) and customer (/buy/pos) portals. */
import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { BarChart3, Calculator, ClipboardList, Cog, Package, Receipt, Users, Warehouse } from "lucide-react";
import type { Ctx } from "@/server/context";
import { can } from "@/server/rbac/guard";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyRow, TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { formatMoney } from "@/lib/utils";
import { posAccess } from "@/server/pos/settings";
import * as P from "@/server/pos/service";
import { Till } from "./till";
import { Aurora, Sparkline } from "@/components/motion/shapes";
import { Tile } from "@/components/motion/dashboard-kit";
import { CountUp } from "@/components/motion/count-up";
import { Banknote, ShoppingBag, TrendingUp } from "lucide-react";
import { CompanyForm, FiscalForm, GuestForm, ImportButton, ItemForm, PinForm, RecipeForm, RefundForm, RegisterForm, RegisterPeople, ReorderButton, RetryButton, type ItemRow } from "./forms";

type Portal = "vendor" | "buy";
const base = (p: Portal) => `/${p}/pos`;

/** FIRINGI hasn't switched the till on for this company (or not for this portal). */
async function gate(ctx: Ctx) {
  const t = await getTranslations("pos");
  const a = await posAccess(ctx.company.id);
  if (a.on) return null;
  return (
    <>
      <PageHeader title={t("title")} icon={Calculator} />
      <Card><CardContent className="pt-5 text-sm" data-testid="pos-off">{t(`off_${a.reason}`)}</CardContent></Card>
    </>
  );
}

export async function PosOverviewPage({ ctx, portal }: { ctx: Ctx; portal: Portal }) {
  const off = await gate(ctx); if (off) return off;
  const [t, locale] = await Promise.all([getTranslations("pos"), getLocale()]);
  const o = await P.posOverview(ctx);
  const m = (v: number) => formatMoney(v, locale, o.access.currency);
  const money$ = `money:${o.access.currency}` as const;
  return (
    <>
      <PageHeader title={t("title")} icon={Calculator} description={portal === "buy" ? t("introCustomer") : t("introSupplier")} />
      <Card className="mb-4"><CardContent className="space-y-1 pt-5 text-sm" data-testid="pos-stage">
        <p>{o.access.stage === "PROVIDER" ? t("stageProviderLong") : o.access.countryStage === "PROVIDER" && o.access.blocked ? t("stageBlockedLong") : t("stageNonFiscalLong")}</p>
        <p className="text-muted-foreground">{t("ownSalesNote")}</p>
      </CardContent></Card>
      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Tile icon={ShoppingBag} label={t("todaySales")} value={o.today.count} locale={locale} tone="tone-blue" i={0} testId="kpi-count" />
        <Tile icon={Banknote} label={t("todayGross")} value={o.today.gross} fmt={money$} locale={locale} tone="tone-teal" i={1} testId="kpi-gross" />
        <Tile icon={TrendingUp} label={t("average")} value={o.today.average} fmt={money$} locale={locale} tone="tone-violet" i={2} testId="kpi-avg" />
        <Tile icon={Package} label={t("items")} value={o.items} locale={locale} tone="tone-orange" i={3} testId="kpi-items" />
      </div>
      {(o.pending > 0 || o.failed > 0) && <Card className="mb-4 border-amber-500/40"><CardContent className="pt-5 text-sm" data-testid="pos-fiscal-waiting">{t("fiscalWaiting", { pending: o.pending, failed: o.failed })} <Link className="text-primary hover:underline" href={`${base(portal)}/sales?fiscal=1`}>{t("seeReceipts")}</Link></CardContent></Card>}
      <Card><CardHeader><CardTitle>{t("tills")}</CardTitle></CardHeader><CardContent className="overflow-x-auto">
        <Table data-testid="pos-registers">
          <THead><TR><TH>{t("tillName")}</TH><TH>{t("tillCode")}</TH><TH>{t("shift")}</TH><TH /></TR></THead>
          <TBody>
            {o.registers.length === 0 && <EmptyRow colSpan={4}>{o.manage ? <Link className="text-primary hover:underline" href={`${base(portal)}/settings`}>{t("addFirstTill")}</Link> : t("noTillForYou")}</EmptyRow>}
            {o.registers.map((r) => <TR key={r.id}><TD>{r.name}</TD><TD>{r.code}</TD><TD>{r.shifts[0] ? <Badge variant="success">{t("shiftOpenSince", { n: r.shifts[0].number, time: new Intl.DateTimeFormat(locale, { timeStyle: "short" }).format(r.shifts[0].openedAt) })}</Badge> : <Badge variant="secondary">{t("closed")}</Badge>}</TD><TD><Link className="text-primary hover:underline" href={`${base(portal)}/till?register=${r.id}`} data-testid="pos-open-till">{t("openTill")}</Link></TD></TR>)}
          </TBody>
        </Table>
      </CardContent></Card>
    </>
  );
}

export async function PosTillPage({ ctx, portal, registerId }: { ctx: Ctx; portal: Portal; registerId?: string }) {
  const off = await gate(ctx); if (off) return off;
  const locale = await getLocale();
  const snap = await P.tillSnapshot(ctx, registerId ?? null);
  return <Till portal={portal} initial={snap} locale={locale} />;
}

export async function PosItemsPage({ ctx, portal, edit }: { ctx: Ctx; portal: Portal; edit?: string }) {
  const off = await gate(ctx); if (off) return off;
  const [t, locale] = await Promise.all([getTranslations("pos"), getLocale()]);
  const { items, currency, type } = await P.listItems(ctx);
  const customer = type === "CUSTOMER";
  const manage = can(ctx, "company.pos.manage");
  const offerList = !customer && manage ? await P.ownOffers(ctx, locale) : [];
  const purchased = customer && manage ? await P.purchasedOffers(ctx, locale) : [];
  const current = edit ? items.find((i) => i.id === edit) : null;
  const tills = manage ? (await P.posSetup(ctx)).registers.filter((r) => r.approval === "APPROVED").map((r) => ({ id: r.id, label: `${r.code} · ${r.name}` })) : [];
  const tillName = new Map(tills.map((r) => [r.id, r.label.split(" · ")[0]]));
  return (
    <>
      <PageHeader title={t("itemsTitle")} icon={Package} description={customer ? t("itemsIntroCustomer") : t("itemsIntroSupplier")} />
      {manage && <Card className="mb-4"><CardHeader><CardTitle>{current ? t("editItem", { name: current.name }) : t("newItem")}</CardTitle></CardHeader><CardContent className="space-y-4">
        {!customer && !current && <ImportButton />}
        <ItemForm key={current?.id ?? "new"} item={current as unknown as ItemRow} offers={offerList} customer={customer} tills={tills} />
        {customer && current && <div className="border-t pt-3"><h3 className="mb-2 text-sm font-semibold">{t("recipe")}</h3><p className="mb-2 text-xs text-muted-foreground">{t("recipeHelp")}</p><RecipeForm itemId={current.id} lines={current.recipe.map((r) => ({ offerId: r.offerId, qty: r.qty.toString(), unit: r.unit }))} purchased={purchased} /></div>}
      </CardContent></Card>}
      <Card><CardContent className="overflow-x-auto pt-5">
        <Table data-testid="pos-items">
          <THead><TR><TH>{t("name")}</TH><TH>{t("category")}</TH><TH className="text-right">{t("price")}</TH><TH>{t("vatRate")}</TH><TH>{t("barcode")}</TH><TH>{customer ? t("recipe") : t("stock")}</TH><TH>{t("itemTills")}</TH><TH /></TR></THead>
          <TBody>
            {items.length === 0 && <EmptyRow colSpan={8}>{t("noItems")}</EmptyRow>}
            {items.map((i) => (
              <TR key={i.id} className={i.active ? "" : "opacity-50"}>
                <TD className="min-w-0 break-words font-medium">{i.name}{i.restriction && <Badge variant="warning" className="ml-1">18+</Badge>}{i.byWeight && <span className="ml-1 text-xs text-muted-foreground">/kg</span>}</TD>
                <TD>{i.category ?? "—"}</TD>
                <TD className="whitespace-nowrap text-right tabular-nums">{formatMoney(Number(i.price), locale, currency)}</TD>
                <TD>{Number(i.vatRate)}%</TD>
                <TD className="text-xs">{i.barcode ?? (i.plu ? `PLU ${i.plu}` : "—")}</TD>
                <TD className="text-xs">{customer ? (i.recipe.length ? t("ingredientsN", { n: i.recipe.length }) : "—") : i.stock ?? "—"}</TD>
                <TD className="text-xs">{i.registerIds.length ? i.registerIds.map((r) => tillName.get(r) ?? "?").join(", ") : t("allTills")}</TD>
                <TD>{manage && <Link className="text-primary hover:underline" href={`${base(portal)}/items?edit=${i.id}`} data-testid="pos-item-edit">{t("edit")}</Link>}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </CardContent></Card>
    </>
  );
}

export async function PosSalesPage({ ctx, portal, sp }: { ctx: Ctx; portal: Portal; sp: { from?: string; to?: string; q?: string; fiscal?: string } }) {
  const off = await gate(ctx); if (off) return off;
  const [t, locale] = await Promise.all([getTranslations("pos"), getLocale()]);
  const from = sp.from ? new Date(sp.from) : new Date(Date.now() - 7 * 86_400_000);
  const to = sp.to ? new Date(new Date(sp.to).getTime() + 86_400_000) : undefined;
  let sales = await P.listSales(ctx, { from, to, q: sp.q });
  if (sp.fiscal) sales = sales.filter((s) => s.fiscalStatus === "PENDING" || s.fiscalStatus === "FAILED");
  const dt = new Intl.DateTimeFormat(locale, { dateStyle: "short", timeStyle: "short" });
  return (
    <>
      <PageHeader title={t("salesTitle")} icon={Receipt} description={t("salesIntro")} />
      <form className="mb-3 flex flex-wrap items-end gap-2 text-sm">
        <label className="space-y-1"><span className="block text-xs">{t("from")}</span><input className="h-9 rounded-md border bg-background px-2" type="date" name="from" defaultValue={from.toISOString().slice(0, 10)} /></label>
        <label className="space-y-1"><span className="block text-xs">{t("to")}</span><input className="h-9 rounded-md border bg-background px-2" type="date" name="to" defaultValue={sp.to ?? ""} /></label>
        <input className="h-9 rounded-md border bg-background px-2" name="q" placeholder={t("searchReceipt")} defaultValue={sp.q ?? ""} />
        <button className="h-9 rounded-md border px-3">{t("filter")}</button>
      </form>
      <Card><CardContent className="overflow-x-auto pt-5">
        <Table data-testid="pos-sales">
          <THead><TR><TH>{t("when")}</TH><TH>{t("receipt")}</TH><TH>{t("tillCode")}</TH><TH className="text-right">{t("total")}</TH><TH>{t("payments")}</TH><TH>{t("legalReceipt")}</TH></TR></THead>
          <TBody>
            {sales.length === 0 && <EmptyRow colSpan={6}>{t("noSales")}</EmptyRow>}
            {sales.map((s) => (
              <TR key={s.id}>
                <TD className="whitespace-nowrap text-xs">{dt.format(s.soldAt)}{s.offline && <Badge variant="secondary" className="ml-1">{t("offlineShort")}</Badge>}</TD>
                <TD><Link className="text-primary hover:underline" href={`${base(portal)}/sales/${s.id}`} data-testid="pos-sale-link">{s.fiscalNumber ?? s.number}</Link>{s.kind === "REFUND" && <Badge variant="destructive" className="ml-1">{t("refund")}</Badge>}</TD>
                <TD>{s.register.code}</TD>
                <TD className="whitespace-nowrap text-right tabular-nums">{s.kind === "REFUND" ? "−" : ""}{formatMoney(Number(s.gross), locale, s.currency)}</TD>
                <TD className="text-xs">{s.payments.map((p) => p.method).join(" + ")}</TD>
                <TD className="text-xs"><FiscalBadge t={t} status={s.fiscalStatus} /></TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </CardContent></Card>
    </>
  );
}

function FiscalBadge({ t, status }: { t: Awaited<ReturnType<typeof getTranslations>>; status: string }) {
  const tone = status === "DONE" ? "success" : status === "FAILED" ? "destructive" : status === "PENDING" ? "warning" : "secondary";
  return <Badge variant={tone as "success"} data-testid="pos-fiscal-badge">{t(`fiscal_${status}`)}</Badge>;
}

export async function PosSaleDetailPage({ ctx, portal, id }: { ctx: Ctx; portal: Portal; id: string }) {
  const off = await gate(ctx); if (off) return off;
  const [t, locale] = await Promise.all([getTranslations("pos"), getLocale()]);
  const s = await P.saleDetail(ctx, id);
  const money = (v: unknown) => formatMoney(Number(v), locale, s.currency);
  const back = new Map<string, number>();
  for (const r of s.refunds) for (const l of r.lines) { const src = (l.lots as { from?: string } | null)?.from; if (src) back.set(src, (back.get(src) ?? 0) + Number(l.qty)); }
  const manage = can(ctx, "company.pos.manage");
  const registers = s.kind === "SALE" ? await P.openRegisters(ctx) : [];
  return (
    <>
      <PageHeader title={`${s.kind === "REFUND" ? t("refund") : t("receipt")} ${s.fiscalNumber ?? s.number}`} icon={Receipt} />
      <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
        <Card><CardContent className="space-y-3 overflow-x-auto pt-5 text-sm">
          <div className="flex flex-wrap gap-2"><FiscalBadge t={t} status={s.fiscalStatus} />{s.fiscalStatus === "FAILED" || s.fiscalStatus === "PENDING" ? manage && <RetryButton id={s.id} /> : null}{s.fiscalError && <span className="text-xs text-destructive">{s.fiscalError}</span>}</div>
          <p className="text-xs text-muted-foreground">{new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(s.soldAt)} · {s.register.name} · {s.number}{s.refundOf ? ` · ${t("refundOf", { n: s.refundOf.number })}` : ""}</p>
          <Table data-testid="pos-sale-lines"><THead><TR><TH>{t("item")}</TH><TH className="text-right">{t("qty")}</TH><TH className="text-right">{t("price")}</TH><TH>{t("vatRate")}</TH><TH className="text-right">{t("total")}</TH></TR></THead>
            <TBody>{s.lines.map((l) => <TR key={l.id}><TD className="break-words">{l.name}{Number(l.discountPct) ? ` (−${Number(l.discountPct)}%)` : ""}</TD><TD className="text-right">{l.qty.toString()}</TD><TD className="text-right">{money(l.unitPrice)}</TD><TD>{Number(l.vatRate)}%</TD><TD className="text-right">{money(l.gross)}</TD></TR>)}</TBody></Table>
          <div className="text-right"><div>{t("netTotal")}: {money(s.net)} · {t("vat")}: {money(s.vat)}</div><div className="text-lg font-semibold" data-testid="pos-sale-total">{t("total")}: {money(s.gross)}</div></div>
          <div className="text-xs">{s.payments.map((p) => `${p.method} ${money(p.amount)}${p.change && Number(p.change) ? ` (${t("change")} ${money(p.change)})` : ""}`).join(" · ")}</div>
          {s.member && <p className="text-xs">{t("pointsLine", { name: s.member.name, n: s.pointsEarned })}</p>}
          <p className="break-all text-[11px] text-muted-foreground">#{s.hash.slice(0, 32)}…</p>
          <a className="text-primary hover:underline" href={`/r/${s.receiptToken}`} target="_blank" rel="noreferrer" data-testid="pos-receipt-link">{t("openReceiptPage")}</a>
          {s.refunds.length > 0 && <p className="text-xs">{t("refunds")}: {s.refunds.map((r) => r.number).join(", ")}</p>}
        </CardContent></Card>
        {s.kind === "SALE" && (
          <Card><CardHeader><CardTitle>{t("refund")}</CardTitle></CardHeader><CardContent>
            <RefundForm sale={{ id: s.id, payments: s.payments, lines: s.lines.map((l) => ({ id: l.id, name: l.name, qty: l.qty.toString(), gross: l.gross.toString(), left: String(Math.round((Number(l.qty) - (back.get(l.id) ?? 0)) * 1000) / 1000) })) }} registers={registers} />
            <p className="mt-2 text-xs text-muted-foreground">{manage ? t("refundManager") : t("refundCashier")}</p>
          </CardContent></Card>
        )}
      </div>
      <p className="mt-3 text-sm"><Link className="text-primary hover:underline" href={`${base(portal)}/sales`}>← {t("salesTitle")}</Link></p>
    </>
  );
}

export async function PosShiftsPage({ ctx }: { ctx: Ctx }) {
  const off = await gate(ctx); if (off) return off;
  const [t, locale] = await Promise.all([getTranslations("pos"), getLocale()]);
  const shifts = await P.listShifts(ctx);
  const cur = (await posAccess(ctx.company.id)).currency;
  const dt = new Intl.DateTimeFormat(locale, { dateStyle: "short", timeStyle: "short" });
  const m = (v: unknown) => (v == null ? "—" : formatMoney(Number(v), locale, cur));
  return (
    <>
      <PageHeader title={t("shiftsTitle")} icon={ClipboardList} description={t("shiftsIntro")} />
      <Card><CardContent className="overflow-x-auto pt-5">
        <Table data-testid="pos-shifts">
          <THead><TR><TH>{t("tillCode")}</TH><TH>{t("shift")}</TH><TH>{t("opened")}</TH><TH>{t("closedAt")}</TH><TH className="text-right">{t("sales")}</TH><TH className="text-right">{t("zGross")}</TH><TH className="text-right">{t("expectedCash")}</TH><TH className="text-right">{t("countedCash")}</TH><TH className="text-right">{t("difference")}</TH></TR></THead>
          <TBody>
            {shifts.length === 0 && <EmptyRow colSpan={9}>{t("noShifts")}</EmptyRow>}
            {shifts.map((s) => {
              const z = s.zReport as { gross?: number } | null;
              const d = s.difference == null ? null : Number(s.difference);
              return <TR key={s.id}><TD>{s.register.code}</TD><TD>{s.number}{s.status === "OPEN" && <Badge variant="success" className="ml-1">{t("open")}</Badge>}</TD><TD className="whitespace-nowrap text-xs">{dt.format(s.openedAt)}</TD><TD className="whitespace-nowrap text-xs">{s.closedAt ? dt.format(s.closedAt) : "—"}</TD><TD className="text-right">{s._count.sales}</TD><TD className="text-right tabular-nums">{z?.gross != null ? m(z.gross) : "—"}</TD><TD className="text-right tabular-nums">{m(s.expectedCash)}</TD><TD className="text-right tabular-nums">{m(s.countedCash)}</TD><TD className={`text-right tabular-nums ${d && d < 0 ? "text-destructive" : ""}`}>{d == null ? "—" : m(d)}</TD></TR>;
            })}
          </TBody>
        </Table>
      </CardContent></Card>
    </>
  );
}

export async function PosReportsPage({ ctx, sp }: { ctx: Ctx; sp: { from?: string; to?: string; register?: string } }) {
  const off = await gate(ctx); if (off) return off;
  const [t, locale] = await Promise.all([getTranslations("pos"), getLocale()]);
  const to = sp.to ? new Date(new Date(sp.to).getTime() + 86_400_000) : new Date(new Date().toISOString().slice(0, 10) + "T00:00:00Z").getTime() + 86_400_000;
  const from = sp.from ? new Date(sp.from) : new Date(Number(to) - 30 * 86_400_000);
  const ov = await P.posOverview(ctx);
  if (!ov.managesTills) return (<><PageHeader title={t("reportsTitle")} icon={BarChart3} /><Card><CardContent className="pt-5 text-sm" data-testid="pos-reports-managers">{t("reportsManagersOnly")}</CardContent></Card></>);
  const r = await P.salesReport(ctx, { from, to: new Date(to), registerId: sp.register || undefined });
  const m = (v: number) => formatMoney(v, locale, r.currency);
  const pay = (k: string) => (k === "CASH" ? t("payCash") : k === "CARD" ? t("payCard") : k === "POINTS" ? t("payPointsShort") : k === "MBWAY" ? "MB WAY" : t("payOther"));
  return (
    <>
      <PageHeader title={t("reportsTitle")} icon={BarChart3} description={t("reportsIntro")} />
      <form className="mb-3 flex flex-wrap items-end gap-2 text-sm">
        <label className="space-y-1"><span className="block text-xs">{t("from")}</span><input className="h-9 rounded-md border bg-background px-2" type="date" name="from" defaultValue={from.toISOString().slice(0, 10)} /></label>
        <label className="space-y-1"><span className="block text-xs">{t("to")}</span><input className="h-9 rounded-md border bg-background px-2" type="date" name="to" defaultValue={new Date(Number(new Date(to)) - 86_400_000).toISOString().slice(0, 10)} /></label>
        {r.tills.length > 1 && <label className="space-y-1"><span className="block text-xs">{t("tills")}</span><select className="h-9 rounded-md border bg-background px-2" name="register" defaultValue={r.registerId ?? ""} data-testid="pos-report-till"><option value="">{t("allTills")}</option>{r.tills.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}</select></label>}
        <button className="h-9 rounded-md border px-3">{t("filter")}</button>
      </form>
      <Aurora className="mb-4 rounded-2xl p-4">
        <div className="grid gap-3 sm:grid-cols-4" data-testid="pos-report-kpis">
          {([[t("sales"), r.totals.count, "int"], [t("netTotal"), r.totals.gross, `money:${r.currency}`], [t("average"), r.average, `money:${r.currency}`], [t("refunds"), r.totals.refundsGross, `money:${r.currency}`]] as const).map(([k, v, f], i) => (
            <div key={k} className="stat-card glass motion-rise rounded-xl p-3" style={{ ["--i" as string]: i } as React.CSSProperties}><div className="text-[11px] font-semibold uppercase tracking-wider text-white/80">{k}</div><div className="text-2xl font-semibold text-white"><CountUp value={v} fmt={f as "int"} locale={locale} /></div></div>
          ))}
        </div>
        {r.byDay.length > 1 && <div className="mt-3"><Sparkline values={r.byDay.map((d) => d.gross)} label={t("byDay")} color="white" height={48} /></div>}
      </Aurora>
      {r.byTill.length > 1 && <Card className="mb-4"><CardHeader><CardTitle>{t("byTill")}</CardTitle></CardHeader><CardContent className="overflow-x-auto"><Table data-testid="pos-report-tills"><THead><TR><TH>{t("tillCode")}</TH><TH>{t("shopLabel")}</TH><TH className="text-right">{t("sales")}</TH><TH className="text-right">{t("payCash")}</TH><TH className="text-right">{t("payCard")}</TH><TH className="text-right">{t("netTotal")}</TH></TR></THead><TBody>{r.byTill.map((x) => <TR key={x.id}><TD>{x.code} · {x.name}</TD><TD>{x.shop ?? "—"}</TD><TD className="text-right">{x.count}</TD><TD className="text-right tabular-nums">{m(x.cash)}</TD><TD className="text-right tabular-nums">{m(x.card)}</TD><TD className="text-right tabular-nums">{m(x.gross)}</TD></TR>)}</TBody></Table></CardContent></Card>}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card><CardHeader><CardTitle>{t("byPayment")}</CardTitle></CardHeader><CardContent><Table data-testid="pos-report-pay"><TBody>{Object.entries(r.totals.byPayment).map(([k, v]) => <TR key={k}><TD>{pay(k)}</TD><TD className="text-right tabular-nums">{m(v)}</TD></TR>)}</TBody></Table></CardContent></Card>
        <Card><CardHeader><CardTitle>{t("byVat")}</CardTitle></CardHeader><CardContent><Table><THead><TR><TH>{t("vatRate")}</TH><TH className="text-right">{t("netTotal")}</TH><TH className="text-right">{t("vat")}</TH><TH className="text-right">{t("total")}</TH></TR></THead><TBody>{r.totals.byRate.map((x) => <TR key={x.rate}><TD>{x.rate}%</TD><TD className="text-right">{m(x.net)}</TD><TD className="text-right">{m(x.vat)}</TD><TD className="text-right">{m(x.gross)}</TD></TR>)}</TBody></Table></CardContent></Card>
        <Card><CardHeader><CardTitle>{t("byDay")}</CardTitle></CardHeader><CardContent className="overflow-x-auto"><Table data-testid="pos-report-days"><TBody>{r.byDay.map((d) => <TR key={d.day}><TD>{d.day}</TD><TD className="text-right">{d.count}</TD><TD className="text-right tabular-nums">{m(d.gross)}</TD></TR>)}{r.byDay.length === 0 && <EmptyRow colSpan={3}>{t("noSales")}</EmptyRow>}</TBody></Table></CardContent></Card>
        <Card><CardHeader><CardTitle>{t("topItems")}</CardTitle></CardHeader><CardContent>
          <ul className="space-y-3" data-testid="pos-report-items">{(() => { const top = r.byItem.slice(0, 12); const max = Math.max(1, ...top.map((x) => x.gross)); const tones = ["var(--vivid-blue)", "var(--vivid-violet)", "var(--vivid-pink)", "var(--vivid-orange)", "var(--vivid-teal)"]; return top.map((i, n) => (
            <li key={i.name}><div className="mb-1 flex justify-between gap-2 text-sm"><span className="min-w-0 truncate">{i.name} <span className="text-xs text-muted-foreground">× {i.qty}</span></span><span className="shrink-0 font-semibold tabular-nums">{m(i.gross)}</span></div>
              <div className="h-2 overflow-hidden rounded-full bg-muted"><div className="motion-grow-x h-full rounded-full" style={{ width: `${Math.max(4, (i.gross / max) * 100)}%`, background: tones[n % tones.length], ["--i" as string]: n } as React.CSSProperties} /></div></li>
          )); })()}</ul>
        </CardContent></Card>
        <Card><CardHeader><CardTitle>{t("byCashier")}</CardTitle></CardHeader><CardContent><Table><TBody>{Object.entries(r.totals.byCashier).map(([u, v]) => <TR key={u}><TD>{r.names[u] ?? "—"}</TD><TD className="text-right">{v.count}</TD><TD className="text-right tabular-nums">{m(v.gross)}</TD></TR>)}</TBody></Table></CardContent></Card>
      </div>
      <p className="mt-3 text-xs text-muted-foreground">{t("reportsAccountingNote")}</p>
    </>
  );
}

export async function PosGuestsPage({ ctx, q }: { ctx: Ctx; q?: string }) {
  const off = await gate(ctx); if (off) return off;
  const [t, locale] = await Promise.all([getTranslations("pos"), getLocale()]);
  const members = await P.listMembers(ctx, q ?? "");
  const a = await posAccess(ctx.company.id);
  return (
    <>
      <PageHeader title={t("guestsTitle")} icon={Users} description={t("guestsIntro")} />
      {!a.company?.loyaltyOn && <Card className="mb-4"><CardContent className="pt-5 text-sm" data-testid="pos-loyalty-off">{t("loyaltyOffNote")}</CardContent></Card>}
      <Card className="mb-4"><CardContent className="pt-5"><GuestForm /></CardContent></Card>
      <Card><CardContent className="overflow-x-auto pt-5">
        <form className="mb-2"><input className="h-9 w-full max-w-xs rounded-md border bg-background px-2 text-sm" name="q" placeholder={t("guestSearch")} defaultValue={q ?? ""} /></form>
        <Table data-testid="pos-guests"><THead><TR><TH>{t("name")}</TH><TH>{t("cardNumber")}</TH><TH>{t("phone")}</TH><TH className="text-right">{t("points")}</TH><TH>{t("since")}</TH></TR></THead>
          <TBody>{members.length === 0 && <EmptyRow colSpan={5}>{t("guestNone")}</EmptyRow>}{members.map((m) => <TR key={m.id}><TD>{m.name}</TD><TD className="text-xs">{m.code}</TD><TD className="text-xs">{m.phone ?? "—"}</TD><TD className="text-right">{m.points}</TD><TD className="text-xs">{new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(m.createdAt)}</TD></TR>)}</TBody></Table>
      </CardContent></Card>
    </>
  );
}

export async function PosStockPage({ ctx }: { ctx: Ctx }) {
  const off = await gate(ctx); if (off) return off;
  const [t, locale] = await Promise.all([getTranslations("pos"), getLocale()]);
  const rows = await P.ingredientStock(ctx, locale);
  return (
    <>
      <PageHeader title={t("stockTitle")} icon={Warehouse} description={t("stockIntro")} />
      <Card><CardContent className="overflow-x-auto pt-5">
        <Table data-testid="pos-stock"><THead><TR><TH>{t("ingredient")}</TH><TH>{t("usedIn")}</TH><TH className="text-right">{t("packsLeft")}</TH><TH className="text-right">{t("perDay")}</TH><TH className="text-right">{t("daysLeft")}</TH><TH>{t("nextExpiry")}</TH><TH>{t("reorder")}</TH></TR></THead>
          <TBody>
            {rows.length === 0 && <EmptyRow colSpan={7}>{t("stockNone")}</EmptyRow>}
            {rows.map((r) => <TR key={r.offerId}><TD className="min-w-0 break-words">{r.name}</TD><TD className="text-xs">{r.dishes.join(", ")}</TD><TD className="text-right">{r.left}</TD><TD className="text-right">{r.usedPerDay}</TD><TD className={`text-right ${r.daysLeft != null && r.daysLeft <= 3 ? "font-semibold text-destructive" : ""}`}>{r.daysLeft ?? "—"}</TD><TD className="text-xs">{r.nextExpiry ?? "—"}</TD><TD>{r.active ? <ReorderButton offerId={r.offerId} qty={r.suggest} /> : <span className="text-xs text-muted-foreground">{t("notSoldNow")}</span>}</TD></TR>)}
          </TBody>
        </Table>
      </CardContent></Card>
    </>
  );
}

export async function PosSettingsPage({ ctx, portal }: { ctx: Ctx; portal: Portal }) {
  const off = await gate(ctx); if (off) return off;
  const t = await getTranslations("pos");
  const v = await P.posSetup(ctx);
  const vendor = portal === "vendor";
  return (
    <>
      <PageHeader title={t("settingsTitle")} icon={Cog} description={t("settingsIntro")} />
      <Card className="mb-4"><CardHeader><CardTitle>{t("tills")}</CardTitle></CardHeader><CardContent className="space-y-3" data-testid="pos-tills-card">
        <p className="text-xs text-muted-foreground" data-testid="pos-till-approval-note">{t("tillApprovalNote", { n: v.tillsWithoutApproval })}</p>
        {v.registers.map((r) => <div key={r.id} className="space-y-2 border-b pb-3">{r.approval !== "APPROVED" && <Badge variant={r.approval === "PENDING" ? "warning" : "destructive"} data-testid="pos-till-status">{r.approval === "PENDING" ? t("tillPending") : `${t("tillRejected")}${r.decisionNote ? ` — ${r.decisionNote}` : ""}`}</Badge>}<RegisterForm reg={r} warehouses={v.warehouses} branches={v.branches} vendor={vendor} /><RegisterPeople registerId={r.id} people={v.people.map((p) => ({ userId: p.userId, name: p.name }))} current={r.users} /></div>)}
        <div className="pt-1"><RegisterForm warehouses={v.warehouses} branches={v.branches} vendor={vendor} /></div>
        <p className="text-xs text-muted-foreground">{t("devicesNote")}</p>
      </CardContent></Card>
      <Card className="mb-4"><CardHeader><CardTitle>{t("receiptsLoyalty")}</CardTitle></CardHeader><CardContent><CompanyForm c={v.company} currency={v.access.currency} /></CardContent></Card>
      <Card className="mb-4"><CardHeader><CardTitle>{t("certifiedProvider")}</CardTitle></CardHeader><CardContent className="space-y-2 text-sm" data-testid="pos-fiscal-card">
        <p>{v.access.countryStage === "PROVIDER" ? t("countryNeedsProvider") : t("countryNonFiscal")}</p>
        <FiscalForm providers={v.providers} current={v.company.fiscalProvider} account={v.company.fiscalAccount} hint={v.company.fiscalSecretHint} testOk={v.company.fiscalTestOk} />
      </CardContent></Card>
      <Card><CardHeader><CardTitle>{t("pins")}</CardTitle></CardHeader><CardContent className="overflow-x-auto">
        <p className="mb-2 text-xs text-muted-foreground">{t("pinsHelp")}</p>
        <Table data-testid="pos-pins"><THead><TR><TH>{t("name")}</TH><TH>{t("role")}</TH><TH>{t("pin")}</TH></TR></THead>
          <TBody>{v.people.map((p) => <TR key={p.userId}><TD>{p.name}</TD><TD>{p.manager ? t("manager") : t("cashier")}</TD><TD><span className="mr-2 text-xs">{p.hasPin ? "✓" : "—"}</span><PinForm userId={p.userId} self={p.userId === ctx.user.id} /></TD></TR>)}</TBody></Table>
      </CardContent></Card>
    </>
  );
}
