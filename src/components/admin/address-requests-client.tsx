"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Msg, useRun } from "@/components/shared/run";
import { decideAddressRequestAction, saveAddressApprovalSettingsAction } from "@/server/actions/admin-review";

/** Approve (with the till invoice, or bypass without it) or refuse with a reason. */
export function AddressDecision({ id, hasProof, proofRequired }: { id: string; hasProof: boolean; proofRequired: boolean }) {
  const { pending, error, run } = useRun();
  const [note, setNote] = useState("");
  const [bypass, setBypass] = useState(false);
  const needsBypass = proofRequired && !hasProof;
  return (
    <div className="space-y-1.5" data-testid="address-decision">
      <Input className="h-8 text-xs" placeholder="Note to the company (required to refuse)" value={note} onChange={(e) => setNote(e.target.value)} data-testid="ad-note" />
      {needsBypass && <label className="flex items-center gap-1.5 text-xs"><input type="checkbox" checked={bypass} onChange={(e) => setBypass(e.target.checked)} data-testid="ad-bypass" /> Approve without the till invoice (bypass)</label>}
      <div className="flex flex-wrap gap-1.5">
        <Button size="sm" disabled={pending || (needsBypass && !bypass)} onClick={() => run(() => decideAddressRequestAction({ id, approve: true, note: note || null, bypassProof: bypass }))} data-testid="ad-approve">Approve</Button>
        <Button size="sm" variant="outline" disabled={pending || !note.trim()} onClick={() => run(() => decideAddressRequestAction({ id, approve: false, note }))} data-testid="ad-reject">Refuse</Button>
      </div>
      <Msg error={error} />
    </div>
  );
}

const KINDS = [["HEAD_OFFICE", "Head office"], ["BILLING", "Billing"], ["WAREHOUSE", "Warehouse / distribution centre"], ["PICKUP", "Pickup / cash & carry"], ["DELIVERY", "Delivery addresses / shops"]] as const;

export function AddressApprovalSettingsForm({ initial }: { initial: { enabled: boolean; proofRequired: boolean; kinds: Record<string, boolean> } }) {
  const { pending, error, done, run } = useRun();
  const [x, setX] = useState(initial);
  return (
    <form className="space-y-2 text-sm" data-testid="address-approval-settings" onSubmit={(e) => { e.preventDefault(); run(() => saveAddressApprovalSettingsAction({ enabled: x.enabled, proofRequired: x.proofRequired, kinds: { HEAD_OFFICE: !!x.kinds.HEAD_OFFICE, BILLING: !!x.kinds.BILLING, WAREHOUSE: !!x.kinds.WAREHOUSE, PICKUP: !!x.kinds.PICKUP, DELIVERY: !!x.kinds.DELIVERY } }), undefined, "Saved"); }}>
      <label className="flex items-center gap-2"><input type="checkbox" checked={x.enabled} onChange={(e) => setX({ ...x, enabled: e.target.checked })} data-testid="aas-enabled" /> New addresses need FIRINGI&apos;s approval</label>
      <label className="flex items-center gap-2"><input type="checkbox" checked={x.proofRequired} onChange={(e) => setX({ ...x, proofRequired: e.target.checked })} data-testid="aas-proof" /> Ask for a recent till invoice from that address (admins can still bypass)</label>
      <fieldset className="flex flex-wrap gap-x-4 gap-y-1 pl-6">{KINDS.map(([k, l]) => <label key={k} className="flex items-center gap-1.5"><input type="checkbox" checked={!!x.kinds[k]} disabled={!x.enabled} onChange={(e) => setX({ ...x, kinds: { ...x.kinds, [k]: e.target.checked } })} /> {l}</label>)}</fieldset>
      <div className="flex items-center gap-3"><Button type="submit" size="sm" disabled={pending} data-testid="aas-save">Save</Button><Msg error={error} done={done} /></div>
    </form>
  );
}
