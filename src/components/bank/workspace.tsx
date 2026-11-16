/** Bank reconciliation pages (Phase 37) — one workspace for FIRINGI (English) and each supplier / customer (their language). */
import Link from "next/link";
import { getLocale, getMessages } from "next-intl/server";
import { Landmark } from "lucide-react";
import { getContext } from "@/server/context";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { bankEntities, bankOverview, bankSettings, listLines, listPayerLinks, listRules, listStatements, ownerOf } from "@/server/bank/service";
import { feedProvider } from "@/server/bank/feed";
import en from "@/messages/en.json";
import { AccountForm, AutoBookSwitch, BankSettingsForm, DeleteAccountButton, DeleteRow, FeedControls, ImportStatement, LineCard, RematchButton, RuleForm, type L, type LineView, type Side } from "./client";

export type Portal = "admin" | "vendor" | "buy";
export type Tab = "lines" | "accounts" | "rules" | "settings";
const flat = (o: Record<string, unknown>, p = ""): Record<string, string> =>
  Object.fromEntries(Object.entries(o).flatMap(([k, v]) => (typeof v === "string" ? [[p + k, v]] : Object.entries(flat(v as Record<string, unknown>, `${p}${k}.`)))));
const f = (s: string | undefined, v: Record<string, string | number> = {}) => (s ?? "").replace(/\{(\w+)\}/g, (_, k: string) => String(v[k] ?? `{${k}}`));

async function labels(english: boolean) {
  if (english) return { l: flat(en.bank), locale: "en-GB" };
  const [m, locale] = await Promise.all([getMessages(), getLocale()]);
  return { l: { ...flat(en.bank), ...flat(((m as { bank?: object }).bank ?? {}) as Record<string, unknown>) }, locale };
}

const base = (p: Portal) => (p === "admin" ? "/admin/finance/bank" : p === "vendor" ? "/vendor/finance/bank" : "/buy/finance/bank");

