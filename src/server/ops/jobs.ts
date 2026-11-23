/**
 * Scheduled jobs: what runs, how often, and a record of every run (JobRun) so the System
 * Health page and the alerts can see when something stopped or keeps failing.
 * Every cron route authenticates with CRON_SECRET and runs its work through runJob().
 */
import "server-only";
import { timingSafeEqual } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/server/db";

export type JobDef = { key: string; label: string; every: string; staleAfterMin: number; critical: boolean; path: string | null };
/** The schedule the production setup runs (docker/scheduler); stale = no successful run for this long. */
export const JOBS: JobDef[] = [
  { key: "notifications", label: "Messages & campaigns", every: "every 2 minutes", staleAfterMin: 20, critical: true, path: "/api/cron/notifications" },
  { key: "invoicing", label: "Certified invoicing & payout reminders", every: "every 5 minutes", staleAfterMin: 30, critical: true, path: "/api/cron/invoicing" },
  { key: "allocation", label: "Supplier allocation (unconfirmed orders)", every: "every 10 minutes", staleAfterMin: 45, critical: true, path: "/api/cron/allocation" },
  { key: "payments", label: "Online payments, direct debits & reminders", every: "every 5 minutes", staleAfterMin: 30, critical: true, path: "/api/cron/payments" },
  { key: "integrations", label: "Supplier feeds & webhooks", every: "every 5 minutes", staleAfterMin: 30, critical: false, path: "/api/cron/integrations" },
  { key: "ops", label: "Health checks & alerts", every: "every 5 minutes", staleAfterMin: 20, critical: false, path: "/api/cron/ops" },
  { key: "buying", label: "Recurring orders & quotes", every: "every 15 minutes", staleAfterMin: 60, critical: true, path: "/api/cron/buying" },
  { key: "inventory", label: "Expiry alerts (inventory)", every: "daily", staleAfterMin: 26 * 60, critical: false, path: "/api/cron/inventory" },
  { key: "compliance", label: "Supplier certificates (expiry, reminders, pauses)", every: "daily", staleAfterMin: 26 * 60, critical: false, path: "/api/cron/compliance" },
  { key: "planning", label: "Demand forecasts & restock suggestions", every: "daily", staleAfterMin: 26 * 60, critical: false, path: "/api/cron/planning" },
  { key: "claims", label: "Quality claims (SLA, charge-backs, quality alerts)", every: "daily", staleAfterMin: 26 * 60, critical: false, path: "/api/cron/claims" },
  { key: "plans", label: "Supplier plans (trial reminders and endings, monthly plan invoices, plan changes, settling against payouts)", every: "daily", staleAfterMin: 26 * 60, critical: false, path: "/api/cron/plans" },
  { key: "coldchain", label: "Cold chain (equipment checks due, loggers out of range)", every: "daily", staleAfterMin: 26 * 60, critical: false, path: "/api/cron/coldchain" },
  { key: "excise", label: "Licensed goods (licence expiry reminders, expired licences)", every: "daily", staleAfterMin: 26 * 60, critical: false, path: "/api/cron/excise" },
  { key: "whatsapp", label: "WhatsApp ordering (messages left over, expired proposals, reorder reminders)", every: "every 5 minutes", staleAfterMin: 60, critical: false, path: "/api/cron/whatsapp" },
  { key: "substitutions", label: "Substitutions (unanswered replacements)", every: "every 5 minutes", staleAfterMin: 60, critical: false, path: "/api/cron/substitutions" },
  { key: "salesreps", label: "Sales reps (unconfirmed orders, missed visits)", every: "hourly", staleAfterMin: 180, critical: false, path: "/api/cron/salesreps" },
  { key: "assortments", label: "Customer assortments (weekly must-stock reminders)", every: "hourly", staleAfterMin: 180, critical: false, path: "/api/cron/assortments" },
  { key: "ai-reports", label: "AI Centre weekly executive report (Monday morning email)", every: "hourly", staleAfterMin: 180, critical: false, path: "/api/cron/ai-reports" },
  { key: "consignment", label: "Consignment stock (auto-confirm counts, count reminders, expiry alerts)", every: "hourly", staleAfterMin: 180, critical: false, path: "/api/cron/consignment" },
  { key: "vansales", label: "Van sales (cash netted from payouts, vans still out)", every: "hourly", staleAfterMin: 180, critical: false, path: "/api/cron/vansales" },
  { key: "trade", label: "EU trade reporting (EC Sales List and Intrastat returns rebuilt, filing reminders, threshold watch)", every: "daily", staleAfterMin: 26 * 60, critical: false, path: "/api/cron/trade" },
  { key: "fx", label: "Exchange rates (ECB daily rates, rate alerts)", every: "daily", staleAfterMin: 26 * 60, critical: false, path: "/api/cron/fx" },
  { key: "pos-daily", label: "Till sales into each company's Accounting (daily cash / card / other by VAT rate, last 7 days rebuilt)", every: "daily", staleAfterMin: 26 * 60, critical: false, path: "/api/cron/pos-daily" },
  { key: "pos", label: "Till receipts (send waiting receipts to the businesses' certified providers, with retries)", every: "every 5 minutes", staleAfterMin: 60, critical: false, path: "/api/cron/pos" },
  { key: "einvoice", label: "E-invoicing (send queued e-invoices with retries, follow statuses, receive supplier e-invoices)", every: "every 10 minutes", staleAfterMin: 60, critical: false, path: "/api/cron/einvoice" },
  { key: "food", label: "Food information (diet certificate reminders, required-to-sell check)", every: "daily", staleAfterMin: 26 * 60, critical: false, path: "/api/cron/food" },
  { key: "returnables", label: "Returnables (empties held too long: reminders, or the deposit kept)", every: "daily", staleAfterMin: 26 * 60, critical: false, path: "/api/cron/returnables" },
  { key: "deals", label: "Clearance deals (ending deals, expiring offers, alerts for deals that start, daily digest)", every: "hourly", staleAfterMin: 3 * 60, critical: false, path: "/api/cron/deals" },
  { key: "groups", label: "Buying groups (place the members' orders of group orders that have closed)", every: "every 15 minutes", staleAfterMin: 90, critical: false, path: "/api/cron/groups" },
  { key: "paylater", label: "Pay later (partner pays invoiced plans, own-credit instalments: paid, reminders, overdue)", every: "every 15 minutes", staleAfterMin: 90, critical: true, path: "/api/cron/paylater" },
  { key: "tenders", label: "Open tenders (close bidding at the deadline, expire unawarded tenders)", every: "every 15 minutes", staleAfterMin: 90, critical: false, path: "/api/cron/tenders" },
  { key: "kitchen", label: "Menu costing & waste (ingredient costs, price-rise and waste alerts, use-first reminders)", every: "daily", staleAfterMin: 1560, critical: false, path: "/api/cron/kitchen" },
  { key: "rewards", label: "Rewards shop (voucher used / expired, supplier products delivered / expired, points back, reminders, low stock)", every: "daily", staleAfterMin: 1560, critical: false, path: "/api/cron/rewards" },
  { key: "reviews", label: "Product reviews (\"How was …?\" reminders after delivery)", every: "daily", staleAfterMin: 1560, critical: false, path: "/api/cron/reviews" },
  { key: "staff", label: "Staff & time (shift reminders, forgotten clock-outs, no-shows, old records removed)", every: "every 15 minutes", staleAfterMin: 90, critical: false, path: "/api/cron/staff" },
  { key: "rebates", label: "Rebates & bonuses (settle ended periods with credit notes / free goods, end finished deals, reminders)", every: "daily", staleAfterMin: 26 * 60, critical: false, path: "/api/cron/rebates" },
  { key: "bank", label: "Bank reconciliation (bank feeds, matching new lines, consents ending)", every: "daily", staleAfterMin: 26 * 60, critical: false, path: "/api/cron/bank" },
  { key: "ads", label: "Advertising (booked days, budgets, low balances, monthly ad invoices, settling against payouts)", every: "hourly", staleAfterMin: 3 * 60, critical: false, path: "/api/cron/ads" },
  { key: "loyalty", label: "Loyalty & rewards (points for delivered orders, expiry, reminders, tiers)", every: "hourly", staleAfterMin: 3 * 60, critical: false, path: "/api/cron/loyalty" },
  { key: "pricing", label: "Price changes due & price alerts", every: "hourly", staleAfterMin: 180, critical: false, path: "/api/cron/pricing" },
  { key: "ai", label: "AI suggestions", every: "hourly", staleAfterMin: 180, critical: false, path: "/api/cron/ai" },
  { key: "automation", label: "AI Centre automations, approvals and scheduled agents", every: "every 5 minutes", staleAfterMin: 30, critical: false, path: "/api/cron/automation" },
  { key: "services", label: "Services & used oil (plan visits, reminders, missed visits, containers full, oil changes, licences, monthly commission invoices)", every: "hourly", staleAfterMin: 180, critical: false, path: "/api/cron/services" },
  { key: "backup", label: "Database backup", every: "nightly", staleAfterMin: 26 * 60, critical: true, path: null },
  { key: "restore-test", label: "Backup restore test", every: "monthly", staleAfterMin: 35 * 24 * 60, critical: false, path: null },
];

