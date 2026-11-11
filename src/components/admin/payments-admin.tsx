"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Copy, Link2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import {
  cancelRequestAction, payBeforeShippingAction, paymentLinkAction, refundCreditAction, revokeMandateAction, simMultibancoPaidAction, testProviderAction,
} from "@/server/actions/payments";

function useRun() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const run = (fn: () => Promise<{ ok: boolean; error?: string; data?: unknown }>, done?: (data: unknown) => string | void) =>
    start(async () => { const r = await fn(); if (!r.ok) setMsg({ ok: false, text: r.error ?? "Error" }); else { const t = done?.(r.data); setMsg(t ? { ok: true, text: t } : null); router.refresh(); } });
  return { pending, msg, run };
}
const Msg = ({ m }: { m: { ok: boolean; text: string } | null }) => (m ? <span className={`text-sm ${m.ok ? "text-success" : "text-destructive"}`} role="status">{m.text}</span> : null);

export function TestProvider() {
  const { pending, msg, run } = useRun();
  return <span className="inline-flex items-center gap-2"><Msg m={msg} /><Button variant="outline" size="sm" disabled={pending} data-testid="test-provider" onClick={() => run(() => testProviderAction({}), (d) => { const x = d as { ok: boolean; detail: string }; return `${x.ok ? "Connected" : "Not connected"}: ${x.detail}`; })}>Test connection</Button></span>;
}

export function PaymentLinkForm({ customers, companyId, invoiceIds, compact }: { customers?: { id: string; name: string }[]; companyId?: string; invoiceIds?: string[]; compact?: boolean }) {
  const { pending, msg, run } = useRun();
  const [co, setCo] = useState(companyId ?? "");
  const [send, setSend] = useState(true);
  const [url, setUrl] = useState<string | null>(null);
  return (
    <div className="space-y-2" data-testid="payment-link-form">
      <div className="flex flex-wrap items-center gap-2">
        {customers && <Select className="h-9 min-w-0 flex-1 sm:max-w-xs" value={co} onChange={(e) => setCo(e.target.value)} aria-label="Customer"><option value="">Choose a customer…</option>{customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>}
        <label className="flex items-center gap-1.5 text-sm"><input type="checkbox" checked={send} onChange={(e) => setSend(e.target.checked)} /> send to the customer (e-mail / WhatsApp)</label>
        <Button size={compact ? "sm" : "default"} disabled={pending || !co} data-testid="create-link" onClick={() => run(() => paymentLinkAction({ companyId: co, invoiceIds, send }), (d) => { const x = d as { url: string; amount: string }; setUrl(x.url); return `Link for ${x.amount} €${send ? " sent" : ""}`; })}>
          {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Link2 className="size-4" aria-hidden />}{invoiceIds ? "Payment link" : "Create payment link"}
        </Button>
        <Msg m={msg} />
      </div>
      {url && <div className="flex items-center gap-2"><Input readOnly value={url} className="font-mono text-xs" data-testid="link-url" /><Button size="sm" variant="ghost" onClick={() => navigator.clipboard?.writeText(url)}><Copy className="size-4" aria-hidden />Copy</Button></div>}
    </div>
  );
}

export function RequestActions({ id, open, multibanco, simulated, link }: { id: string; open: boolean; multibanco: boolean; simulated: boolean; link: string | null }) {
  const { pending, msg, run } = useRun();
  return (
    <span className="inline-flex flex-wrap items-center justify-end gap-1">
      {link && <Button size="sm" variant="ghost" onClick={() => navigator.clipboard?.writeText(link)} title={link}><Copy className="size-3.5" aria-hidden />Link</Button>}
      {open && <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => cancelRequestAction({ id }))}>Cancel</Button>}
      {multibanco && simulated && <Button size="sm" variant="outline" disabled={pending} data-testid="sim-mb-paid" onClick={() => run(() => simMultibancoPaidAction({ id }), () => "Marked paid")}>Simulate payment</Button>}
      <Msg m={msg} />
    </span>
  );
}

export function RefundForm({ paymentId, max }: { paymentId: string; max: string }) {
  const { pending, msg, run } = useRun();
  const [amount, setAmount] = useState(max);
  const [reason, setReason] = useState("");
  return (
    <span className="inline-flex flex-wrap items-center justify-end gap-1">
      <Input className="h-8 w-24 text-right" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} aria-label="Refund amount" />
      <Input className="h-8 w-40" placeholder="Reason" value={reason} onChange={(e) => setReason(e.target.value)} aria-label="Refund reason" />
      <Button size="sm" variant="outline" disabled={pending || !reason.trim()} onClick={() => run(() => refundCreditAction({ paymentId, amount: Number(amount), reason }), (d) => ((d as { manual: boolean }).manual ? "Recorded — pay it back by bank transfer" : "Refunded"))}>Refund</Button>
      <Msg m={msg} />
    </span>
  );
}

export function PayFirstToggle({ companyId, on }: { companyId: string; on: boolean }) {
  const { pending, msg, run } = useRun();
  const [checked, setChecked] = useState(on);
  return (
    <span className="inline-flex items-center gap-2">
      <label className="flex items-center gap-1.5 text-sm" title="Orders wait for payment before the supplier sees them">
        <input type="checkbox" checked={checked} disabled={pending} data-testid={`pay-first-${companyId}`} onChange={(e) => {
          const next = e.target.checked;
          setChecked(next); // show it at once; undone if saving fails
          run(async () => { const r = await payBeforeShippingAction({ companyId, on: next }); if (!r.ok) setChecked(!next); return r; });
        }} /> pay first
      </label>
      <Msg m={msg} />
    </span>
  );
}

export function RevokeMandate({ id }: { id: string }) {
  const { pending, msg, run } = useRun();
  return <span className="inline-flex items-center gap-1"><Button size="sm" variant="ghost" className="text-destructive" disabled={pending} onClick={() => { if (confirm("Cancel this customer's direct debit?")) run(() => revokeMandateAction({ id })); }}>Revoke</Button><Msg m={msg} /></span>;
}
