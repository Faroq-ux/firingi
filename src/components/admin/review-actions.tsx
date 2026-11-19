"use client";
/** Admin decision controls. Every button calls a server action that re-checks permissions. */
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import {
  correctRegistrationAction, manualVatAction, reviewDocumentAction, reviewDriverAction, reviewRestrictionAction, runViesAction, setCommissionAction, setCompanyStatusAction,
} from "@/server/actions/admin-review";

type Result = { ok: boolean; error?: string };
function useRun() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const run = (fn: () => Promise<Result>, after?: () => void) =>
    start(async () => {
      setError(null);
      const r = await fn();
      if (r.ok) { after?.(); router.refresh(); } else setError(r.error ?? "Error");
    });
  return { pending, error, run };
}

const LABEL: Record<string, string> = {
  UNDER_REVIEW: "Start review", APPROVED: "Approve", REJECTED: "Reject", PENDING: "Request changes / reopen", SUSPENDED: "Suspend",
};
const NEEDS_REASON = ["REJECTED", "SUSPENDED", "PENDING"];

export function CompanyStatusActions({ companyId, targets, approveBlocked }: { companyId: string; targets: string[]; approveBlocked: boolean }) {
  const { pending, error, run } = useRun();
  const [reason, setReason] = useState("");
  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label htmlFor="reason">Reason / message to the applicant</Label>
        <Input id="reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Required to reject, suspend or request changes" />
      </div>
      <div className="flex flex-wrap gap-2">
        {targets.map((to) => (
          <Button
            key={to}
            variant={to === "APPROVED" ? "default" : to === "REJECTED" || to === "SUSPENDED" ? "destructive" : "outline"}
            disabled={pending || (to === "APPROVED" && approveBlocked) || (NEEDS_REASON.includes(to) && !reason.trim())}
            onClick={() => run(() => setCompanyStatusAction({ companyId, to: to as "APPROVED", reason: reason || null }), () => setReason(""))}
          >
            {to === "APPROVED" && targets.includes("SUSPENDED") ? "Reactivate" : LABEL[to]}
          </Button>
        ))}
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}

export function DocumentReview({ documentId, status }: { documentId: string; status: string }) {
  const { pending, error, run } = useRun();
  const [rejecting, setRejecting] = useState(false);
  const [note, setNote] = useState("");
  return (
    <div className="flex flex-wrap items-center justify-end gap-1.5">
      {status !== "APPROVED" && !rejecting && (
        <Button size="sm" disabled={pending} onClick={() => run(() => reviewDocumentAction({ documentId, decision: "APPROVED" }))}>Approve</Button>
      )}
      {status !== "REJECTED" && !rejecting && <Button size="sm" variant="outline" disabled={pending} onClick={() => setRejecting(true)}>Reject</Button>}
      {rejecting && (
        <>
          <Input className="h-8 w-56" placeholder="Reason (shown to applicant)" value={note} onChange={(e) => setNote(e.target.value)} />
          <Button size="sm" variant="destructive" disabled={pending || !note.trim()} onClick={() => run(() => reviewDocumentAction({ documentId, decision: "REJECTED", note }), () => setRejecting(false))}>Confirm</Button>
          <Button size="sm" variant="ghost" onClick={() => setRejecting(false)}>Cancel</Button>
        </>
      )}
      {error && <span className="w-full text-right text-xs text-destructive">{error}</span>}
    </div>
  );
}

export function ViesPanel({ companyId, canManual }: { companyId: string; canManual: boolean }) {
  const { pending, error, run } = useRun();
  const [note, setNote] = useState("");
  const [manual, setManual] = useState(false);
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => runViesAction({ companyId }))}>{pending ? "Checking…" : "Check in VIES"}</Button>
        {canManual && !manual && <Button size="sm" variant="ghost" onClick={() => setManual(true)}>Record manual verification</Button>}
      </div>
      {manual && (
        <div className="flex flex-wrap gap-2">
          <Input className="h-8 flex-1" placeholder="How was it verified? (e.g. VIES website screenshot ref …)" value={note} onChange={(e) => setNote(e.target.value)} />
          <Button size="sm" disabled={pending || note.trim().length < 10} onClick={() => run(() => manualVatAction({ companyId, note }), () => setManual(false))}>Save</Button>
        </div>
      )}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

