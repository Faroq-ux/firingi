"use client";
/** Bank reconciliation (Phase 37) — interactive parts, shared by FIRINGI (English) and suppliers / customers (their language). */
import { useMemo, useRef, useState } from "react";
import { Ban, Check, FileUp, Link2, Plus, RefreshCw, Save, Search, Trash2, Undo2, Unlink, Wand2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input, Label, Select } from "@/components/ui/input";
import { Msg, Spin, useRun } from "@/components/shared/run";
import {
  confirmMatchAction, deleteBankAccountAction, deleteBankRuleAction, deletePayerLinkAction, feedInstitutionsAction, ignoreLineAction, importStatementAction,
  importWithMappingAction, linkFeedAction, matchCompaniesAction, matchOptionsAction, rematchAction, saveBankAccountAction, saveBankRuleAction, saveBankSettingsAction,
  setAutoBookAction, syncFeedAction, unlinkFeedAction, unmatchAction,
} from "@/server/actions/bank";
import { BANK_CATEGORIES, type BankSettings } from "@/lib/bank/settings";
import type { CsvMapping } from "@/lib/bank/csv";

export type L = Record<string, string>;
export type Side = "FIRINGI" | "VENDOR" | "BUYER";
const f = (s: string | undefined, v: Record<string, string | number> = {}) => (s ?? "").replace(/\{(\w+)\}/g, (_, k: string) => String(v[k] ?? `{${k}}`));
const money = (n: number, locale: string, ccy = "EUR") => new Intl.NumberFormat(locale, { style: "currency", currency: ccy }).format(n);
const round2 = (n: number) => Math.round(n * 100) / 100;

// ── accounts ────────────────────────────────────────────────────────────────

export function AccountForm({ l, account, legalEntities }: { l: L; account?: { id: string; name: string; iban: string; bic: string | null; currencyCode: string; legalEntityId?: string | null }; legalEntities?: { id: string; label: string }[] }) {
  const { pending, error, done, run } = useRun();
  const [v, setV] = useState({ name: account?.name ?? "", iban: account?.iban ?? "", bic: account?.bic ?? "", currencyCode: account?.currencyCode ?? "EUR", legalEntityId: account?.legalEntityId ?? legalEntities?.[0]?.id ?? "" });
  const key = account?.id ?? "new";
  return (
    <form className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5" data-testid={`account-form-${key}`} onSubmit={(e) => {
      e.preventDefault();
      run(() => saveBankAccountAction({ id: account?.id ?? null, name: v.name, iban: v.iban, bic: v.bic || null, currencyCode: v.currencyCode, legalEntityId: legalEntities ? v.legalEntityId || null : undefined }), () => { if (!account) setV({ ...v, name: "", iban: "", bic: "" }); }, l.saved);
    }}>
      <div className="space-y-1"><Label htmlFor={`an-${key}`}>{l.accountName}</Label><Input id={`an-${key}`} required maxLength={80} value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} placeholder={l.accountNameHint} data-testid="acc-name" /></div>
      <div className="space-y-1 sm:col-span-2 lg:col-span-1"><Label htmlFor={`ai-${key}`}>IBAN</Label><Input id={`ai-${key}`} required value={v.iban} onChange={(e) => setV({ ...v, iban: e.target.value })} placeholder="PT50 …" className="font-mono" data-testid="acc-iban" /></div>
      <div className="space-y-1"><Label htmlFor={`ab-${key}`}>BIC</Label><Input id={`ab-${key}`} maxLength={11} value={v.bic} onChange={(e) => setV({ ...v, bic: e.target.value })} className="font-mono" /></div>
      {legalEntities && legalEntities.length > 1 && (
        <div className="space-y-1"><Label htmlFor={`ae-${key}`}>{l.entity}</Label><Select id={`ae-${key}`} value={v.legalEntityId} onChange={(e) => setV({ ...v, legalEntityId: e.target.value })}>{legalEntities.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}</Select></div>
      )}
      <div className="flex items-end gap-2"><Button type="submit" disabled={pending} data-testid="acc-save"><Spin on={pending} icon={account ? Save : Plus} /> {account ? l.save : l.addAccount}</Button></div>
      <div className="sm:col-span-2 lg:col-span-5"><Msg error={error} done={done} /></div>
    </form>
  );
}

export function DeleteAccountButton({ l, id }: { l: L; id: string }) {
  const { pending, error, run } = useRun();
  const [sure, setSure] = useState(false);
  return (
    <span className="inline-flex items-center gap-2">
      {sure ? <Button size="sm" variant="destructive" disabled={pending} onClick={() => run(() => deleteBankAccountAction({ id }))}><Trash2 className="size-4" /> {l.removeSure}</Button>
        : <Button size="sm" variant="ghost" onClick={() => setSure(true)}><Trash2 className="size-4" /> {l.remove}</Button>}
      <Msg error={error} />
    </span>
  );
}