export async function BankWorkspace({ portal, tab, sp }: { portal: Portal; tab: Tab; sp: { status?: string; account?: string; q?: string; feed?: string } }) {
  const ctx = await getContext();
  if (!ctx) redirect("/login");
  let owner;
  try { owner = ownerOf(ctx); } catch { redirect(portal === "admin" ? "/admin" : `/${portal}`); }
  const english = portal === "admin";
  const { l, locale } = await labels(english);
  const canManage = (() => { try { ownerOf(ctx, true); return true; } catch { return false; } })();
  const side: Side = owner.side;
  const [o, s] = await Promise.all([bankOverview(owner), bankSettings()]);
  const money = (n: number | string | null | undefined, ccy = "EUR") => (n == null ? "—" : new Intl.NumberFormat(locale, { style: "currency", currency: ccy }).format(Number(n)));
  const date = (d: Date | string | null | undefined) => (d ? new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(new Date(d)) : "—");
  const feedOn = s.feed.enabled && (side === "FIRINGI" || s.feed.companiesMayLink);
  const tabs: [Tab, string][] = [["lines", l.tabLines], ["accounts", l.tabAccounts], ["rules", l.tabRules], ...(side === "FIRINGI" ? [["settings", "Settings"] as [Tab, string]] : [])];
  const href = (t: Tab) => (t === "lines" ? base(portal) : `${base(portal)}/${t}`);

  return (
    <>
      <PageHeader title={side === "FIRINGI" ? "Bank Reconciliation" : l.title} icon={Landmark} description={side === "FIRINGI" ? l.introFiringi : l.intro} />
      <nav className="mb-4 flex flex-wrap gap-2 text-sm" aria-label={l.title} data-testid="bank-tabs">
        {tabs.map(([t, label]) => <Link key={t} href={href(t)} className={`rounded-md border px-3 py-1.5 ${tab === t ? "bg-primary text-primary-foreground" : "hover:bg-accent"}`}>{label}{t === "lines" && o.todo ? ` (${o.todo})` : ""}</Link>)}
      </nav>
      {sp.feed && <p className={`mb-4 rounded-lg border p-3 text-sm ${sp.feed === "linked" ? "" : "border-destructive text-destructive"}`} role="status" data-testid="feed-result">{sp.feed === "linked" ? l.feedDone : l.feedFailed}</p>}

      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4" data-testid="bank-kpis">
        <Kpi label={l.kpiTodo} value={String(o.todo)} hint={o.oldestTodo ? f(l.kpiOldest, { date: date(o.oldestTodo) }) : ""} />
        <Kpi label={l.kpiMatched} value={String(o.matched30)} hint={f(l.kpiAuto, { n: o.autoMatched30 })} />
        <Kpi label={l.kpiAccounts} value={String(o.accounts.filter((a) => a.active).length)} hint="" />
        <Kpi label={l.kpiBalance} value={o.accounts.some((a) => a.active && a.balance != null) ? money(o.accounts.filter((a) => a.active).reduce((a, x) => a + Number(x.balance ?? 0), 0)) : "—"} hint={l.kpiBalanceHint} />
      </div>

      {tab === "lines" && await LinesTab()}
      {tab === "accounts" && await AccountsTab()}
      {tab === "rules" && await RulesTab()}
      {tab === "settings" && side === "FIRINGI" && (
        <Card><CardContent className="pt-6"><BankSettingsForm initial={s} feedReady={{ SIMULATED: feedProvider("SIMULATED").ready(), GOCARDLESS: feedProvider("GOCARDLESS").ready() }} /></CardContent></Card>
      )}
    </>
  );

  async function LinesTab() {
    const status = (["TODO", "MATCHED", "IGNORED", "ALL"].includes(sp.status ?? "") ? sp.status : "TODO") as "TODO" | "MATCHED" | "IGNORED" | "ALL";
    const lines = await listLines(owner!, { status, accountId: sp.account || undefined, q: sp.q || undefined });
    const views: LineView[] = lines.map((x) => ({
      id: x.id, date: x.bookingDate.toISOString(), amount: Number(x.amount), currency: x.currencyCode, counterparty: x.counterparty, iban: x.counterpartyIban, remittance: x.remittance,
      account: x.account.name, status: x.status, suggestion: (x.suggestion as LineView["suggestion"]) ?? null, autoMatched: x.autoMatched, note: x.note, matchedAt: x.matchedAt?.toISOString() ?? null,
      matches: x.matches.map((m) => ({
        kind: m.kind, amount: Number(m.amount),
        text: m.payment ? [m.payment.company.legalName, ...m.payment.allocations.map((a) => a.invoice?.providerNumber ?? a.invoice?.fullNumber ?? a.vendorInvoice?.externalNumber).filter(Boolean), m.payment.reference].filter(Boolean).join(" · ")
          : [m.label, m.category ? l[`cat.${m.category}`] ?? m.category : null].filter(Boolean).join(" · "),
      })),
    }));
    const filt = (st: string) => `${base(portal)}?status=${st}${sp.account ? `&account=${sp.account}` : ""}`;
    return (
      <Card>
        <CardHeader className="gap-3">
          <div className="flex flex-wrap items-center gap-2">
            {(["TODO", "MATCHED", "IGNORED", "ALL"] as const).map((st) => <Link key={st} href={filt(st)} className={`rounded-full border px-3 py-1 text-xs ${status === st ? "bg-secondary font-medium" : "hover:bg-accent"}`} data-testid={`filter-${st}`}>{l[`filter.${st}`]}</Link>)}
            {canManage && status === "TODO" && <span className="ml-auto"><RematchButton l={l} /></span>}
          </div>
          <form className="flex flex-wrap gap-2" action={base(portal)}>
            <input type="hidden" name="status" value={status} />
            {o.accounts.length > 1 && <select name="account" defaultValue={sp.account ?? ""} className="h-9 rounded-md border bg-background px-2 text-sm" aria-label={l.tabAccounts}><option value="">{l.allAccounts}</option>{o.accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select>}
            <input name="q" defaultValue={sp.q ?? ""} placeholder={l.searchLines} className="h-9 min-w-0 flex-1 rounded-md border bg-background px-3 text-sm" aria-label={l.searchLines} />
            <button className="h-9 rounded-md border px-3 text-sm hover:bg-accent" type="submit">{l.search}</button>
          </form>
        </CardHeader>
        <CardContent>
          {!o.accounts.length ? <p className="py-8 text-center text-sm text-muted-foreground" data-testid="bank-empty">{l.noAccounts} <Link className="text-primary underline" href={`${base(portal)}/accounts`}>{l.tabAccounts}</Link></p>
            : !views.length ? <p className="py-8 text-center text-sm text-muted-foreground" data-testid="lines-empty">{status === "TODO" ? l.allDone : l.noLines}</p>
            : <ul className="divide-y" data-testid="bank-lines">{views.map((v) => <LineCard key={v.id} l={l} line={v} side={side} locale={locale} canManage={canManage} />)}</ul>}
        </CardContent>
      </Card>
    );
  }

  async function AccountsTab() {
    const [statements, entities] = await Promise.all([listStatements(owner!), bankEntities(owner!)]);
    const legal = side === "FIRINGI" ? entities.map((e) => ({ id: e.id, label: e.legalName })) : undefined;
    return (
      <div className="space-y-4">
        {o.accounts.map((a) => (
          <Card key={a.id} data-testid="bank-account" className={a.active ? "" : "opacity-60"}>
            <CardHeader>
              <CardTitle className="flex flex-wrap items-center gap-2">{a.name}{!a.active && <Badge variant="outline">{l.inactive}</Badge>}</CardTitle>
              <CardDescription className="break-all font-mono">{a.iban}{a.bic ? ` · ${a.bic}` : ""} · {a.currencyCode}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <dl className="grid gap-3 text-sm sm:grid-cols-4">
                <div><dt className="text-muted-foreground">{l.balance}</dt><dd className="font-semibold tabular-nums">{money(a.balance as unknown as string, a.currencyCode)}</dd>{a.balanceAt && <dd className="text-xs text-muted-foreground">{f(l.balanceOn, { date: date(a.balanceAt) })}</dd>}</div>
                <div><dt className="text-muted-foreground">{l.lastImport}</dt><dd>{date(a.lastImport)}</dd></div>
                <div><dt className="text-muted-foreground">{l.kpiTodo}</dt><dd><Link className="text-primary hover:underline" href={`${base(portal)}?account=${a.id}`}>{a.toReview}</Link></dd></div>
                <div><dt className="text-muted-foreground">{l.matched}</dt><dd>{a.matched}</dd></div>
              </dl>
              {canManage && a.active && <ImportStatement l={l} accountId={a.id} hasMapping={!!a.csvMapping} />}
              {canManage && a.active && feedOn && (
                <div className="space-y-1"><p className="text-sm font-medium">{l.feedTitle}</p><p className="text-xs text-muted-foreground">{l.feedHint}</p>
                  <FeedControls l={l} provider={s.feed.provider} returnTo={`${base(portal)}/accounts`} account={{ id: a.id, feedStatus: a.feedStatus, feedConsentUntil: a.feedConsentUntil ? date(a.feedConsentUntil) : null, feedLastAt: a.feedLastAt?.toISOString() ?? null, feedError: a.feedError }} /></div>
              )}
              {canManage && side !== "FIRINGI" && s.companiesMayAuto && <AutoBookSwitch l={l} id={a.id} on={a.autoBook} threshold={s.companyAutoConfidence} />}
              {canManage && (
                <details className="rounded-lg border p-3 text-sm"><summary className="cursor-pointer">{l.editAccount}</summary><div className="mt-3 space-y-3"><AccountForm l={l} account={{ ...a, legalEntityId: a.legalEntityId }} legalEntities={legal} /><DeleteAccountButton l={l} id={a.id} /></div></details>
              )}
            </CardContent>
          </Card>
        ))}
        {canManage && (
          <Card><CardHeader><CardTitle>{l.addAccount}</CardTitle><CardDescription>{l.addAccountHint}</CardDescription></CardHeader><CardContent><AccountForm l={l} legalEntities={legal} /></CardContent></Card>
        )}
        {statements.length > 0 && (
          <Card>
            <CardHeader><CardTitle>{l.statements}</CardTitle></CardHeader>
            <CardContent>
              <ul className="divide-y text-sm" data-testid="statements">
                {statements.map((st) => (
                  <li key={st.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2">
                    <span className="w-28 text-muted-foreground">{date(st.createdAt)}</span>
                    <span className="min-w-0 flex-1 break-words">{st.account.name} · {l[`format.${st.format}`] ?? st.format}{st.fileName ? ` · ${st.fileName}` : ""}</span>
                    <span className="text-muted-foreground">{f(l.statementLines, { n: st.lineCount, fresh: st.newLines, auto: st.autoMatched })}</span>
                    {st.balanceOk === false && <Badge variant="destructive">{l.balanceOffShort}</Badge>}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}
      </div>
    );
  }

  async function RulesTab() {
    const [rules, links] = await Promise.all([listRules(owner!), listPayerLinks(owner!)]);
    return (
      <div className="space-y-4">
        <Card>
          <CardHeader><CardTitle>{l.rulesTitle}</CardTitle><CardDescription>{l.rulesHint}</CardDescription></CardHeader>
          <CardContent className="space-y-4">
            {rules.length ? (
              <ul className="divide-y text-sm" data-testid="rules">
                {rules.map((r) => (
                  <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
                    <span className="font-medium">“{r.contains}”</span>
                    <span className="text-muted-foreground">{r.direction === "IN" ? l.moneyIn : r.direction === "OUT" ? l.moneyOut : l.both} → {l[`kind.${r.kind}`]}{r.category ? ` · ${l[`cat.${r.category}`] ?? r.category}` : ""}</span>
                    <span className="ml-auto text-xs text-muted-foreground">{f(l.ruleHits, { n: r.hits })}</span>
                    {canManage && <DeleteRow l={l} id={r.id} what="rule" />}
                  </li>
                ))}
              </ul>
            ) : <p className="text-sm text-muted-foreground">{l.noRules}</p>}
            {canManage && <RuleForm l={l} />}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>{l.payersTitle}</CardTitle><CardDescription>{l.payersHint}</CardDescription></CardHeader>
          <CardContent>
            {links.length ? (
              <ul className="divide-y text-sm" data-testid="payers">
                {links.map((p) => <li key={p.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2"><span className="break-all font-mono">{p.iban}</span><span>{p.company ?? p.label ?? "—"}</span>{canManage && <span className="ml-auto"><DeleteRow l={l} id={p.id} what="payer" /></span>}</li>)}
              </ul>
            ) : <p className="text-sm text-muted-foreground">{l.noPayers}</p>}
          </CardContent>
        </Card>
      </div>
    );
  }
}

function Kpi({ label, value, hint }: { label: string; value: string; hint: string }) {
  return <Card><CardContent className="pt-5"><p className="text-sm text-muted-foreground">{label}</p><p className="text-2xl font-semibold tabular-nums">{value}</p>{hint && <p className="text-xs text-muted-foreground">{hint}</p>}</CardContent></Card>;
}

export type { L };