/** CRON_SECRET bearer check (constant time). Returns a Response to send back when it fails. */
export function cronGuard(req: Request): Response | null {
  const secret = process.env.CRON_SECRET;
  if (!secret) return new Response("CRON_SECRET is not set", { status: 503 });
  const got = Buffer.from(req.headers.get("authorization") ?? "");
  const want = Buffer.from(`Bearer ${secret}`);
  if (got.length !== want.length || !timingSafeEqual(got, want)) return new Response("Unauthorized", { status: 401 });
  return null;
}

/** Run a job and record it; the result (or the error) is stored with the run. */
export async function runJob<T>(job: string, fn: () => Promise<T>): Promise<T> {
  const run = await prisma.jobRun.create({ data: { job } });
  const t0 = Date.now();
  try {
    const result = await fn();
    await prisma.jobRun.update({ where: { id: run.id }, data: { finishedAt: new Date(), ok: true, durationMs: Date.now() - t0, summary: (result ?? null) as Prisma.InputJsonValue } });
    return result;
  } catch (e) {
    await prisma.jobRun.update({ where: { id: run.id }, data: { finishedAt: new Date(), ok: false, durationMs: Date.now() - t0, error: (e instanceof Error ? `${e.message}\n${e.stack ?? ""}` : String(e)).slice(0, 4000) } }).catch(() => {});
    throw e;
  }
}