export function AutoBookSwitch({ l, id, on, threshold }: { l: L; id: string; on: boolean; threshold: number }) {
  const { pending, error, run } = useRun();
  return (
    <span className="inline-flex flex-col gap-1">
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" className="size-4" checked={on} disabled={pending} onChange={(e) => run(() => setAutoBookAction({ id, on: e.target.checked }))} data-testid={`autobook-${id}`} />
        {f(l.autoBook, { pct: threshold })}
      </label>
      <Msg error={error} />
    </span>
  );
}

// ── importing ───────────────────────────────────────────────────────────────

type Preview = { needsMapping: true; fileToken: string; fileName: string; rows: string[][]; guess: CsvMapping };
type Imported = { needsMapping: false; lines: number; newLines: number; duplicates: number; autoMatched: number; suggested: number; balanceOk: boolean | null; skipped: number };

export function ImportStatement({ l, accountId, hasMapping }: { l: L; accountId: string; hasMapping: boolean }) {
  const { pending, error, run } = useRun();
  const ref = useRef<HTMLInputElement>(null);
  const [remap, setRemap] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [result, setResult] = useState<Imported | null>(null);
  const send = (file: File) => {
    const fd = new FormData();
    fd.set("accountId", accountId); fd.set("file", file);
    if (remap) fd.set("remap", "1");
    setResult(null); setPreview(null);
    run(() => importStatementAction(fd), (d) => { const r = d as Preview | Imported; if (r.needsMapping) setPreview(r); else setResult(r); });
  };
  return (
    <div className="space-y-2" data-testid={`import-${accountId}`}>
      <div className="flex flex-wrap items-center gap-2">
        <input ref={ref} type="file" className="hidden" accept=".xml,.csv,.txt,.xlsx,.sta,.mt940,.940" data-testid={`import-file-${accountId}`} onChange={(e) => { const file = e.target.files?.[0]; if (file) send(file); e.target.value = ""; }} />
        <Button size="sm" disabled={pending} onClick={() => ref.current?.click()} data-testid={`import-btn-${accountId}`}><Spin on={pending} icon={FileUp} /> {l.import}</Button>
        {hasMapping && <label className="flex items-center gap-1.5 text-xs text-muted-foreground"><input type="checkbox" checked={remap} onChange={(e) => setRemap(e.target.checked)} /> {l.remap}</label>}
      </div>
      <p className="text-xs text-muted-foreground">{l.importHint}</p>
      <Msg error={error} />
      {result && (
        <div className="rounded-lg border bg-muted/40 p-3 text-sm" role="status" data-testid="import-result">
          <p>{f(l.imported, { lines: result.lines, fresh: result.newLines, dup: result.duplicates })}</p>
          <p>{f(l.importedMatched, { auto: result.autoMatched, suggested: result.suggested })}</p>
          {result.skipped > 0 && <p className="text-muted-foreground">{f(l.importedSkipped, { n: result.skipped })}</p>}
          {result.balanceOk === false && <p className="text-destructive">{l.balanceOff}</p>}
          {result.balanceOk === true && <p className="text-muted-foreground">{l.balanceOk}</p>}
        </div>
      )}
      {preview && <MappingForm l={l} accountId={accountId} preview={preview} onDone={(r) => { setPreview(null); setResult(r); }} />}
    </div>
  );
}