export function CommissionForm({ companyId, current }: { companyId: string; current: number | null }) {
  const { pending, error, run } = useRun();
  const [rate, setRate] = useState(current?.toString() ?? "");
  const [note, setNote] = useState("");
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-end gap-2">
        <div className="space-y-1"><Label htmlFor="rate">Rate (%)</Label><Input id="rate" className="w-28" type="number" min={0} max={100} step="0.01" value={rate} onChange={(e) => setRate(e.target.value)} /></div>
        <div className="flex-1 space-y-1"><Label htmlFor="cnote">Note</Label><Input id="cnote" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. contract 2026" /></div>
        <Button disabled={pending || rate === ""} onClick={() => run(() => setCommissionAction({ companyId, rate: Number(rate), note: note || null }), () => setNote(""))}>Set commission</Button>
      </div>
      <p className="text-xs text-muted-foreground">A new rate applies to orders placed from now on; history is kept.</p>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

export function RestrictionReview({ id, status }: { id: string; status: string }) {
  const { pending, error, run } = useRun();
  const [validUntil, setValidUntil] = useState("");
  const [note, setNote] = useState("");
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-end gap-2">
        {status === "PENDING" && <div className="space-y-1"><Label>Valid until</Label><Input type="date" className="h-8 w-40" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} /></div>}
        <div className="flex-1 space-y-1"><Label>Note</Label><Input className="h-8" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Required to reject / revoke" /></div>
      </div>
      <div className="flex gap-2">
        {status === "PENDING" && (
          <>
            <Button size="sm" disabled={pending || !validUntil} onClick={() => run(() => reviewRestrictionAction({ id, decision: "APPROVED", validUntil, note: note || null }))}>Approve</Button>
            <Button size="sm" variant="destructive" disabled={pending || !note.trim()} onClick={() => run(() => reviewRestrictionAction({ id, decision: "REJECTED", note }))}>Reject</Button>
          </>
        )}
        {status === "APPROVED" && <Button size="sm" variant="destructive" disabled={pending || !note.trim()} onClick={() => run(() => reviewRestrictionAction({ id, decision: "REVOKED", note }))}>Revoke</Button>}
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

export function DriverReview({ driverId, status }: { driverId: string; status: string }) {
  const { pending, error, run } = useRun();
  const [reason, setReason] = useState("");
  const targets = ({ PENDING: ["APPROVED", "REJECTED"], UNDER_REVIEW: ["APPROVED", "REJECTED"], APPROVED: ["SUSPENDED"], SUSPENDED: ["APPROVED"] } as Record<string, string[]>)[status] ?? [];
  if (!targets.length) return null;
  return (
    <div className="flex flex-wrap items-center justify-end gap-1.5">
      <Input className="h-8 w-48" placeholder="Reason" value={reason} onChange={(e) => setReason(e.target.value)} />
      {targets.map((to) => (
        <Button key={to} size="sm" variant={to === "APPROVED" ? "default" : "destructive"} disabled={pending || (to !== "APPROVED" && !reason.trim())}
          onClick={() => run(() => reviewDriverAction({ driverId, to: to as "APPROVED", reason: reason || null }))}>
          {to === "APPROVED" ? (status === "SUSPENDED" ? "Reactivate" : "Approve") : to === "REJECTED" ? "Reject" : "Suspend"}
        </Button>
      ))}
      {error && <span className="w-full text-right text-xs text-destructive">{error}</span>}
    </div>
  );
}

/** FIRINGI corrects a company's registration details (users can't): legal name, NIF, VAT number, legal form — with a reason. */
export function RegistrationCorrection({ company, activityName }: { company: { id: string; legalName: string; taxId: string; vatNumber: string | null; legalForm: "COMPANY" | "SOLE_TRADER"; activityCode: string | null; activityCodes: string[] }; activityName: string }) {
  const { pending, error, run } = useRun();
  const [open, setOpen] = useState(false);
  const [x, setX] = useState({ legalName: company.legalName, taxId: company.taxId, vatNumber: company.vatNumber ?? "", legalForm: company.legalForm, activityCode: company.activityCode ?? "", activityCodes: company.activityCodes.join(", "), reason: "" });
  if (!open) return <Button size="sm" variant="outline" onClick={() => setOpen(true)} data-testid="reg-correct-open">Correct registration details</Button>;
  return (
    <div className="space-y-2" data-testid="reg-correct">
      <div className="grid gap-2 sm:grid-cols-2">
        <div><Label htmlFor="rc-name">Legal name</Label><Input id="rc-name" value={x.legalName} onChange={(e) => setX({ ...x, legalName: e.target.value })} data-testid="rc-name" /></div>
        <div><Label htmlFor="rc-form">Legal form</Label><select id="rc-form" className="h-9 w-full rounded-md border bg-background px-2 text-sm" value={x.legalForm} onChange={(e) => setX({ ...x, legalForm: e.target.value as "COMPANY" | "SOLE_TRADER" })}><option value="COMPANY">Company</option><option value="SOLE_TRADER">Sole trader</option></select></div>
        <div><Label htmlFor="rc-nif">NIF / tax id</Label><Input id="rc-nif" value={x.taxId} onChange={(e) => setX({ ...x, taxId: e.target.value })} data-testid="rc-nif" /></div>
        <div><Label htmlFor="rc-vat">VAT number</Label><Input id="rc-vat" value={x.vatNumber} onChange={(e) => setX({ ...x, vatNumber: e.target.value })} data-testid="rc-vat" /></div>
        <div><Label htmlFor="rc-cae">Main activity code ({activityName})</Label><Input id="rc-cae" value={x.activityCode} onChange={(e) => setX({ ...x, activityCode: e.target.value })} data-testid="rc-cae" /></div>
        <div className="sm:col-span-2"><Label htmlFor="rc-caes">Secondary codes (comma-separated)</Label><Input id="rc-caes" value={x.activityCodes} onChange={(e) => setX({ ...x, activityCodes: e.target.value })} data-testid="rc-caes" /></div>
      </div>
      <Input placeholder="Reason (e.g. typo in the NIF at sign-up, checked against the certificate)" value={x.reason} onChange={(e) => setX({ ...x, reason: e.target.value })} data-testid="rc-reason" />
      <div className="flex flex-wrap gap-2">
        <Button size="sm" disabled={pending || x.reason.trim().length < 10} onClick={() => run(() => correctRegistrationAction({ companyId: company.id, ...x }), () => setOpen(false))} data-testid="rc-save">Save correction</Button>
        <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
      </div>
      <p className="text-xs text-muted-foreground">One company per NIF and per VAT number. The change and its reason go into the audit log.</p>
      {error && <p className="text-xs text-destructive" role="alert">{error}</p>}
    </div>
  );
}