/** A cron route: guard + runJob + JSON answer (500 with the message when the job fails). */
export function cronRoute(job: string, fn: () => Promise<unknown>) {
  const handler = async (req: Request) => {
    const denied = cronGuard(req);
    if (denied) return denied;
    try { return Response.json(await runJob(job, fn)); } catch (e) { return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 }); }
  };
  return { GET: handler, POST: handler };
}

/** Jobs running outside the app (backup, restore test) report here with the CRON_SECRET. */
export async function recordExternalRun(input: { job: string; ok: boolean; durationMs?: number; summary?: unknown; error?: string | null }) {
  if (!JOBS.some((j) => j.key === input.job && !j.path)) throw new Error(`Unknown external job ${input.job}`);
  const now = new Date();
  return prisma.jobRun.create({
    data: {
      job: input.job, ok: input.ok, startedAt: new Date(now.getTime() - (input.durationMs ?? 0)), finishedAt: now, durationMs: input.durationMs ?? null,
      summary: (input.summary ?? undefined) as Prisma.InputJsonValue | undefined, error: input.error?.slice(0, 4000) ?? null,
    },
  });
}

/** Last run, last success and recent failures per job. */
export async function jobStatus(now = new Date()) {
  return Promise.all(JOBS.map(async (j) => {
    const [last, lastOk, recent] = await Promise.all([
      prisma.jobRun.findFirst({ where: { job: j.key, finishedAt: { not: null } }, orderBy: { startedAt: "desc" } }),
      prisma.jobRun.findFirst({ where: { job: j.key, ok: true }, orderBy: { startedAt: "desc" } }),
      prisma.jobRun.findMany({ where: { job: j.key, finishedAt: { not: null } }, orderBy: { startedAt: "desc" }, take: 3, select: { ok: true } }),
    ]);
    const ageMin = lastOk ? Math.round((now.getTime() - lastOk.startedAt.getTime()) / 60_000) : null;
    const failingStreak = recent.length === 3 && recent.every((r) => r.ok === false);
    return {
      ...j, last, lastOk, ageMin, failingStreak,
      state: !last ? ("never" as const) : failingStreak ? ("failing" as const) : ageMin === null || ageMin > j.staleAfterMin ? ("stale" as const) : last.ok === false ? ("last-failed" as const) : ("ok" as const),
    };
  }));
}

/** Keep 90 days of job runs and error events. */
export async function pruneOpsHistory(days = 90) {
  const old = new Date(Date.now() - days * 86400_000);
  const [jobs, errors] = await Promise.all([prisma.jobRun.deleteMany({ where: { startedAt: { lt: old } } }), prisma.errorEvent.deleteMany({ where: { at: { lt: old } } })]);
  return { jobs: jobs.count, errors: errors.count };
}
