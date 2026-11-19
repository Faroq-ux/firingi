"use client";
/** Finance forms: vendor invoice upload, review, payments, credit notes, promotions, credit terms. */
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";
import {
  answerPromotionAction, issueCreditNoteAction, recordPaymentAction, reviewVendorInvoiceAction, saveAdminPromotionAction, saveVendorPromotionAction,
  setCustomerTermsAction, setPromotionStatusAction, submitVendorInvoiceAction,
} from "@/server/actions/finance";

type Res = { ok: boolean; error?: string };
function useRun() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  // "Sent for approval" (four-eyes) is a notice, not an error.
  const run = (fn: () => Promise<Res>, after?: () => void) => start(async () => { setError(null); const r = await fn(); if (r.ok) { after?.(); router.refresh(); } else setError((r as { code?: string }).code === "APPROVAL_REQUIRED" ? `${PENDING}${r.error}` : r.error ?? "Error"); });
  return { pending, error, run };
}
const PENDING = "\u23F3 ";
const Err = ({ e }: { e: string | null }) => (e ? (e.startsWith(PENDING)
  ? <p role="status" className="text-sm text-[color:color-mix(in_oklch,var(--vivid-violet)_80%,var(--foreground))]" data-testid="approval-pending">{e}</p>
  : <p role="alert" className="text-sm text-destructive">{e}</p>) : null);

export function VendorInvoiceUpload({ statements }: { statements: { id: string; label: string; net: string; vat: string; credit: boolean }[] }) {
  const t = useTranslations("finance");
  const { pending, error, run } = useRun();
  const [sel, setSel] = useState<string[]>([]);
  const chosen = statements.filter((s) => sel.includes(s.id));
  const net = chosen.reduce((a, s) => a + Number(s.net), 0).toFixed(2), vat = chosen.reduce((a, s) => a + Number(s.vat), 0).toFixed(2);
  const credit = chosen[0]?.credit ?? false;
  if (!statements.length) return null;
  return (
    <form className="space-y-3" onSubmit={(e) => {
      e.preventDefault();
      const fd = new FormData(e.currentTarget);
      sel.forEach((id) => fd.append("statementIds", id));
      fd.set("docType", credit ? "CREDIT_NOTE" : "INVOICE");
      const f = e.currentTarget;
      run(() => submitVendorInvoiceAction(fd), () => { f.reset(); setSel([]); });
    }}>
      <p className="text-sm font-medium">{t("choose")}</p>
      <div className="grid gap-1.5 sm:grid-cols-2">
        {statements.map((s) => (
          <label key={s.id} className="flex items-center gap-2 rounded-md border p-2 text-sm transition-colors hover:bg-muted/50">
            <input type="checkbox" checked={sel.includes(s.id)} disabled={chosen.length > 0 && chosen[0].credit !== s.credit}
              onChange={(e) => setSel(e.target.checked ? [...sel, s.id] : sel.filter((x) => x !== s.id))} />
            <span className="flex-1">{s.label}</span><span className="tabular-nums">{s.net} € + {s.vat} €</span>
          </label>
        ))}
      </div>
      <div className="grid gap-3 sm:grid-cols-5">
        <div className="space-y-1"><Label>{t("externalNumber")}</Label><Input name="externalNumber" required /></div>
        <div className="space-y-1"><Label>{t("issueDate")}</Label><Input name="issueDate" type="date" required defaultValue={new Date().toISOString().slice(0, 10)} /></div>
        <div className="space-y-1"><Label>{t("net")}</Label><Input name="netTotal" inputMode="decimal" required key={`n${net}`} defaultValue={sel.length ? net : ""} /></div>
        <div className="space-y-1"><Label>{t("vat")}</Label><Input name="vatTotal" inputMode="decimal" required key={`v${vat}`} defaultValue={sel.length ? vat : ""} /></div>
        <div className="space-y-1"><Label>{t("file")}</Label><Input name="file" type="file" accept="application/pdf,image/*" required /></div>
      </div>
      <Err e={error} />
      <Button type="submit" disabled={pending || !sel.length}>{t("submit")} {credit ? `(${t("creditNote")})` : ""}</Button>
    </form>
  );
}

