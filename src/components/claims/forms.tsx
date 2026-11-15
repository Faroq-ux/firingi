"use client";
/** Quality claims (Phase 31): client forms. Customer + supplier forms are translated; FIRINGI's are English. */
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Camera, Check, Send, Truck, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";
import { shrink } from "@/components/delivery/delivery-forms";
import { EN_VOICE, MicButton, appendSpoken } from "@/components/voice/voice";
import type { ActionResult } from "@/server/actions/_action";
import {
  acknowledgeAlertAction, addClaimMessageAction, claimPreviewAction, createClaimAction, decideClaimAction, disputeChargebackAction, markReplacementDoneAction,
  resolveChargebackAction, respondClaimAction, saveClaimSettingsAction, withdrawClaimAction,
} from "@/server/actions/claims";

function useAct() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const run = <R,>(fn: () => Promise<ActionResult<R>>, after?: (r: R) => void) =>
    start(async () => {
      setError(null);
      const r = await fn();
      if (r.ok) { after?.(r.data as R); router.refresh(); } else setError(r.error);
    });
  return { pending, error, run };
}
const Err = ({ e }: { e: string | null }) => (e ? <p className="w-full text-sm text-destructive" role="alert">{e}</p> : null);
const area = "min-h-24 w-full rounded-md border border-input bg-background px-3 py-2 text-sm";
const REASONS = ["DAMAGED", "MISSING", "WRONG_PRODUCT", "TEMPERATURE", "SHORT_DATED", "QUALITY"] as const;

function PhotoPicker({ files, onChange, label, max = 6, testId }: { files: File[]; onChange: (f: File[]) => void; label: string; max?: number; testId?: string }) {
  return (
    <div className="grid gap-1.5">
      <Label>{label}</Label>
      <label className="flex cursor-pointer items-center gap-2 rounded-xl border border-dashed px-3 py-3 text-sm text-muted-foreground transition hover:border-[var(--vivid-violet)]">
        <Camera className="size-4 shrink-0" aria-hidden />
        <span className="min-w-0 break-words">{files.length ? files.map((f) => f.name).join(", ") : label}</span>
        <input type="file" accept="image/*" capture="environment" multiple className="sr-only" data-testid={testId}
          onChange={(e) => onChange([...files, ...Array.from(e.target.files ?? [])].slice(0, max))} />
      </label>
    </div>
  );
}

// ── customer ────────────────────────────────────────────────────────────────

type ClaimLine = { id: string; product: string; packaging: string; sku: string; delivered: number; claimable: number; lots: { lotCode: string | null; expiresOn: string }[] };

