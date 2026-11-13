/**
 * Four-eyes control. Sensitive FIRINGI actions above a threshold don't run straight away: they
 * become an approval request, and a second person — never the one who asked, and holding the
 * same right — approves (the action then runs exactly as requested) or rejects it.
 *
 * A guarded service calls `fourEyes(ctx, …)` when its threshold is crossed. Outside an approval
 * that records the request and throws APPROVAL_REQUIRED (the UI shows "sent for approval");
 * while the approver applies it (`runApproved`), it lets the action through.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/server/db";
import type { Ctx } from "@/server/context";
import { AppError } from "@/server/errors";
import { notify } from "@/server/notify/dispatch";
import { writeAudit } from "@/server/services/audit";
import type { PermissionCode } from "@/server/rbac/permissions";

export type ApprovalKind = "CREDIT_NOTE" | "CLAIM" | "CUSTOMER_TERMS" | "COMMISSION" | "OFFER" | "BANK_DETAILS" | "STAFF_ROLE" | "PAYMENT";

/** What an approver must be allowed to do (the same right the action needs). */
export const APPROVAL_PERMISSION: Record<ApprovalKind, PermissionCode[]> = {
  CREDIT_NOTE: ["admin.invoices.issue"],
  CLAIM: ["admin.claims.manage"],
  CUSTOMER_TERMS: ["admin.customers.manage"],
  COMMISSION: ["admin.vendors.commission"],
  OFFER: ["admin.marketing.manage", "admin.pricing.manage"],
  BANK_DETAILS: ["admin.settings.manage"],
  STAFF_ROLE: ["admin.users.manage"],
  PAYMENT: ["admin.finance.manage"],
};
export const APPROVAL_LABEL: Record<ApprovalKind, string> = {
  CREDIT_NOTE: "Credit note", CLAIM: "Quality claim credit", CUSTOMER_TERMS: "Credit limit / payment terms", COMMISSION: "Commission change", OFFER: "Big offer / coupon",
  BANK_DETAILS: "Bank details", STAFF_ROLE: "Powerful staff role", PAYMENT: "Payment",
};

export type ApprovalSettings = {
  enabled: boolean;
  creditNoteAbove: number; // € (gross)
  creditLimitAbove: number; // €
  paymentDaysAbove: number;
  commissionChanges: boolean;
  offerPercentAbove: number; // % off, FIRINGI-paid
  offerAmountAbove: number; // € off the order or budget
  bankDetails: boolean;
  staffRoles: boolean;
  paymentAbove: number; // €
};
export const DEFAULT_APPROVALS: ApprovalSettings = {
  enabled: true, creditNoteAbove: 500, creditLimitAbove: 10000, paymentDaysAbove: 60, commissionChanges: true,
  offerPercentAbove: 20, offerAmountAbove: 1000, bankDetails: true, staffRoles: true, paymentAbove: 10000,
};
const KEY = "approvals.rules";

export async function approvalSettings(): Promise<ApprovalSettings> {
  const s = await prisma.setting.findUnique({ where: { scope_scopeId_key: { scope: "GLOBAL", scopeId: "", key: KEY } } });
  return { ...DEFAULT_APPROVALS, ...((s?.value ?? {}) as Partial<ApprovalSettings>) };
}
export const APPROVALS_KEY = KEY;

const approved = new AsyncLocalStorage<{ approvalId: string }>();
/** Run an approved request's action: guarded services let it through. */
export function runApproved<T>(approvalId: string, fn: () => Promise<T>) {
  return approved.run({ approvalId }, fn);
}
export const insideApproval = () => approved.getStore() ?? null;

/**
 * Called by a guarded action whose threshold is crossed. Inside an approval: returns (go on).
 * Otherwise: records the request, alerts the approvers and throws APPROVAL_REQUIRED.
 */
export async function fourEyes(ctx: Ctx, req: ApprovalAsk) {
  if (insideApproval()) return;
  const id = await requestApproval(ctx, req);
  throw new AppError("APPROVAL_REQUIRED", `Sent for approval: a second person must approve this (${APPROVAL_LABEL[req.kind].toLowerCase()}). You'll be told when it's decided.`, 202, { approvalId: id });
}

type ApprovalAsk = { kind: ApprovalKind; summary: string; payload: unknown; amount?: number | null; companyId?: string | null };

/** Record a request and alert the approvers (no throw). */
export async function requestApproval(ctx: Ctx, req: ApprovalAsk) {
  const r = await prisma.approvalRequest.create({
    data: {
      kind: req.kind, summary: req.summary, payload: req.payload as Prisma.InputJsonValue, amount: req.amount ?? null, companyId: req.companyId ?? null, requestedById: ctx.user.id,
    },
  });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "approval.requested", entityType: "ApprovalRequest", entityId: r.id, after: { kind: req.kind, summary: req.summary } });
  const admin = await prisma.company.findFirst({ where: { type: "ADMIN" }, select: { id: true } });
  if (admin) await notify("approval.requested", [{ companyId: admin.id, link: `/admin/users/approval-workflows?id=${r.id}` }], { kind: APPROVAL_LABEL[req.kind], summary: req.summary, by: ctx.user.name }, { ref: { type: "ApprovalRequest", id: r.id } });
  return r.id;
}

/** Staff roles that need a second person: they can move money, change settings or give rights. */
export const POWERFUL_PERMISSIONS: PermissionCode[] = ["admin.users.manage", "admin.settings.manage", "admin.finance.manage", "admin.invoices.issue", "admin.risk.manage", "admin.vendors.commission"];
