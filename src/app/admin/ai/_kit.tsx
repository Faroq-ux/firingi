/** Shared bits for the AI Centre pages (server). */
import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import type { PermissionCode } from "@/server/rbac/permissions";
import { canAi } from "@/server/ai/insights";

/** AI Centre page: the AI right, plus `data` (any of) for what the page shows. */
export async function aiPage(data: PermissionCode[] = []) {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, "admin.ai.view");
  return { ctx, allowed: canAi(ctx, "STAFF", data) };
}

export function NoAccess({ what }: { what: string }) {
  return <p className="rounded-xl border border-dashed p-6 text-sm text-muted-foreground" data-testid="no-access">This page shows {what}; your role doesn&apos;t include that data.</p>;
}

export const eur = (n: number, digits = 0) => new Intl.NumberFormat("en", { style: "currency", currency: "EUR", maximumFractionDigits: digits }).format(n);
export const num = (n: number) => new Intl.NumberFormat("en", { maximumFractionDigits: 1 }).format(n);
export const pct = (n: number | null) => (n === null ? "—" : `${n > 0 ? "+" : ""}${Math.round(n * 100)}%`);

const TONE: Record<string, "destructive" | "warning" | "success" | "secondary" | "default"> = { OUT: "destructive", CRITICAL: "destructive", HIGH: "destructive", LOW: "warning", MEDIUM: "warning", OK: "success", NO_SALES: "secondary", MIN: "destructive", TARGET: "warning" };
export function Level({ value, children }: { value: string; children?: ReactNode }) {
  return <Badge variant={TONE[value] ?? "default"}>{children ?? value.replace("_", " ").toLowerCase()}</Badge>;
}

export function SuggestOnly() {
  return <p className="mb-4 text-xs text-muted-foreground">AI suggests; people decide. Nothing on this page changes orders, prices or stock by itself.</p>;
}
