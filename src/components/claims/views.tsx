/** Quality claims (Phase 31): shared server views — the claim's timeline, lines, photos, decision and conversation. */
import Link from "next/link";
import { Camera, CheckCircle2, Clock, MessageSquare, ShieldAlert, Truck, XCircle } from "lucide-react";
import type { claimDetail } from "@/server/claims/service";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatMoney } from "@/lib/utils";
import { EN_VOICE, SpeakButton } from "@/components/voice/voice";

export type Detail = Awaited<ReturnType<typeof claimDetail>>;
export type T = (key: string, vars?: Record<string, string | number>) => string;

export const CLAIM_STATUS_TONE = { OPEN: "warning", APPROVED: "success", REJECTED: "destructive", WITHDRAWN: "outline" } as const;
export const CHARGEBACK_TONE = { OPEN: "warning", DISPUTED: "destructive", DEDUCTED: "success", WAIVED: "outline" } as const;

const fmtDate = (d: Date, locale: string) => new Intl.DateTimeFormat(locale, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).format(d);

/** "in 5 h" / "3 h late" for an SLA. */
export function SlaChip({ due, t, done }: { due: Date; t: T; done?: boolean }) {
  if (done) return null;
  const h = Math.round((due.getTime() - Date.now()) / 3600_000);
  return h < 0
    ? <Badge variant="destructive" data-testid="sla-late"><Clock className="mr-1 size-3" aria-hidden />{t("sla.late", { hours: -h })}</Badge>
    : <Badge variant={h <= 6 ? "warning" : "secondary"}><Clock className="mr-1 size-3" aria-hidden />{t("sla.left", { hours: h })}</Badge>;
}

function Photos({ base, who, count, label }: { base: string; who: string; count: number; label: string }) {
  if (!count) return null;
  return (
    <div className="mt-3 flex flex-wrap gap-2" data-testid={`photos-${who}`}>
      {Array.from({ length: count }, (_, n) => (
        <a key={n} href={`${base}/${who}/${n}`} target="_blank" rel="noreferrer" className="group relative block size-20 overflow-hidden rounded-xl border bg-muted">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={`${base}/${who}/${n}`} alt={`${label} ${n + 1}`} className="size-full object-cover transition-transform group-hover:scale-105" />
        </a>
      ))}
    </div>
  );
}

export function ClaimSummary({ d, t, locale, orderHref }: { d: Detail; t: T; locale: string; orderHref: string }) {
  const steps = [
    { key: "opened", done: true, at: d.createdAt },
    { key: "supplier", done: !!d.supplier.response, at: d.supplier.at },
    { key: "decided", done: !!d.decision, at: d.decision?.at ?? null },
    ...(d.decision?.outcome === "REPLACEMENT" ? [{ key: "replaced", done: !!d.decision.replacementDoneAt, at: d.decision.replacementDoneAt }] : []),
  ];
  return (
    <Card className="mb-6 overflow-hidden" data-testid="claim-summary">
      <div className="h-1 bg-[linear-gradient(90deg,var(--vivid-pink),var(--vivid-orange),var(--vivid-violet))]" aria-hidden />
      <CardContent className="pt-5">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={CLAIM_STATUS_TONE[d.status]} data-testid="claim-status">{t(`status.${d.status}`)}</Badge>
          <Badge variant="secondary">{t(`reason.${d.reason}`)}</Badge>
          {d.decision?.outcome && <Badge variant="outline">{t(`outcome.${d.decision.outcome}`)}</Badge>}
          {d.status === "OPEN" && <SlaChip due={d.dueBy} t={t} />}
          <span className="ml-auto text-sm text-muted-foreground">{t("order")} <Link href={orderHref} className="font-medium text-primary hover:underline">{d.order.number}</Link></span>
        </div>
        <ol className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4" aria-label={t("progress")}>
          {steps.map((s, i) => (
            <li key={s.key} className={`relative rounded-xl border p-3 ${s.done ? "border-[color:color-mix(in_oklch,var(--vivid-teal)_45%,var(--border))] bg-[color-mix(in_oklch,var(--vivid-teal)_7%,transparent)]" : "border-dashed"}`}>
              <div className="flex items-center gap-2 text-sm font-medium">
                <span className={`grid size-6 shrink-0 place-items-center rounded-full text-xs ${s.done ? "bg-[var(--vivid-teal)] text-white" : "bg-muted text-muted-foreground"}`}>{i + 1}</span>
                <span className="min-w-0 break-words">{t(`step.${s.key}`)}</span>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">{s.at ? fmtDate(s.at, locale) : s.key === "supplier" && !s.done ? t("step.supplierBy", { date: fmtDate(d.supplierAnswerBy, locale) }) : "—"}</p>
            </li>
          ))}
        </ol>
      </CardContent>
    </Card>
  );
}