export function NewClaimForm({ orderId, lines, photoReasons }: { orderId: string; lines: ClaimLine[]; photoReasons: string[] }) {
  const t = useTranslations("claims");
  const router = useRouter();
  const { pending, error, run } = useAct();
  const [reason, setReason] = useState<(typeof REASONS)[number]>("DAMAGED");
  const [outcome, setOutcome] = useState<"CREDIT" | "REPLACEMENT">("CREDIT");
  const [description, setDescription] = useState("");
  const [qty, setQty] = useState<Record<string, number>>({});
  const [lot, setLot] = useState<Record<string, string>>({});
  const [photos, setPhotos] = useState<File[]>([]);
  const needPhoto = photoReasons.includes(reason);
  const total = Object.values(qty).reduce((a, b) => a + b, 0);
  return (
    <div className="space-y-5" data-testid="claim-form">
      <fieldset className="grid gap-2">
        <legend className="mb-1 text-sm font-medium">{t("form.what")}</legend>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {REASONS.map((r) => (
            <label key={r} className={`flex cursor-pointer items-center gap-2 rounded-xl border px-3 py-2.5 text-sm transition ${reason === r ? "border-[var(--vivid-violet)] bg-[color-mix(in_oklch,var(--vivid-violet)_9%,transparent)] font-medium" : "hover:border-[var(--vivid-violet)]"}`}>
              <input type="radio" name="reason" value={r} checked={reason === r} onChange={() => setReason(r)} className="accent-[var(--vivid-violet)]" />
              <span className="min-w-0 break-words">{t(`reason.${r}`)}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <div className="grid gap-2">
        <p className="text-sm font-medium">{t("form.which")}</p>
        <ul className="divide-y rounded-xl border">
          {lines.map((l) => (
            <li key={l.id} className="flex flex-wrap items-center gap-3 px-3 py-3 text-sm">
              <div className="min-w-0 flex-1 basis-48">
                <p className="break-words font-medium">{l.product}</p>
                <p className="text-xs text-muted-foreground">{l.packaging} · {t("form.delivered", { qty: l.delivered })}{l.claimable < l.delivered ? ` · ${t("form.left", { qty: l.claimable })}` : ""}</p>
              </div>
              {l.lots.length > 1 && (
                <Select aria-label={t("lot")} className="w-40" value={lot[l.id] ?? ""} onChange={(e) => setLot({ ...lot, [l.id]: e.target.value })}>
                  <option value="">{t("form.lotUnknown")}</option>
                  {l.lots.filter((x) => x.lotCode).map((x) => <option key={x.lotCode!} value={x.lotCode!}>{x.lotCode} · {x.expiresOn}</option>)}
                </Select>
              )}
              <Input type="number" min={0} max={l.claimable} disabled={!l.claimable} aria-label={t("form.qtyFor", { product: l.product })} className="w-24" data-testid={`claim-qty-${l.sku}`}
                value={qty[l.id] ?? 0} onChange={(e) => setQty({ ...qty, [l.id]: Math.max(0, Math.min(l.claimable, Math.round(Number(e.target.value) || 0))) })} />
            </li>
          ))}
        </ul>
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="claim-desc">{t("form.describe")}</Label>
        <div className="flex items-start gap-2">
          <textarea id="claim-desc" className={area} value={description} onChange={(e) => setDescription(e.target.value)} placeholder={t("form.describeHint")} data-testid="claim-description" />
          <MicButton onText={(s) => setDescription((d) => appendSpoken(d, s))} testId="claim-mic" />
        </div>
      </div>
      <PhotoPicker files={photos} onChange={setPhotos} label={needPhoto ? t("form.photosNeeded") : t("form.photos")} testId="claim-photos" />
      <fieldset className="grid gap-2">
        <legend className="mb-1 text-sm font-medium">{t("form.prefer")}</legend>
        <div className="flex flex-wrap gap-2">
          {(["CREDIT", "REPLACEMENT"] as const).map((o) => (
            <label key={o} className={`flex cursor-pointer items-center gap-2 rounded-xl border px-3 py-2 text-sm ${outcome === o ? "border-[var(--vivid-teal)] bg-[color-mix(in_oklch,var(--vivid-teal)_9%,transparent)] font-medium" : ""}`}>
              <input type="radio" name="outcome" checked={outcome === o} onChange={() => setOutcome(o)} className="accent-[var(--vivid-teal)]" />{t(`prefer.${o}`)}
            </label>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">{t("form.decides")}</p>
      </fieldset>
      <div className="flex flex-wrap items-center gap-3">
        <Button disabled={pending || !total || description.trim().length < 5 || (needPhoto && !photos.length)} data-testid="claim-submit"
          onClick={() => run(async () => {
            const fd = new FormData();
            fd.set("orderId", orderId); fd.set("reason", reason); fd.set("preferredOutcome", outcome); fd.set("description", description);
            for (const [id, q] of Object.entries(qty)) if (q > 0) fd.append("line", `${id}:${q}:${lot[id] ?? ""}`);
            for (const p of photos) fd.append("photos", await shrink(p));
            return createClaimAction(fd);
          }, (r) => router.push(`/buy/orders/claims/${(r as { id: string }).id}`))}>
          <Send className="size-4" aria-hidden />{t("form.send")}
        </Button>
        <Err e={error} />
      </div>
    </div>
  );
}

export function WithdrawClaim({ id }: { id: string }) {
  const t = useTranslations("claims");
  const { pending, error, run } = useAct();
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button variant="outline" size="sm" disabled={pending} onClick={() => { if (confirm(t("withdrawConfirm"))) run(() => withdrawClaimAction({ id })); }} data-testid="claim-withdraw">
        <Undo2 className="size-4" aria-hidden />{t("withdraw")}
      </Button>
      <Err e={error} />
    </div>
  );
}

// ── shared: conversation ────────────────────────────────────────────────────

export function MessageForm({ claimId, allowInternal, labels }: { claimId: string; allowInternal?: boolean; labels: { placeholder: string; send: string; internal?: string; photos: string } }) {
  const { pending, error, run } = useAct();
  const [body, setBody] = useState("");
  const [internal, setInternal] = useState(false);
  const [photos, setPhotos] = useState<File[]>([]);
  return (
    <div className="space-y-2">
      <div className="flex items-start gap-2">
        <textarea className={area} value={body} onChange={(e) => setBody(e.target.value)} placeholder={labels.placeholder} aria-label={labels.placeholder} data-testid="claim-message" />
        <MicButton onText={(s) => setBody((b) => appendSpoken(b, s))} labels={allowInternal ? EN_VOICE : undefined} testId="claim-message-mic" />
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex cursor-pointer items-center gap-1.5 text-sm text-muted-foreground"><Camera className="size-4" aria-hidden />{photos.length ? `${photos.length} ×` : labels.photos}
          <input type="file" accept="image/*" multiple className="sr-only" onChange={(e) => setPhotos(Array.from(e.target.files ?? []).slice(0, 4))} />
        </label>
        {allowInternal && <label className="flex items-center gap-1.5 text-sm"><input type="checkbox" checked={internal} onChange={(e) => setInternal(e.target.checked)} data-testid="claim-internal" />{labels.internal}</label>}
        <Button size="sm" className="ml-auto" disabled={pending || body.trim().length < 2} data-testid="claim-message-send"
          onClick={() => run(async () => {
            const fd = new FormData();
            fd.set("claimId", claimId); fd.set("body", body); if (internal) fd.set("internal", "1");
            for (const p of photos) fd.append("photos", await shrink(p));
            return addClaimMessageAction(fd);
          }, () => { setBody(""); setPhotos([]); })}>
          <Send className="size-4" aria-hidden />{labels.send}
        </Button>
      </div>
      <Err e={error} />
    </div>
  );
}

export function ReplacementDone({ id, label }: { id: string; label: string }) {
  const { pending, error, run } = useAct();
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button size="sm" disabled={pending} onClick={() => run(() => markReplacementDoneAction({ id }))} data-testid="replacement-done"><Truck className="size-4" aria-hidden />{label}</Button>
      <Err e={error} />
    </div>
  );
}

// ── supplier ────────────────────────────────────────────────────────────────

export function SupplierResponseForm({ claimId, current }: { claimId: string; current: "ACCEPTED" | "DISPUTED" | null }) {
  const t = useTranslations("claims");
  const { pending, error, run } = useAct();
  const [response, setResponse] = useState<"ACCEPTED" | "DISPUTED">(current ?? "ACCEPTED");
  const [comment, setComment] = useState("");
  const [photos, setPhotos] = useState<File[]>([]);
  return (
    <div className="space-y-3" data-testid="supplier-response-form">
      <div className="flex flex-wrap gap-2">
        {(["ACCEPTED", "DISPUTED"] as const).map((r) => (
          <label key={r} className={`flex cursor-pointer items-center gap-2 rounded-xl border px-3 py-2 text-sm ${response === r ? "border-[var(--vivid-violet)] bg-[color-mix(in_oklch,var(--vivid-violet)_9%,transparent)] font-medium" : ""}`}>
            <input type="radio" name="response" checked={response === r} onChange={() => setResponse(r)} />{t(`respond.${r}`)}
          </label>
        ))}
      </div>
      <div className="flex items-start gap-2">
        <textarea className={area} value={comment} onChange={(e) => setComment(e.target.value)} placeholder={response === "DISPUTED" ? t("respond.whyDispute") : t("respond.comment")} aria-label={t("respond.comment")} data-testid="supplier-comment" />
        <MicButton onText={(s) => setComment((c) => appendSpoken(c, s))} testId="supplier-mic" />
      </div>
      <PhotoPicker files={photos} onChange={setPhotos} label={t("respond.photos")} max={4} />
      <div className="flex flex-wrap items-center gap-3">
        <Button disabled={pending || (response === "DISPUTED" && comment.trim().length < 5)} data-testid="supplier-respond"
          onClick={() => run(async () => {
            const fd = new FormData();
            fd.set("claimId", claimId); fd.set("response", response); fd.set("comment", comment);
            for (const p of photos) fd.append("photos", await shrink(p));
            return respondClaimAction(fd);
          })}>
          <Check className="size-4" aria-hidden />{current ? t("respond.update") : t("respond.send")}
        </Button>
        <Err e={error} />
      </div>
    </div>
  );
}

export function DisputeChargeback({ id }: { id: string }) {
  const t = useTranslations("claims");
  const { pending, error, run } = useAct();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  if (!open) return <Button size="sm" variant="outline" onClick={() => setOpen(true)} data-testid={`dispute-${id}`}>{t("chargeback.dispute")}</Button>;
  return (
    <div className="w-full space-y-2">
      <textarea className={area} value={note} onChange={(e) => setNote(e.target.value)} placeholder={t("chargeback.why")} aria-label={t("chargeback.why")} data-testid="dispute-note" />
      <div className="flex flex-wrap gap-2">
        <Button size="sm" disabled={pending || note.trim().length < 5} onClick={() => run(() => disputeChargebackAction({ id, note }), () => setOpen(false))} data-testid="dispute-send">{t("chargeback.send")}</Button>
        <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>{t("cancel")}</Button>
      </div>
      <Err e={error} />
    </div>
  );
}

// ── FIRINGI (English) ───────────────────────────────────────────────────────

type DecisionLine = { id: string; product: string; qty: number; unitGross: number | null };
const eur = (v: number) => new Intl.NumberFormat("en-IE", { style: "currency", currency: "EUR" }).format(v);

export function DecisionForm({ claimId, lines, fee, delivery, preferred, supplierFleet }: {
  claimId: string; lines: DecisionLine[]; fee: number | null; preferred: "CREDIT" | "REPLACEMENT";
  delivery: { eligible: boolean; cap: number; why: string | null; driverName: string | null }; supplierFleet: boolean;
}) {
  const { pending, error, run } = useAct();
  const [decision, setDecision] = useState<"APPROVE" | "REJECT">("APPROVE");
  const [outcome, setOutcome] = useState<"CREDIT" | "REPLACEMENT">(preferred);
  const [fault, setFault] = useState<"SUPPLIER" | "DRIVER" | "FIRINGI">("SUPPLIER");
  const [approved, setApproved] = useState<Record<string, number>>(Object.fromEntries(lines.map((l) => [l.id, l.qty])));
  const [creditFee, setCreditFee] = useState(false);
  const [driverAmount, setDriverAmount] = useState(delivery.eligible ? delivery.cap : 0);
  const [note, setNote] = useState("");
  const [preview, setPreview] = useState<number | null>(null);
  const linesIn = lines.map((l) => ({ lineId: l.id, approvedQty: approved[l.id] ?? 0 }));
  const key = JSON.stringify([linesIn, creditFee]);
  useEffect(() => {
    if (decision !== "APPROVE" || outcome !== "CREDIT") return;
    let live = true;
    claimPreviewAction({ id: claimId, lines: linesIn, creditDeliveryFee: creditFee }).then((r) => { if (live && r.ok) setPreview(r.data as number); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, decision, outcome]);
  const whyNot = delivery.why === "FREE_DELIVERY" ? "The customer paid no delivery fee, so the driver earned no per-delivery pay — no charge-back."
    : delivery.why === "SUPPLIER_FLEET" ? "Delivered by the supplier's own fleet — its drivers are the supplier's staff: a delivery fault is the supplier's."
    : delivery.why === "NO_FIRINGI_DRIVER" ? "No FIRINGI driver on this delivery." : null;
  return (
    <div className="space-y-4" data-testid="decision-form">
      <div className="flex flex-wrap gap-2">
        {(["APPROVE", "REJECT"] as const).map((d) => (
          <Button key={d} size="sm" variant={decision === d ? "default" : "outline"} onClick={() => setDecision(d)} data-testid={`decide-${d.toLowerCase()}`}>{d === "APPROVE" ? "Approve" : "Reject"}</Button>
        ))}
      </div>
      {decision === "APPROVE" && (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5"><Label>Outcome</Label>
              <Select value={outcome} onChange={(e) => setOutcome(e.target.value as "CREDIT" | "REPLACEMENT")} data-testid="decide-outcome">
                <option value="CREDIT">Credit note</option><option value="REPLACEMENT" disabled={fault !== "SUPPLIER"}>Replacement by the supplier</option>
              </Select>
            </div>
            <div className="grid gap-1.5"><Label>Whose fault</Label>
              <Select value={fault} onChange={(e) => { const f = e.target.value as typeof fault; setFault(f); if (f !== "SUPPLIER") setOutcome("CREDIT"); }} data-testid="decide-fault">
                <option value="SUPPLIER">Supplier (goods, packing{supplierFleet ? ", its own delivery" : ""}) — charged back</option>
                <option value="DRIVER" disabled={supplierFleet}>FIRINGI driver (our delivery)</option>
                <option value="FIRINGI">FIRINGI / goodwill — we carry it</option>
              </Select>
            </div>
          </div>
          <ul className="divide-y rounded-xl border">
            {lines.map((l) => (
              <li key={l.id} className="flex flex-wrap items-center gap-3 px-3 py-2 text-sm">
                <span className="min-w-0 flex-1 basis-40 break-words">{l.product}</span>
                <span className="text-muted-foreground">claimed {l.qty}{l.unitGross !== null ? ` · ${eur(l.unitGross)}/unit` : ""}</span>
                <Input type="number" min={0} max={l.qty} className="w-20" aria-label={`Approved quantity for ${l.product}`} value={approved[l.id] ?? 0} data-testid="decide-qty"
                  onChange={(e) => setApproved({ ...approved, [l.id]: Math.max(0, Math.min(l.qty, Math.round(Number(e.target.value) || 0))) })} />
              </li>
            ))}
          </ul>
          {outcome === "CREDIT" && fee !== null && fee > 0 && (
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={creditFee} onChange={(e) => setCreditFee(e.target.checked)} />Also credit the delivery fee ({eur(fee)})</label>
          )}
          {fault === "DRIVER" && (
            <div className="rounded-xl border p-3 text-sm" data-testid="driver-chargeback">
              {delivery.eligible ? (
                <div className="flex flex-wrap items-center gap-3">
                  <span className="min-w-0 flex-1 basis-56">Charge back to {delivery.driverName ?? "the driver"} — at most their pay for this delivery ({eur(delivery.cap)}):</span>
                  <Input type="number" min={0} max={delivery.cap} step="0.01" className="w-28" value={driverAmount} aria-label="Driver charge-back" onChange={(e) => setDriverAmount(Math.max(0, Math.min(delivery.cap, Number(e.target.value) || 0)))} />
                </div>
              ) : <p className="text-muted-foreground">{whyNot}</p>}
            </div>
          )}
          {outcome === "CREDIT" && preview !== null && <p className="text-sm" data-testid="decide-preview">Credit note to the customer: <strong>{eur(preview)}</strong>{fault === "SUPPLIER" ? " — the supplier credits its cost back to FIRINGI (netted off its payout)." : " — FIRINGI carries it."}</p>}
        </>
      )}
      <div className="grid gap-1.5">
        <Label htmlFor="decision-note">{decision === "REJECT" ? "Why (the customer and the supplier see this)" : "Note to the customer and the supplier (optional)"}</Label>
        <textarea id="decision-note" className={area} value={note} onChange={(e) => setNote(e.target.value)} data-testid="decide-note" />
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button disabled={pending} data-testid="decide-submit" variant={decision === "REJECT" ? "destructive" : "default"}
          onClick={() => run(() => decideClaimAction(decision === "REJECT"
            ? { id: claimId, decision, fault: "CUSTOMER", note }
            : { id: claimId, decision, outcome, fault, lines: linesIn, creditDeliveryFee: outcome === "CREDIT" && creditFee, driverAmount: fault === "DRIVER" && delivery.eligible ? driverAmount : null, note }))}>
          {decision === "REJECT" ? "Reject claim" : outcome === "CREDIT" ? "Approve & issue credit note" : "Approve replacement"}
        </Button>
        <Err e={error} />
      </div>
    </div>
  );
}

export function ResolveChargeback({ id, status, target }: { id: string; status: string; target: "SUPPLIER" | "DRIVER" }) {
  const { pending, error, run } = useAct();
  const [note, setNote] = useState("");
  return (
    <div className="flex flex-wrap items-center gap-2">
      {(status === "OPEN" || status === "DISPUTED") && <Input className="h-8 w-44" placeholder="Note" value={note} onChange={(e) => setNote(e.target.value)} aria-label="Note" />}
      {status === "DISPUTED" && <Button size="sm" disabled={pending} onClick={() => run(() => resolveChargebackAction({ id, action: "UPHOLD", note }))} data-testid={`uphold-${id}`}>Uphold</Button>}
      {(status === "OPEN" || status === "DISPUTED") && <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => resolveChargebackAction({ id, action: "WAIVE", note }))} data-testid={`waive-${id}`}>Waive</Button>}
      {status === "OPEN" && target === "DRIVER" && <Button size="sm" variant="secondary" disabled={pending} onClick={() => run(() => resolveChargebackAction({ id, action: "DEDUCTED", note }))}>Deducted from pay</Button>}
      <Err e={error} />
    </div>
  );
}

export function AcknowledgeAlert({ id }: { id: string }) {
  const { pending, error, run } = useAct();
  return <span className="inline-flex items-center gap-2"><Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => acknowledgeAlertAction({ id }))} data-testid={`ack-${id}`}>Acknowledge</Button><Err e={error} /></span>;
}

type Settings = { windowHours: number; slaHours: number; supplierResponseHours: number; photoReasons: string[]; supplierRatePct: number; productRatePct: number; lotClaims: number; driverClaims: number; minDeliveries: number };
export function ClaimSettingsForm({ values, canEdit }: { values: Settings; canEdit: boolean }) {
  const { pending, error, run } = useAct();
  const [v, setV] = useState(values);
  const [saved, setSaved] = useState(false);
  const num = (k: keyof Settings, label: string, hint: string, unit: string) => (
    <div className="grid gap-1.5">
      <Label htmlFor={`cs-${k}`}>{label}</Label>
      <div className="flex items-center gap-2"><Input id={`cs-${k}`} type="number" step="any" className="w-28" disabled={!canEdit} value={v[k] as number} onChange={(e) => { setSaved(false); setV({ ...v, [k]: Number(e.target.value) }); }} data-testid={`cs-${k}`} /><span className="text-sm text-muted-foreground">{unit}</span></div>
      <p className="text-xs text-muted-foreground">{hint}</p>
    </div>
  );
  return (
    <div className="space-y-6" data-testid="claim-settings">
      <div className="grid gap-5 sm:grid-cols-3">
        {num("windowHours", "Claim window", "How long after delivery a customer can report a problem.", "hours")}
        {num("supplierResponseHours", "Supplier answer time", "The supplier is reminded once after this.", "hours")}
        {num("slaHours", "FIRINGI decision time (SLA)", "Claims open longer are overdue.", "hours")}
      </div>
      <fieldset className="grid gap-2">
        <legend className="text-sm font-medium">Photo required for</legend>
        <div className="flex flex-wrap gap-3">
          {REASONS.map((r) => (
            <label key={r} className="flex items-center gap-1.5 text-sm"><input type="checkbox" disabled={!canEdit} checked={v.photoReasons.includes(r)}
              onChange={(e) => { setSaved(false); setV({ ...v, photoReasons: e.target.checked ? [...v.photoReasons, r] : v.photoReasons.filter((x) => x !== r) }); }} />{r.replace("_", " ").toLowerCase()}</label>
          ))}
        </div>
      </fieldset>
      <div className="grid gap-5 sm:grid-cols-3">
        {num("supplierRatePct", "Supplier alert", "Upheld supplier-fault claims per delivered order, last 30 days.", "%")}
        {num("productRatePct", "Product alert", "Claimed units per delivered unit, last 30 days.", "%")}
        {num("lotClaims", "Lot alert", "Claims naming the same lot, last 30 days (think recall).", "claims")}
        {num("driverClaims", "FIRINGI driver alert", "Upheld driver-fault claims per driver, last 30 days.", "claims")}
        {num("minDeliveries", "Minimum volume for rates", "Rates only alert from this many delivered orders / units.", "")}
      </div>
      {canEdit && (
        <div className="flex flex-wrap items-center gap-3">
          <Button disabled={pending} onClick={() => run(() => saveClaimSettingsAction(v as Parameters<typeof saveClaimSettingsAction>[0]), () => setSaved(true))} data-testid="cs-save">Save</Button>
          {saved && <span className="text-sm text-[var(--vivid-teal)]">Saved.</span>}
          <Err e={error} />
        </div>
      )}
    </div>
  );
}