function MappingForm({ l, accountId, preview, onDone }: { l: L; accountId: string; preview: Preview; onDone: (r: Imported) => void }) {
  const { pending, error, run } = useRun();
  const [m, setM] = useState<CsvMapping>({ ...preview.guess, remittance: preview.guess.remittance ?? [] });
  const headers = preview.rows[m.headerRow - 1] ?? [];
  const body = preview.rows.slice(m.headerRow, m.headerRow + 6);
  const col = (k: keyof CsvMapping, label: string, required = false) => (
    <div className="space-y-1">
      <Label htmlFor={`map-${k}`}>{label}</Label>
      <Select id={`map-${k}`} value={(m[k] as string | null) ?? ""} onChange={(e) => setM({ ...m, [k]: e.target.value || null })} data-testid={`map-${k}`} required={required}>
        <option value="">—</option>{headers.map((h, i) => <option key={`${h}-${i}`} value={h}>{h || `#${i + 1}`}</option>)}
      </Select>
    </div>
  );
  return (
    <div className="space-y-3 rounded-xl border p-3" data-testid="mapping-form">
      <p className="text-sm font-medium">{f(l.mappingTitle, { file: preview.fileName })}</p>
      <p className="text-xs text-muted-foreground">{l.mappingHint}</p>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="space-y-1"><Label htmlFor="map-row">{l.mapHeaderRow}</Label><Input id="map-row" type="number" min={1} max={20} value={m.headerRow} onChange={(e) => setM({ ...m, headerRow: Math.max(1, Number(e.target.value) || 1) })} /></div>
        {col("date", l.mapDate, true)}
        {col("valueDate", l.mapValueDate)}
        {col("amount", l.mapAmount)}
        {col("debit", l.mapDebit)}
        {col("credit", l.mapCredit)}
        {col("counterparty", l.mapCounterparty)}
        {col("iban", l.mapIban)}
        <div className="space-y-1">
          <Label htmlFor="map-rem">{l.mapRemittance}</Label>
          <Select id="map-rem" value={m.remittance?.[0] ?? ""} onChange={(e) => setM({ ...m, remittance: [e.target.value, ...(m.remittance ?? []).slice(1)].filter(Boolean) })} data-testid="map-remittance">
            <option value="">—</option>{headers.map((h, i) => <option key={`${h}-${i}`} value={h}>{h || `#${i + 1}`}</option>)}
          </Select>
        </div>
        {col("reference", l.mapReference)}
        <div className="space-y-1"><Label htmlFor="map-dates">{l.mapDateOrder}</Label><Select id="map-dates" value={m.dateOrder} onChange={(e) => setM({ ...m, dateOrder: e.target.value as CsvMapping["dateOrder"] })}><option value="DMY">31/12/2026</option><option value="MDY">12/31/2026</option><option value="YMD">2026-12-31</option></Select></div>
        <div className="space-y-1"><Label htmlFor="map-dec">{l.mapDecimal}</Label><Select id="map-dec" value={m.decimal} onChange={(e) => setM({ ...m, decimal: e.target.value as "," | "." })}><option value=",">1.234,56</option><option value=".">1,234.56</option></Select></div>
      </div>
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-xs">
          <thead className="bg-muted/50"><tr>{headers.map((h, i) => <th key={i} className="whitespace-nowrap px-2 py-1 text-left font-medium">{h}</th>)}</tr></thead>
          <tbody>{body.map((r, i) => <tr key={i} className="border-t">{headers.map((_, j) => <td key={j} className="whitespace-nowrap px-2 py-1">{r[j] ?? ""}</td>)}</tr>)}</tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button disabled={pending || !m.date || !(m.amount || m.debit || m.credit)} data-testid="map-import" onClick={() => run(() => importWithMappingAction({ accountId, token: preview.fileToken, mapping: m }), (d) => onDone(d as Imported))}><Spin on={pending} icon={Check} /> {l.mapImport}</Button>
        <Msg error={error} />
      </div>
    </div>
  );
}

// ── bank feed ───────────────────────────────────────────────────────────────

export function FeedControls({ l, account, provider, returnTo }: { l: L; account: { id: string; feedStatus: string | null; feedConsentUntil: string | null; feedLastAt: string | null; feedError: string | null }; provider: "SIMULATED" | "GOCARDLESS"; returnTo: string }) {
  const { pending, error, done, run } = useRun();
  const [country, setCountry] = useState("PT");
  const [banks, setBanks] = useState<{ id: string; name: string }[] | null>(null);
  const [bank, setBank] = useState("");
  const link = (institutionId: string) => run(() => linkFeedAction({ accountId: account.id, institutionId, returnTo }), (d) => { window.location.href = (d as { link: string }).link; });
  if (account.feedStatus === "LINKED") return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <Badge variant="success">{l.feedLinked}</Badge>
      {account.feedConsentUntil && <span className="text-xs text-muted-foreground">{f(l.feedUntil, { date: account.feedConsentUntil })}</span>}
      <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => syncFeedAction({ accountId: account.id }), undefined, l.feedSynced)} data-testid={`feed-sync-${account.id}`}><Spin on={pending} icon={RefreshCw} /> {l.feedSync}</Button>
      <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => unlinkFeedAction({ accountId: account.id }))}><Unlink className="size-4" /> {l.feedUnlink}</Button>
      {account.feedError && <span className="text-xs text-destructive">{account.feedError}</span>}
      <Msg error={error} done={done} />
    </div>
  );
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      {account.feedStatus === "EXPIRED" && <Badge variant="warning">{l.feedExpired}</Badge>}
      {account.feedStatus === "PENDING" && <Badge variant="outline">{l.feedPending}</Badge>}
      {provider === "GOCARDLESS" && (
        banks ? (
          <>
            <Select aria-label={l.feedBank} value={bank} onChange={(e) => setBank(e.target.value)} className="h-8 w-56"><option value="">{l.feedBank}</option>{banks.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</Select>
            <Button size="sm" disabled={pending || !bank} onClick={() => link(bank)}><Spin on={pending} icon={Link2} /> {l.feedConnect}</Button>
          </>
        ) : (
          <>
            <Input aria-label={l.feedCountry} value={country} maxLength={2} onChange={(e) => setCountry(e.target.value.toUpperCase())} className="h-8 w-16" />
            <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => feedInstitutionsAction({ country }), (d) => setBanks(d as { id: string; name: string }[]))}><Spin on={pending} icon={Search} /> {l.feedFindBank}</Button>
          </>
        )
      )}
      {provider === "SIMULATED" && <Button size="sm" variant="outline" disabled={pending} onClick={() => link("SIM_BANK")} data-testid={`feed-link-${account.id}`}><Spin on={pending} icon={Link2} /> {l.feedConnect}</Button>}
      <Msg error={error} done={done} />
    </div>
  );
}

