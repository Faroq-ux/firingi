"use client";
/** The simulated provider's hosted pages (development / demos — not shown when a real provider is used). */
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { simCheckoutAction, simSignMandateAction } from "@/server/actions/payments";

export function SimCheckout({ providerRef, amount }: { providerRef: string; amount: string }) {
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const go = (outcome: "succeeded" | "failed") => start(async () => {
    const r = await simCheckoutAction({ ref: providerRef, outcome });
    if (!r.ok) return setErr(r.error);
    window.location.assign(r.data.back);
  });
  return (
    <div className="space-y-4">
      <div className="rounded-xl border bg-muted/30 p-4 text-center"><div className="text-xs uppercase text-muted-foreground">Amount</div><div className="text-3xl font-bold tabular-nums">{amount} €</div></div>
      <div className="space-y-2">
        <Input readOnly value="4242 4242 4242 4242" aria-label="Card number" />
        <div className="grid grid-cols-2 gap-2"><Input readOnly value="12 / 30" aria-label="Expiry" /><Input readOnly value="123" aria-label="CVC" /></div>
      </div>
      {err && <p className="text-sm text-destructive" role="alert">{err}</p>}
      <div className="grid grid-cols-2 gap-2">
        <Button variant="outline" disabled={pending} onClick={() => go("failed")} data-testid="sim-decline">Decline</Button>
        <Button disabled={pending} onClick={() => go("succeeded")} data-testid="sim-approve">Approve payment</Button>
      </div>
    </div>
  );
}

export function SimMandate({ setupRef, holder }: { setupRef: string; holder: string }) {
  const [pending, start] = useTransition();
  const [name, setName] = useState(holder);
  const [iban, setIban] = useState("PT50 0002 0123 1234 5678 9015 4");
  const [err, setErr] = useState<string | null>(null);
  return (
    <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); start(async () => { const r = await simSignMandateAction({ setupRef, holder: name, iban }); if (!r.ok) return setErr(r.error); window.location.assign(r.data.back); }); }}>
      <label className="block space-y-1 text-sm"><span>Account holder</span><Input value={name} onChange={(e) => setName(e.target.value)} data-testid="sim-holder" /></label>
      <label className="block space-y-1 text-sm"><span>IBAN</span><Input value={iban} onChange={(e) => setIban(e.target.value)} data-testid="sim-iban" /></label>
      <p className="text-xs text-muted-foreground">IBANs ending in 0000 simulate a debit returned for insufficient funds.</p>
      {err && <p className="text-sm text-destructive" role="alert">{err}</p>}
      <Button type="submit" className="w-full" disabled={pending} data-testid="sim-sign">Sign mandate</Button>
    </form>
  );
}
