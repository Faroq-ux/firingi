/** Badge tones for Phase 26 statuses (shared by the buyer, supplier and FIRINGI pages). */
import type { Tone } from "@/components/ui/data-table";

export const QUOTE_TONE: Record<string, Tone> = { REQUESTED: "warning", QUOTED: "default", ACCEPTED: "success", DECLINED: "destructive", REJECTED: "outline", EXPIRED: "outline", CANCELLED: "outline" };
export const RECURRING_TONE: Record<string, Tone> = { ACTIVE: "success", PAUSED: "secondary", PENDING_APPROVAL: "warning", ENDED: "outline" };
export const APPROVAL_TONE: Record<string, Tone> = { PENDING: "warning", APPROVED: "success", REJECTED: "destructive", CANCELLED: "outline" };
export const badgeVariant = (t: Tone): "default" | "secondary" | "destructive" | "outline" | "success" | "warning" => t as never;