export function VendorInvoiceReview({ id, disputed }: { id: string; disputed: boolean }) {
  const { pending, error, run } = useRun();
  const [note, setNote] = useState("");
  return (
    <div className="flex flex-wrap items-center justify-end gap-1.5">
      <Input className="h-8 w-48" placeholder={disputed ? "Note (required)" : "Note"} value={note} onChange={(e) => setNote(e.target.value)} />
      <Button size="sm" disabled={pending || (disputed && !note.trim())} onClick={() => run(() => reviewVendorInvoiceAction({ id, decision: "APPROVED", note: note || null }))}>Approve</Button>
      <Button size="sm" variant="destructive" disabled={pending || !note.trim()} onClick={() => run(() => reviewVendorInvoiceAction({ id, decision: "REJECTED", note }))}>Reject</Button>
      <Err e={error} />
    </div>
  );
}

type OpenDoc = { id: string; companyId: string; company: string; label: string; open: string; currency?: string; openLocal?: string | null };
export function PaymentForm({ direction, docs }: { direction: "INBOUND" | "OUTBOUND"; docs: OpenDoc[] }) {
  const { pending, error, run } = useRun();
  const companies = [...new Map(docs.map((d) => [d.companyId, d.company])).entries()];
  const [company, setCompany] = useState(companies[0]?.[0] ?? "");
  const [alloc, setAlloc] = useState<Record<string, string>>({});
  const mine = docs.filter((d) => d.companyId === company);
  const total = Object.entries(alloc).filter(([k]) => mine.some((d) => d.id === k)).reduce((a, [, v]) => a + (Number(v) || 0), 0);
  // Phase 45: this customer's invoices are in another currency → the money received is entered in it
  const code = direction === "INBOUND" ? mine.find((d) => d.currency && d.currency !== "EUR")?.currency ?? null : null;
  if (!docs.length) return <p className="text-sm text-muted-foreground">Nothing open to {direction === "INBOUND" ? "collect" : "pay"}.</p>;
  return (
    <form className="space-y-3" onSubmit={(e) => {
      e.preventDefault();
      const fd = new FormData(e.currentTarget);
      run(() => recordPaymentAction({
        direction, companyId: company, method: String(fd.get("method")) as "BANK_TRANSFER", amount: Number(fd.get("amount") || total), reference: String(fd.get("reference") || "") || null,
        paidAt: String(fd.get("paidAt")), allocations: mine.filter((d) => Number(alloc[d.id]) > 0).map((d) => ({ documentId: d.id, amount: Number(alloc[d.id]) })),
        ...(code ? { currencyCode: code, amountLocal: Number(String(fd.get("amountLocal") || "0").replace(",", ".")) } : {}),
      }), () => setAlloc({}));
    }}>
      <div className="grid gap-3 sm:grid-cols-5">
        <div className="space-y-1 sm:col-span-2"><Label>{direction === "INBOUND" ? "Customer" : "Vendor"}</Label>
          <Select value={company} onChange={(e) => { setCompany(e.target.value); setAlloc({}); }}>{companies.map(([id, n]) => <option key={id} value={id}>{n}</option>)}</Select></div>
        <div className="space-y-1"><Label>Method</Label><Select name="method">{["BANK_TRANSFER", "MB_WAY", "MULTIBANCO", "DIRECT_DEBIT", "CARD", "CASH", "OTHER"].map((m) => <option key={m} value={m}>{m.replace("_", " ").toLowerCase()}</option>)}</Select></div>
        <div className="space-y-1"><Label>Date</Label><Input name="paidAt" type="date" required defaultValue={new Date().toISOString().slice(0, 10)} /></div>
        <div className="space-y-1"><Label>Reference</Label><Input name="reference" /></div>
      </div>
      <div className="space-y-1.5">
        {mine.map((d) => (
          <div key={d.id} className="flex items-center gap-2 text-sm">
            <span className="flex-1">{d.label}</span><span className="tabular-nums text-muted-foreground">open {d.open} €{d.currency && d.currency !== "EUR" && d.openLocal ? ` · ${d.openLocal} ${d.currency}` : ""}</span>
            <Button type="button" size="sm" variant="ghost" onClick={() => setAlloc({ ...alloc, [d.id]: d.open })}>full</Button>
            <Input className="h-8 w-28 text-right" inputMode="decimal" value={alloc[d.id] ?? ""} onChange={(e) => setAlloc({ ...alloc, [d.id]: e.target.value })} />
          </div>
        ))}
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1"><Label>Amount received / paid (€)</Label><Input name="amount" inputMode="decimal" className="w-36" placeholder={total.toFixed(2)} /></div>
        {code && <div className="space-y-1"><Label>Amount received ({code})</Label><Input name="amountLocal" inputMode="decimal" className="w-36" required data-testid="amount-local" /></div>}
        <Button type="submit" disabled={pending || total <= 0}>Record payment ({total.toFixed(2)} €)</Button>
      </div>
      <Err e={error} />
    </form>
  );
}

