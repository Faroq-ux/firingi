/** Shared bits for the Phase 67 pages (server): agent icons, status badges, dates. */
import { Bot, Boxes, Megaphone, Route, ShieldCheck, Sparkles, TrendingUp, Truck, Users, Wallet, type LucideIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { RUN_STATUS_LABEL, RUN_TONE } from "@/lib/ai-ops";

const ICONS: Record<string, LucideIcon> = { Bot, TrendingUp, Boxes, Wallet, Route, Truck, Users, ShieldCheck, Sparkles, Megaphone };
export function AgentIcon({ icon, tone, size = "size-10" }: { icon: string; tone: string; size?: string }) {
  const I = ICONS[icon] ?? Bot;
  return <span className={`grid ${size} shrink-0 place-items-center rounded-xl ${tone} stat-card border`} aria-hidden><I className="size-5" /></span>;
}
export function Status({ value }: { value: string }) {
  return <Badge variant={RUN_TONE[value] ?? "default"} data-status={value}>{RUN_STATUS_LABEL[value] ?? value.toLowerCase()}</Badge>;
}
export const when = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 16).replace("T", " ") : "—");
export const secs = (ms: number | null | undefined) => (ms ? `${(ms / 1000).toFixed(1)} s` : "—");
export const k = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : String(n));
