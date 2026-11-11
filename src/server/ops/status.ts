/**
 * Public status page data: the health checks folded into a few customer-facing components,
 * with no internal detail. Cached for 30 seconds so the public page can't load the database.
 */
import "server-only";
import { prisma } from "@/server/db";
import { healthReport, type CheckState } from "./health";

export const PUBLIC_COMPONENTS = ["web", "ordering", "files", "notifications", "invoicing", "payments"] as const;
export type PublicComponent = (typeof PUBLIC_COMPONENTS)[number];
/** Which internal checks make up each public component (others — disk, settings, errors — stay internal). */
const MAP: Record<PublicComponent, string[]> = {
  web: [],
  ordering: ["db", "migrations", "job:allocation"],
  files: ["storage"],
  notifications: ["messages", "job:notifications"],
  invoicing: ["fiscal", "job:invoicing"],
  payments: ["payments", "job:payments"],
};
export const componentOf = (checkKey: string) => PUBLIC_COMPONENTS.find((c) => MAP[c].includes(checkKey)) ?? null;
const RANK: Record<CheckState, number> = { ok: 0, warning: 1, critical: 2 };

let cache: { at: number; value: Awaited<ReturnType<typeof compute>> } | null = null;

async function compute() {
  const r = await healthReport();
  const components = PUBLIC_COMPONENTS.map((key) => {
    const states = r.checks.filter((c) => MAP[key].includes(c.key)).map((c) => c.state);
    const state = states.reduce<CheckState>((w, s) => (RANK[s] > RANK[w] ? s : w), "ok");
    return { key, state };
  });
  const overall = components.reduce<CheckState>((w, c) => (RANK[c.state] > RANK[w] ? c.state : w), "ok");
  const since = new Date(Date.now() - 7 * 86400_000);
  const alerts = await prisma.opsAlert.findMany({ where: { OR: [{ resolvedAt: null }, { resolvedAt: { gt: since } }] }, orderBy: { openedAt: "desc" }, take: 50 });
  const incidents = alerts
    .map((a) => ({ id: a.id, component: componentOf(a.key), severity: a.severity, openedAt: a.openedAt, resolvedAt: a.resolvedAt }))
    .filter((i): i is typeof i & { component: PublicComponent } => i.component !== null)
    .slice(0, 20);
  return { overall, components, incidents, at: r.at };
}

export async function publicStatus() {
  if (cache && Date.now() - cache.at < 30_000) return cache.value;
  const value = await compute();
  cache = { at: Date.now(), value };
  return value;
}