export function CreditNoteForm({ invoiceId, lines }: { invoiceId: string; lines: { id: string; description: string; qty: string }[] }) {
  const { pending, error, run } = useRun();
  const [qty, setQty] = useState<Record<string, string>>({});
  const [reason, setReason] = useState("");
  return (
    <div className="space-y-3">
      {lines.map((l) => (
        <div key={l.id} className="flex items-center gap-2 text-sm">
          <span className="flex-1 truncate">{l.description}</span><span className="text-muted-foreground">max {Number(l.qty)}</span>
          <Input className="h-8 w-20 text-right" type="number" min={0} max={Number(l.qty)} step="any" value={qty[l.id] ?? ""} onChange={(e) => setQty({ ...qty, [l.id]: e.target.value })} />
        </div>
      ))}
      <Input placeholder="Reason (shown on the credit note)" value={reason} onChange={(e) => setReason(e.target.value)} />
      <div className="flex gap-2">
        <Button variant="outline" disabled={pending || reason.trim().length < 3} onClick={() => run(() => issueCreditNoteAction({ invoiceId, all: false, reason, lines: Object.entries(qty).map(([invoiceLineId, q]) => ({ invoiceLineId, qty: Number(q) || 0 })) }))}>Credit selected quantities</Button>
        <Button variant="destructive" disabled={pending || reason.trim().length < 3} onClick={() => confirm("Credit the whole invoice?") && run(() => issueCreditNoteAction({ invoiceId, all: true, reason }))}>Credit everything</Button>
      </div>
      <Err e={error} />
    </div>
  );
}