// ── lines ───────────────────────────────────────────────────────────────────

export type Proposal = {
  kind: string; companyId?: string | null; companyName?: string | null; items: { id: string; amount: number; label?: string }[];
  credit?: number; orderId?: string | null; orderNumber?: string | null; rest?: { amount: number; kind: "FEE" | "OTHER"; category?: string | null } | null;
  category?: string | null; label?: string | null; ruleId?: string | null; confidence: number; reasons: { k: string; v?: Record<string, string | number> }[];
};
export type LineView = {
  id: string; date: string; amount: number; currency: string; counterparty: string | null; iban: string | null; remittance: string | null; account: string;
  status: "OPEN" | "SUGGESTED" | "MATCHED" | "IGNORED"; suggestion: Proposal | null; autoMatched: boolean; note: string | null; matchedAt: string | null;
  matches: { kind: string; amount: number; text: string }[];
};

const KINDS: Record<Side, { in: string[]; out: string[] }> = {
  FIRINGI: { in: ["CUSTOMER_PAYMENT", "PAYMENT", "FEE", "OTHER"], out: ["VENDOR_PAYOUT", "PAYMENT", "FEE", "OTHER"] },
  VENDOR: { in: ["PAYMENT", "ENTRY", "FEE", "OTHER"], out: ["ENTRY", "FEE", "OTHER"] },
  BUYER: { in: ["ENTRY", "FEE", "OTHER"], out: ["PAYMENT", "FIRINGI_INVOICE", "ENTRY", "FEE", "OTHER"] },
};

function describe(l: L, p: Proposal, locale: string) {
  const parts: string[] = [];
  if (p.items.length) parts.push(p.items.map((i) => `${i.label ?? "…"} (${money(i.amount, locale)})`).join(", "));
  if (p.orderNumber) parts.push(f(l.forOrder, { number: p.orderNumber }));
  if (p.credit && !p.orderNumber) parts.push(f(l.creditPart, { amount: money(p.credit, locale) }));
  if (p.rest) parts.push(`${l[`kind.${p.rest.kind}`]} ${money(p.rest.amount, locale)}`);
  if ((p.kind === "FEE" || p.kind === "OTHER") && p.category) parts.push(l[`cat.${p.category}`] ?? p.category);
  if (p.label && (p.kind === "FEE" || p.kind === "OTHER")) parts.push(p.label);
  return parts.join(" · ");
}

