/** E-invoice status badge (server or client). Labels come from the caller (admin: English; portals: translated). */
import { Badge } from "@/components/ui/badge";
import { STATUS_TONE } from "@/lib/einvoice";

export const STATUS_EN: Record<string, string> = {
  INVALID: "Stopped (check)", QUEUED: "Queued", SENT: "Sent", DELIVERED: "Delivered", ACCEPTED: "Accepted", REJECTED: "Rejected", FAILED: "Failed", RECEIVED: "Received", MATCHED: "Matched",
};

export function EStatus({ status, label }: { status: string; label?: string }) {
  return <Badge variant={STATUS_TONE[status] ?? "default"} className="shrink-0 whitespace-nowrap" data-testid="einv-status">{label ?? STATUS_EN[status] ?? status}</Badge>;
}