type Opt = { id: string; label: string };
export function PromotionForm({ mode, offers = [], categories = [], groups = [], vendors = [] }: { mode: "VENDOR" | "ADMIN"; offers?: Opt[]; categories?: Opt[]; groups?: Opt[]; vendors?: Opt[] }) {
  const t = useTranslations("finance");
  const { pending, error, run } = useRun();
  const [open, setOpen] = useState(false);
  const [fund, setFund] = useState(100);
  const multi = (fd: FormData, k: string) => fd.getAll(k).map(String).filter(Boolean);
  if (!open) return <Button onClick={() => setOpen(true)}>{t("newPromotion")}</Button>;
  return (
    <form className="space-y-3 rounded-xl border bg-card p-4" onSubmit={(e) => {
      e.preventDefault();
      const fd = new FormData(e.currentTarget);
      const payload = {
        name: { en: String(fd.get("name")), pt: String(fd.get("name")) }, kind: String(fd.get("kind")) as "PERCENT", value: Number(fd.get("value")),
        validFrom: String(fd.get("validFrom")), validTo: String(fd.get("validTo") || "") || null, minQty: fd.get("minQty") ? Number(fd.get("minQty")) : null,
        targets: { offerIds: multi(fd, "offers"), categoryIds: multi(fd, "categories"), customerGroupIds: multi(fd, "groups"), vendorIds: multi(fd, "vendors") },
        ...(mode === "ADMIN" ? { firingiFundPct: fund, countryCode: "PT" } : {}),
      };
      run(() => (mode === "VENDOR" ? saveVendorPromotionAction(payload) : saveAdminPromotionAction(payload)), () => setOpen(false));
    }}>
      {mode === "VENDOR" && <p className="text-sm text-muted-foreground">{t("vendorPromoNote")}</p>}
      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <div className="space-y-1 sm:col-span-2"><Label>{t("name")}</Label><Input name="name" required /></div>
        <div className="space-y-1"><Label>{t("discount")}</Label><Select name="kind"><option value="PERCENT">{t("percent")}</option><option value="FIXED_AMOUNT">{t("fixed")}</option></Select></div>
        <div className="space-y-1"><Label>&nbsp;</Label><Input name="value" type="number" min="0.01" step="0.01" required /></div>
        <div className="space-y-1"><Label>{t("validFrom")}</Label><Input name="validFrom" type="date" required defaultValue={new Date().toISOString().slice(0, 10)} /></div>
        <div className="space-y-1"><Label>{t("validTo")}</Label><Input name="validTo" type="date" /></div>
        <div className="space-y-1"><Label>{t("minQty")}</Label><Input name="minQty" type="number" min={1} /></div>
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        {offers.length > 0 && <div className="space-y-1"><Label>{t("appliesTo")} — products (empty = {t("allMyProducts")})</Label><select name="offers" multiple className="h-32 w-full rounded-md border bg-card p-1 text-sm">{offers.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}</select></div>}
        {categories.length > 0 && <div className="space-y-1"><Label>Categories</Label><select name="categories" multiple className="h-32 w-full rounded-md border bg-card p-1 text-sm">{categories.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}</select></div>}
        {groups.length > 0 && <div className="space-y-1"><Label>Customer groups (only these buyers)</Label><select name="groups" multiple className="h-32 w-full rounded-md border bg-card p-1 text-sm">{groups.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}</select></div>}
        {vendors.length > 0 && <div className="space-y-1"><Label>Vendors</Label><select name="vendors" multiple className="h-32 w-full rounded-md border bg-card p-1 text-sm">{vendors.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}</select></div>}
      </div>
      {mode === "ADMIN" && (
        <div className="space-y-1">
          <Label>Who pays the discount? FIRINGI {fund}% · vendor {100 - fund}%</Label>
          <input type="range" min={0} max={100} step={5} value={fund} onChange={(e) => setFund(Number(e.target.value))} className="w-72 accent-[var(--primary)]" />
          {fund < 100 && <p className="text-xs text-muted-foreground">Vendors must accept their share before the promotion applies to their products.</p>}
        </div>
      )}
      <Err e={error} />
      <div className="flex gap-2"><Button type="submit" disabled={pending}>{t("save")}</Button><Button type="button" variant="outline" onClick={() => setOpen(false)}>✕</Button></div>
    </form>
  );
}

export function PromotionStatusButtons({ id, status }: { id: string; status: string }) {
  const t = useTranslations("finance");
  const { pending, run } = useRun();
  if (status === "ENDED") return null;
  return (
    <div className="flex justify-end gap-1">
      <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => setPromotionStatusAction({ id, status: status === "ACTIVE" ? "PAUSED" : "ACTIVE" }))}>{status === "ACTIVE" ? t("pause") : t("resume")}</Button>
      <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => setPromotionStatusAction({ id, status: "ENDED" }))}>{t("end")}</Button>
    </div>
  );
}

export function AcceptButtons({ id }: { id: string }) {
  const t = useTranslations("finance");
  const { pending, error, run } = useRun();
  return (
    <div className="flex gap-1">
      <Button size="sm" disabled={pending} onClick={() => run(() => answerPromotionAction({ id, accept: true }))}>{t("accept")}</Button>
      <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => answerPromotionAction({ id, accept: false }))}>{t("decline")}</Button>
      <Err e={error} />
    </div>
  );
}

export function CustomerTermsForm({ companyId, days, limit }: { companyId: string; days: number; limit: string | null }) {
  const { pending, error, run } = useRun();
  const [d, setD] = useState(String(days));
  const [l, setL] = useState(limit ?? "");
  return (
    <div className="flex items-center justify-end gap-1.5">
      <Input className="h-8 w-16 text-right" type="number" min={0} max={180} value={d} onChange={(e) => setD(e.target.value)} aria-label="Payment terms (days)" />
      <Input className="h-8 w-24 text-right" type="number" min={0} placeholder="no limit" value={l} onChange={(e) => setL(e.target.value)} aria-label="Credit limit" />
      <Button size="sm" variant="outline" disabled={pending || (d === String(days) && l === (limit ?? ""))} onClick={() => run(() => setCustomerTermsAction({ companyId, paymentTermsDays: Number(d), creditLimit: l === "" ? null : Number(l) }))}>Save</Button>
      <Err e={error} />
    </div>
  );
}