export function LineCard({ l, line, side, locale, canManage }: { l: L; line: LineView; side: Side; locale: string; canManage: boolean }) {
  const { pending, error, run } = useRun();
  const [manual, setManual] = useState(false);
  const [ignoring, setIgnoring] = useState(false);
  const [note, setNote] = useState("");
  const s = line.suggestion;
  const waiting = line.status === "OPEN" || line.status === "SUGGESTED";
  return (
    <li className="space-y-2 py-3" data-testid="bank-line" data-status={line.status} data-line={line.id}>
      <div className="flex flex-wrap items-start gap-x-3 gap-y-1">
        <span className="w-24 shrink-0 text-sm text-muted-foreground">{new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(new Date(line.date))}</span>
        <div className="min-w-0 flex-1 basis-48">
          <p className="truncate text-sm font-medium">{line.counterparty || l.noName}</p>
          {line.remittance && <p className="line-clamp-2 break-words text-xs text-muted-foreground">{line.remittance}</p>}
          {line.iban && <p className="break-all font-mono text-[11px] text-muted-foreground">{line.iban}</p>}
        </div>
        <span className={`ml-auto shrink-0 text-right font-semibold tabular-nums ${line.amount < 0 ? "text-destructive" : "text-[color:var(--success,#16a34a)]"}`}>{money(line.amount, locale, line.currency)}</span>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <Badge variant={line.status === "MATCHED" ? "success" : line.status === "IGNORED" ? "outline" : line.status === "SUGGESTED" ? "warning" : "secondary"}>{l[`status.${line.status}`]}</Badge>
        {line.autoMatched && <Badge variant="outline">{l.auto}</Badge>}
        <span className="text-muted-foreground">{line.account}</span>
      </div>

      {waiting && s && (
        <div className="rounded-lg border border-primary/30 bg-primary/5 p-2.5 text-sm" data-testid="line-suggestion">
          <div className="flex flex-wrap items-center gap-2">
            <Wand2 className="size-4 text-primary" />
            <span className="font-medium">{l[`kind.${s.kind}`]}{s.companyName ? ` — ${s.companyName}` : ""}</span>
            <Badge variant={s.confidence >= 90 ? "success" : s.confidence >= 70 ? "warning" : "outline"}>{f(l.sure, { pct: s.confidence })}</Badge>
          </div>
          {describe(l, s, locale) && <p className="mt-1 break-words">{describe(l, s, locale)}</p>}
          {s.reasons.length > 0 && <p className="mt-1 text-xs text-muted-foreground" data-testid="line-reasons">{s.reasons.map((r) => f(l[`why.${r.k}`] ?? r.k, r.v)).join(" · ")}</p>}
        </div>
      )}

      {line.status === "MATCHED" && (
        <ul className="space-y-0.5 text-sm" data-testid="line-matches">
          {line.matches.map((m, i) => <li key={i} className="flex flex-wrap gap-x-2"><Check className="mt-0.5 size-4 text-[color:var(--success,#16a34a)]" /><span className="font-medium">{l[`kind.${m.kind}`]}</span><span className="min-w-0 break-words text-muted-foreground">{m.text}</span><span className="ml-auto tabular-nums">{money(m.amount, locale)}</span></li>)}
        </ul>
      )}
      {line.status === "IGNORED" && line.note && <p className="text-xs text-muted-foreground">{line.note}</p>}

      {canManage && (
        <div className="flex flex-wrap items-center gap-2">
          {waiting && s && <Button size="sm" disabled={pending} onClick={() => run(() => confirmMatchAction({ lineId: line.id, proposal: s as never }))} data-testid="line-confirm"><Spin on={pending} icon={Check} /> {l.confirm}</Button>}
          {waiting && <Button size="sm" variant="outline" onClick={() => setManual(!manual)} data-testid="line-manual">{manual ? <X className="size-4" /> : <Search className="size-4" />} {l.byHand}</Button>}
          {waiting && !ignoring && <Button size="sm" variant="ghost" onClick={() => setIgnoring(true)} data-testid="line-ignore"><Ban className="size-4" /> {l.ignore}</Button>}
          {waiting && ignoring && (
            <span className="inline-flex flex-wrap items-center gap-1">
              <Input aria-label={l.ignoreWhy} placeholder={l.ignoreWhy} value={note} onChange={(e) => setNote(e.target.value)} className="h-8 w-56" data-testid="line-ignore-note" />
              <Button size="sm" variant="secondary" disabled={pending} onClick={() => run(() => ignoreLineAction({ lineId: line.id, note: note || null }))} data-testid="line-ignore-confirm">{l.ignore}</Button>
            </span>
          )}
          {!waiting && <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => unmatchAction({ lineId: line.id }))} data-testid="line-undo"><Spin on={pending} icon={Undo2} /> {l.undo}</Button>}
          <Msg error={error} />
        </div>
      )}
      {manual && waiting && <ManualMatch l={l} line={line} side={side} locale={locale} />}
    </li>
  );
}

type Opt = { id: string; label: string; sub: string; open: number; companyId: string | null; date: string | null };