export function ClaimLines({ d, t, locale, approvedEditable }: { d: Detail; t: T; locale: string; approvedEditable?: boolean }) {
  const showPrice = d.lines.some((l) => l.unitGross !== null);
  const showCost = d.lines.some((l) => l.unitCost !== null);
  return (
    <Card className="mb-6">
      <CardHeader><CardTitle>{t("lines")}</CardTitle><CardDescription>{d.description}</CardDescription></CardHeader>
      <CardContent>
        <ul className="divide-y" data-testid="claim-lines">
          {d.lines.map((l) => (
            <li key={l.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-3 text-sm">
              <div className="min-w-0 flex-1 basis-56">
                <p className="break-words font-medium">{l.product}</p>
                <p className="text-xs text-muted-foreground">{l.packaging} · {l.sku}{l.lotCode ? ` · ${t("lot")} ${l.lotCode}` : ""}</p>
              </div>
              <span className="tabular-nums">{t("claimedQty", { qty: l.qty, delivered: l.delivered })}</span>
              {!approvedEditable && l.approvedQty !== null && <Badge variant={l.approvedQty > 0 ? "success" : "outline"}>{t("approvedQty", { qty: l.approvedQty })}</Badge>}
              {showPrice && l.unitGross !== null && <span className="whitespace-nowrap text-muted-foreground">{t("unitPaid", { amount: formatMoney(l.unitGross, locale) })}</span>}
              {showCost && l.unitCost !== null && <span className="whitespace-nowrap text-muted-foreground">{t("unitCost", { amount: formatMoney(l.unitCost, locale) })}</span>}
            </li>
          ))}
        </ul>
        <Photos base={`/api/claims/${d.id}/photos`} who="c" count={d.photos} label={t("photo")} />
      </CardContent>
    </Card>
  );
}

export function SupplierSide({ d, t, locale }: { d: Detail; t: T; locale: string }) {
  if (!d.supplier.response) return null;
  return (
    <Card className="mb-6" data-testid="supplier-side">
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          {d.supplier.response === "ACCEPTED" ? <CheckCircle2 className="size-5 text-[var(--vivid-teal)]" aria-hidden /> : <ShieldAlert className="size-5 text-[var(--vivid-orange)]" aria-hidden />}
          {t(`supplierResponse.${d.supplier.response}`)}
        </CardTitle>
        <CardDescription>{d.seller.name}{d.supplier.at ? ` · ${fmtDate(d.supplier.at, locale)}` : ""}</CardDescription>
      </CardHeader>
      {(d.supplier.comment || d.supplier.photos > 0) && (
        <CardContent>
          {d.supplier.comment && <p className="whitespace-pre-wrap break-words text-sm">{d.supplier.comment}</p>}
          <Photos base={`/api/claims/${d.id}/photos`} who="s" count={d.supplier.photos} label={t("photo")} />
        </CardContent>
      )}
    </Card>
  );
}

export function DecisionCard({ d, t, locale, creditNoteHref }: { d: Detail; t: T; locale: string; creditNoteHref?: string }) {
  if (!d.decision) return null;
  const x = d.decision;
  const ok = d.status === "APPROVED";
  return (
    <Card className={`mb-6 border-2 ${ok ? "border-[color:color-mix(in_oklch,var(--vivid-teal)_45%,var(--border))]" : "border-[color:color-mix(in_oklch,var(--destructive)_40%,var(--border))]"}`} data-testid="decision-card">
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          {ok ? <CheckCircle2 className="size-5 text-[var(--vivid-teal)]" aria-hidden /> : <XCircle className="size-5 text-destructive" aria-hidden />}
          {ok ? t(`decided.${x.outcome}`) : t("decided.REJECTED")}
        </CardTitle>
        <CardDescription>{fmtDate(x.at, locale)}{x.by ? ` · ${x.by}` : ""}{x.fault ? ` · ${t(`fault.${x.fault}`)}` : ""}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        {x.note && <p className="whitespace-pre-wrap break-words">{x.note}</p>}
        {x.credit !== null && (
          <p data-testid="credit-amount">
            {t("creditIssued", { amount: formatMoney(x.credit, locale) })}{x.creditDeliveryFee ? ` ${t("feeIncluded")}` : ""}
            {creditNoteHref && x.creditNoteId && <> · <Link href={creditNoteHref} className="font-medium text-primary hover:underline">{t("viewCreditNote")}</Link></>}
          </p>
        )}
        {x.outcome === "REPLACEMENT" && (
          <p className="flex items-center gap-2"><Truck className="size-4" aria-hidden />{x.replacementDoneAt ? t("replacementDone", { date: fmtDate(x.replacementDoneAt, locale) }) : t("replacementPending")}</p>
        )}
      </CardContent>
    </Card>
  );
}

export function Conversation({ d, t, locale, children, english }: { d: Detail; t: T; locale: string; children?: React.ReactNode; english?: boolean }) {
  const tone = { CUSTOMER: "var(--vivid-blue)", SUPPLIER: "var(--vivid-orange)", FIRINGI: "var(--vivid-violet)" } as const;
  return (
    <Card className="mb-6">
      <CardHeader><CardTitle className="flex items-center gap-2"><MessageSquare className="size-5" aria-hidden />{t("conversation")}</CardTitle></CardHeader>
      <CardContent>
        <ul className="space-y-3" data-testid="claim-messages">
          {!d.messages.length && <li className="text-sm text-muted-foreground">{t("noMessages")}</li>}
          {d.messages.map((m) => (
            <li key={m.id} className={`rounded-xl border p-3 ${m.internal ? "border-dashed bg-muted/40" : ""}`} style={{ borderLeft: `3px solid ${tone[m.side as keyof typeof tone]}` }}>
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <span className="font-semibold text-foreground">{t(`side.${m.side}`)}</span><span>{m.by}</span><span>· {fmtDate(m.at, locale)}</span>
                {m.internal && <Badge variant="outline">{t("internal")}</Badge>}
              </div>
              <p className="mt-1 whitespace-pre-wrap break-words text-sm">{m.body}</p>
              {!m.internal && <div className="mt-1 -ml-2"><SpeakButton text={m.body} labels={english ? EN_VOICE : undefined} /></div>}
              {m.photos > 0 && <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground"><Camera className="size-3" aria-hidden />{Array.from({ length: m.photos }, (_, n) => <a key={n} className="text-primary hover:underline" target="_blank" rel="noreferrer" href={`/api/claims/${d.id}/photos/m${m.id}/${n}`}>{t("photo")} {n + 1}</a>)}</p>}
            </li>
          ))}
        </ul>
        {children && <div className="mt-4">{children}</div>}
      </CardContent>
    </Card>
  );
}