function ManualMatch({ l, line, side, locale }: { l: L; line: LineView; side: Side; locale: string }) {
  const { pending, error, run } = useRun();
  const kinds = line.amount > 0 ? KINDS[side].in : KINDS[side].out;
  const [kind, setKind] = useState(kinds[0]);
  const [company, setCompany] = useState<{ id: string; name: string } | null>(null);
  const [cq, setCq] = useState("");
  const [companies, setCompanies] = useState<{ id: string; legalName: string; type: string }[]>([]);
  const [q, setQ] = useState("");
  const [opts, setOpts] = useState<Opt[] | null>(null);
  const [pick, setPick] = useState<Record<string, number>>({});
  const [restKind, setRestKind] = useState<"FEE" | "OTHER">("FEE");
  const [category, setCategory] = useState<string>(line.amount < 0 ? "BANK_FEES" : "OTHER");
  const [label, setLabel] = useState("");
  const A = Math.abs(line.amount), sign = line.amount < 0 ? -1 : 1;
  const needsCompany = side === "FIRINGI" && (kind === "CUSTOMER_PAYMENT" || kind === "VENDOR_PAYOUT");
  const docs = kind !== "FEE" && kind !== "OTHER";
  const total = round2(Object.values(pick).reduce((a, v) => a + (Number(v) || 0), 0));
  const diff = round2(A - total);
  const load = (k = kind, cid = company?.id ?? null, query = q) => run(() => matchOptionsAction({ lineId: line.id, kind: k as never, companyId: cid, q: query || null }), (d) => { setOpts(d as Opt[]); setPick({}); });
  const toggle = (o: Opt) => setPick((p) => { const n = { ...p }; if (o.id in n) delete n[o.id]; else n[o.id] = round2(Math.min(o.open, Math.max(0, A - total))); return n; });
  const proposal = useMemo(() => {
    if (!docs) return { kind, items: [], category, label: label || null, confidence: 0, reasons: [] };
    const items = Object.entries(pick).filter(([, v]) => v > 0).map(([id, amount]) => ({ id, amount, label: opts?.find((o) => o.id === id)?.label }));
    const credit = kind === "CUSTOMER_PAYMENT" && diff > 0.004 ? diff : undefined;
    const rest = !credit && Math.abs(diff) > 0.004 ? { amount: round2(sign * diff), kind: restKind, category: restKind === "FEE" ? "BANK_FEES" : category } : null;
    return { kind, companyId: company?.id ?? null, items, credit, rest, confidence: 0, reasons: [] };
  }, [docs, kind, category, label, pick, opts, diff, restKind, company, sign]);
  return (
    <div className="space-y-3 rounded-xl border p-3" data-testid="manual-match">
      <div className="flex flex-wrap items-end gap-2">
        <div className="space-y-1"><Label htmlFor={`mk-${line.id}`}>{l.what}</Label>
          <Select id={`mk-${line.id}`} value={kind} onChange={(e) => { setKind(e.target.value); setOpts(null); setPick({}); if (!(side === "FIRINGI" && ["CUSTOMER_PAYMENT", "VENDOR_PAYOUT"].includes(e.target.value)) && !["FEE", "OTHER"].includes(e.target.value)) load(e.target.value, null, ""); }} data-testid="manual-kind">
            {kinds.map((k) => <option key={k} value={k}>{l[`kind.${k}`]}</option>)}
          </Select>
        </div>
        {needsCompany && (company ? (
          <span className="flex items-center gap-2 text-sm"><Badge variant="secondary">{company.name}</Badge><Button size="sm" variant="ghost" onClick={() => { setCompany(null); setOpts(null); setPick({}); }}><X className="size-4" /></Button></span>
        ) : (
          <div className="relative space-y-1">
            <Label htmlFor={`mc-${line.id}`}>{kind === "VENDOR_PAYOUT" ? l.supplier : l.customer}</Label>
            <Input id={`mc-${line.id}`} value={cq} placeholder={l.searchCompany} onChange={(e) => { setCq(e.target.value); if (e.target.value.trim().length >= 2) run(() => matchCompaniesAction({ q: e.target.value }), (d) => setCompanies(d as typeof companies)); }} className="h-9 w-64" data-testid="manual-company" />
            {companies.length > 0 && cq.length >= 2 && (
              <ul className="absolute z-10 mt-1 max-h-56 w-64 overflow-auto rounded-md border bg-popover text-sm shadow">
                {companies.map((c) => <li key={c.id}><button type="button" className="w-full px-2 py-1.5 text-left hover:bg-accent" onClick={() => { setCompany({ id: c.id, name: c.legalName }); setCompanies([]); setCq(""); load(kind, c.id, ""); }}>{c.legalName}</button></li>)}
              </ul>
            )}
          </div>
        ))}
        {docs && (!needsCompany || company) && (
          <div className="flex items-end gap-1">
            <Input aria-label={l.search} value={q} onChange={(e) => setQ(e.target.value)} placeholder={l.search} className="h-9 w-44" />
            <Button size="sm" variant="outline" disabled={pending} onClick={() => load()} data-testid="manual-search"><Spin on={pending} icon={Search} /></Button>
          </div>
        )}
      </div>

      {docs && opts && (
        opts.length === 0 ? <p className="text-sm text-muted-foreground">{l.nothingOpen}</p> : (
          <ul className="max-h-72 divide-y overflow-auto rounded-lg border text-sm" data-testid="manual-options">
            {opts.map((o) => (
              <li key={o.id} className="flex flex-wrap items-center gap-2 px-2 py-1.5">
                <input type="checkbox" checked={o.id in pick} onChange={() => toggle(o)} aria-label={o.label} data-testid="manual-pick" />
                <span className="min-w-0 flex-1 break-words">{o.label}<span className="block text-xs text-muted-foreground">{o.sub}</span></span>
                <span className="text-xs text-muted-foreground">{f(l.openAmount, { amount: money(o.open, locale) })}</span>
                {o.id in pick && <Input type="number" step="0.01" min={0} max={o.open} value={pick[o.id]} onChange={(e) => setPick({ ...pick, [o.id]: Number(e.target.value) })} className="h-8 w-28" aria-label={l.amount} />}
              </li>
            ))}
          </ul>
        )
      )}

      {!docs && (
        <div className="grid gap-2 sm:grid-cols-2">
          <div className="space-y-1"><Label htmlFor={`mcat-${line.id}`}>{l.category}</Label><Select id={`mcat-${line.id}`} value={category} onChange={(e) => setCategory(e.target.value)} data-testid="manual-category">{BANK_CATEGORIES.map((c) => <option key={c} value={c}>{l[`cat.${c}`]}</option>)}</Select></div>
          <div className="space-y-1"><Label htmlFor={`ml-${line.id}`}>{l.noteLabel}</Label><Input id={`ml-${line.id}`} value={label} maxLength={120} onChange={(e) => setLabel(e.target.value)} /></div>
        </div>
      )}

      {docs && Object.keys(pick).length > 0 && (
        <div className="space-y-2 rounded-lg bg-muted/40 p-2 text-sm">
          <p className="flex flex-wrap gap-x-4"><span>{f(l.lineAmount, { amount: money(A, locale) })}</span><span>{f(l.chosenAmount, { amount: money(total, locale) })}</span><span className={Math.abs(diff) > 0.004 ? "font-medium" : "text-muted-foreground"}>{f(l.difference, { amount: money(diff, locale) })}</span></p>
          {kind === "CUSTOMER_PAYMENT" && diff > 0.004 && <p className="text-muted-foreground">{l.restCredit}</p>}
          {Math.abs(diff) > 0.004 && !(kind === "CUSTOMER_PAYMENT" && diff > 0) && (
            <div className="flex flex-wrap items-center gap-2">
              <span>{l.restAs}</span>
              <Select aria-label={l.restAs} value={restKind} onChange={(e) => setRestKind(e.target.value as "FEE" | "OTHER")} className="h-8 w-40"><option value="FEE">{l["kind.FEE"]}</option><option value="OTHER">{l["kind.OTHER"]}</option></Select>
              {restKind === "OTHER" && <Select aria-label={l.category} value={category} onChange={(e) => setCategory(e.target.value)} className="h-8 w-48">{BANK_CATEGORIES.map((c) => <option key={c} value={c}>{l[`cat.${c}`]}</option>)}</Select>}
            </div>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" disabled={pending || (docs && (!proposal.items.length || (needsCompany && !company)))} onClick={() => run(() => confirmMatchAction({ lineId: line.id, proposal: proposal as never }))} data-testid="manual-confirm"><Spin on={pending} icon={Check} /> {l.book}</Button>
        <Msg error={error} />
      </div>
    </div>
  );
}

export function RematchButton({ l }: { l: L }) {
  const { pending, error, done, run } = useRun();
  return <span className="inline-flex items-center gap-2"><Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => rematchAction({}), undefined, l.rematched)} data-testid="rematch"><Spin on={pending} icon={Wand2} /> {l.rematch}</Button><Msg error={error} done={done} /></span>;
}

// ── rules & remembered payers ───────────────────────────────────────────────

export function RuleForm({ l }: { l: L }) {
  const { pending, error, done, run } = useRun();
  const [v, setV] = useState({ name: "", contains: "", direction: "OUT" as "IN" | "OUT" | "", kind: "FEE" as "FEE" | "OTHER", category: "BANK_FEES" });
  return (
    <form className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6" data-testid="rule-form" onSubmit={(e) => {
      e.preventDefault();
      run(() => saveBankRuleAction({ id: null, name: v.name, contains: v.contains, direction: v.direction || null, kind: v.kind, category: v.category as never }), () => setV({ ...v, name: "", contains: "" }), l.saved);
    }}>
      <div className="space-y-1 lg:col-span-2"><Label htmlFor="rc">{l.ruleContains}</Label><Input id="rc" required minLength={3} maxLength={80} value={v.contains} onChange={(e) => setV({ ...v, contains: e.target.value })} placeholder={l.ruleContainsHint} data-testid="rule-contains" /></div>
      <div className="space-y-1"><Label htmlFor="rd">{l.ruleDirection}</Label><Select id="rd" value={v.direction} onChange={(e) => setV({ ...v, direction: e.target.value as "IN" | "OUT" | "" })}><option value="OUT">{l.moneyOut}</option><option value="IN">{l.moneyIn}</option><option value="">{l.both}</option></Select></div>
      <div className="space-y-1"><Label htmlFor="rk">{l.ruleKind}</Label><Select id="rk" value={v.kind} onChange={(e) => setV({ ...v, kind: e.target.value as "FEE" | "OTHER", category: e.target.value === "FEE" ? "BANK_FEES" : v.category })}><option value="FEE">{l["kind.FEE"]}</option><option value="OTHER">{l["kind.OTHER"]}</option></Select></div>
      <div className="space-y-1"><Label htmlFor="rcat">{l.category}</Label><Select id="rcat" value={v.category} onChange={(e) => setV({ ...v, category: e.target.value })}>{BANK_CATEGORIES.map((c) => <option key={c} value={c}>{l[`cat.${c}`]}</option>)}</Select></div>
      <div className="space-y-1"><Label htmlFor="rn">{l.ruleName}</Label><Input id="rn" maxLength={80} value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} /></div>
      <div className="flex items-center gap-2 sm:col-span-2 lg:col-span-6"><Button type="submit" disabled={pending} data-testid="rule-save"><Spin on={pending} icon={Plus} /> {l.ruleAdd}</Button><Msg error={error} done={done} /></div>
    </form>
  );
}

export function DeleteRow({ l, id, what }: { l: L; id: string; what: "rule" | "payer" }) {
  const { pending, error, run } = useRun();
  return <span className="inline-flex items-center gap-1"><Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => (what === "rule" ? deleteBankRuleAction({ id }) : deletePayerLinkAction({ id })))} aria-label={l.remove}><Trash2 className="size-4" /></Button><Msg error={error} /></span>;
}

// ── FIRINGI settings (English) ──────────────────────────────────────────────

export function BankSettingsForm({ initial, feedReady }: { initial: BankSettings; feedReady: { SIMULATED: boolean; GOCARDLESS: boolean } }) {
  const { pending, error, done, run } = useRun();
  const [v, setV] = useState(initial);
  const num = (k: "autoConfidence" | "companyAutoConfidence" | "toleranceAmount" | "tolerancePct" | "windowDays", label: string, hint: string, step = 1) => (
    <div className="space-y-1"><Label htmlFor={`bs-${k}`}>{label}</Label><Input id={`bs-${k}`} type="number" step={step} value={v[k]} onChange={(e) => setV({ ...v, [k]: Number(e.target.value) })} data-testid={`bs-${k}`} /><p className="text-xs text-muted-foreground">{hint}</p></div>
  );
  return (
    <form className="space-y-5" data-testid="bank-settings" onSubmit={(e) => { e.preventDefault(); run(() => saveBankSettingsAction(v), undefined, "Saved"); }}>
      <fieldset className="space-y-3">
        <legend className="mb-1 font-semibold">FIRINGI&apos;s bank</legend>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1"><Label htmlFor="bs-mode">Matching</Label>
            <Select id="bs-mode" value={v.firingiMode} onChange={(e) => setV({ ...v, firingiMode: e.target.value as "AUTO" | "CONFIRM" })} data-testid="bs-mode">
              <option value="CONFIRM">Always confirmed by a person (suggestions only)</option>
              <option value="AUTO">Book sure matches by itself, suggest the rest</option>
            </Select>
            <p className="text-xs text-muted-foreground">Every line booked by itself can be undone; it&apos;s marked “auto” and in the audit log.</p>
          </div>
          {num("autoConfidence", "Book by itself from (confidence %)", "99 = invoice numbers and amount match exactly; 92 = remembered IBAN and an invoice's exact amount; rules 97.")}
        </div>
      </fieldset>
      <fieldset className="space-y-3">
        <legend className="mb-1 font-semibold">Suppliers and customers</legend>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="size-4" checked={v.companiesMayAuto} onChange={(e) => setV({ ...v, companiesMayAuto: e.target.checked })} data-testid="bs-companies-auto" />They may let their own bank book sure matches by itself</label>
        <div className="grid gap-4 sm:grid-cols-2">{num("companyAutoConfidence", "…from (confidence %)", "Applies to their own books only; FIRINGI's invoices are never paid by a customer's bank file.")}</div>
      </fieldset>
      <fieldset className="space-y-3">
        <legend className="mb-1 font-semibold">Tolerance and dates</legend>
        <div className="grid gap-4 sm:grid-cols-3">
          {num("toleranceAmount", "Short payment closed as a bank fee — up to (€)", "When a customer's bank takes its charges from the transfer.", 0.01)}
          {num("tolerancePct", "…and at most (% of the amount)", "Both limits apply; above them it's a part payment.", 0.1)}
          {num("windowDays", "Days between bank line and recorded payment", "For payments already recorded (online, direct debit, payouts).")}
        </div>
      </fieldset>
      <fieldset className="space-y-3">
        <legend className="mb-1 font-semibold">Daily bank feed (open banking)</legend>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="size-4" checked={v.feed.enabled} onChange={(e) => setV({ ...v, feed: { ...v.feed, enabled: e.target.checked } })} data-testid="bs-feed" />Switch on the bank feed</label>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1"><Label htmlFor="bs-prov">Provider</Label>
            <Select id="bs-prov" value={v.feed.provider} onChange={(e) => setV({ ...v, feed: { ...v.feed, provider: e.target.value as "SIMULATED" | "GOCARDLESS" } })}>
              <option value="GOCARDLESS">GoCardless Bank Account Data {feedReady.GOCARDLESS ? "" : "(keys not set)"}</option>
              <option value="SIMULATED">Simulated bank (tests) {feedReady.SIMULATED ? "" : "(off on this server)"}</option>
            </Select>
            <p className="text-xs text-muted-foreground">GoCardless needs GOCARDLESS_SECRET_ID and GOCARDLESS_SECRET_KEY on the server. Each account holder approves access at their bank for 90 days.</p>
          </div>
          <label className="flex items-center gap-2 self-center text-sm"><input type="checkbox" className="size-4" checked={v.feed.companiesMayLink} onChange={(e) => setV({ ...v, feed: { ...v.feed, companiesMayLink: e.target.checked } })} />Suppliers and customers may link their own bank</label>
        </div>
      </fieldset>
      <div className="flex items-center gap-2"><Button type="submit" disabled={pending} data-testid="bs-save"><Spin on={pending} icon={Save} /> Save</Button><Msg error={error} done={done} /></div>
    </form>
  );
}
