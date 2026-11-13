/**
 * Approval requests: list, approve (runs the action as requested, by the approver), reject,
 * withdraw; thresholds. See gate.ts.
 */
import type { Prisma } from "@prisma/client";
import { prisma } from "@/server/db";
import type { Ctx } from "@/server/context";
import { can } from "@/server/rbac/guard";
import { AppError, ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import { notify } from "@/server/notify/dispatch";
import { writeAudit } from "@/server/services/audit";
import { APPROVAL_LABEL, APPROVAL_PERMISSION, APPROVALS_KEY, approvalSettings, runApproved, type ApprovalKind, type ApprovalSettings } from "./gate";

function assertStaff(ctx: Ctx) {
  if (ctx.company.type !== "ADMIN") throw new ForbiddenError();
}
const mayDecide = (ctx: Ctx, kind: ApprovalKind) => can(ctx, APPROVAL_PERMISSION[kind]);

export async function listApprovals(ctx: Ctx, status?: "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED" | "FAILED") {
  assertStaff(ctx);
  const rows = await prisma.approvalRequest.findMany({ where: status ? { status } : {}, orderBy: [{ status: "asc" }, { requestedAt: "desc" }], take: 200 });
  const users = await prisma.user.findMany({ where: { id: { in: [...new Set(rows.flatMap((r) => [r.requestedById, r.decidedById].filter((x): x is string => !!x)))] } }, select: { id: true, name: true } });
  const name = (id: string | null) => (id ? users.find((u) => u.id === id)?.name ?? "—" : null);
  return rows
    .filter((r) => r.requestedById === ctx.user.id || mayDecide(ctx, r.kind as ApprovalKind) || can(ctx, ["admin.risk.view", "admin.risk.manage"]))
    .map((r) => ({
      ...r, kindLabel: APPROVAL_LABEL[r.kind as ApprovalKind] ?? r.kind, requestedBy: name(r.requestedById), decidedBy: name(r.decidedById),
      canDecide: r.status === "PENDING" && r.requestedById !== ctx.user.id && mayDecide(ctx, r.kind as ApprovalKind),
      canWithdraw: r.status === "PENDING" && r.requestedById === ctx.user.id,
    }));
}

/** Runs the requested action, as the approver (who must hold the same right). */
async function execute(ctx: Ctx, kind: ApprovalKind, p: Record<string, unknown>): Promise<unknown> {
  switch (kind) {
    case "CREDIT_NOTE": {
      const { issueCreditNote } = await import("@/server/services/finance");
      const cn = await issueCreditNote(ctx, p.invoiceId as string, { lines: p.lines as "ALL", reason: p.reason as string });
      return { creditNote: cn.fullNumber };
    }
    case "CLAIM": {
      const { decideClaim } = await import("@/server/claims/service");
      const r = await decideClaim(ctx, p.claimId as string, p.input as Parameters<typeof decideClaim>[2]);
      return { claim: r.number, creditNote: r.creditNote ?? null };
    }
    case "CUSTOMER_TERMS": {
      const { setCustomerTerms } = await import("@/server/services/payments");
      await setCustomerTerms(ctx, p.companyId as string, p.paymentTermsDays as number, p.creditLimit as number | null);
      return null;
    }
    case "COMMISSION": {
      const { setCommissionRate } = await import("@/server/services/company");
      await setCommissionRate(ctx, p.vendorCompanyId as string, p.ratePercent as number, (p.note as string | null) ?? null);
      return null;
    }
    case "OFFER": {
      const { saveAdminPromotion } = await import("@/server/services/promotions");
      const i = p.input as Record<string, unknown>;
      const r = await saveAdminPromotion(ctx, { ...(i as object), validFrom: new Date(i.validFrom as string), validTo: i.validTo ? new Date(i.validTo as string) : null } as Parameters<typeof saveAdminPromotion>[1]);
      return { promotionId: r.id };
    }
    case "BANK_DETAILS": {
      const { setLegalEntityIban } = await import("@/server/services/payments");
      await setLegalEntityIban(ctx, p.legalEntityId as string, p.iban as string);
      return null;
    }
    case "STAFF_ROLE": {
      const { setMemberRoles } = await import("@/server/services/team");
      await setMemberRoles(ctx, p.membershipId as string, p.roleIds as string[]);
      return null;
    }
    case "PAYMENT": {
      const { recordPayment } = await import("@/server/services/finance");
      const pay = await recordPayment(ctx, { ...(p.input as object), paidAt: new Date((p.input as { paidAt: string }).paidAt) } as Parameters<typeof recordPayment>[1]);
      return { paymentId: pay.id };
    }
  }
}

export async function decideApproval(ctx: Ctx, id: string, approve: boolean, reason: string | null) {
  assertStaff(ctx);
  const r = await prisma.approvalRequest.findUnique({ where: { id } });
  if (!r) throw new NotFoundError("Approval request");
  const kind = r.kind as ApprovalKind;
  if (r.requestedById === ctx.user.id) throw new ForbiddenError("A second person must decide — not the one who asked.");
  if (!mayDecide(ctx, kind)) throw new ForbiddenError("You need the same right as the action to decide it.");
  if (!approve && !reason?.trim()) throw new ValidationError("Give the reason for rejecting.");
  const claimed = await prisma.approvalRequest.updateMany({ where: { id, status: "PENDING" }, data: { status: approve ? "APPROVED" : "REJECTED", decidedById: ctx.user.id, decidedAt: new Date(), reason: reason?.trim() || null } });
  if (!claimed.count) throw new AppError("ALREADY_DECIDED", "This request was already decided or withdrawn.", 409);
  let result: unknown = null, error: string | null = null;
  if (approve) {
    try { result = await runApproved(id, () => execute(ctx, kind, r.payload as Record<string, unknown>)); }
    catch (e) { error = e instanceof Error ? e.message : String(e); }
    await prisma.approvalRequest.update({ where: { id }, data: error ? { status: "FAILED", error: error.slice(0, 500) } : { result: (result ?? undefined) as Prisma.InputJsonValue | undefined } });
  }
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: approve ? (error ? "approval.failed" : "approval.approved") : "approval.rejected", entityType: "ApprovalRequest", entityId: id, after: { kind, reason, error } });
  await notify("approval.decided", [{ userId: r.requestedById, link: `/admin/users/approval-workflows?id=${id}` }], { kind: APPROVAL_LABEL[kind], summary: r.summary, decision: approve ? (error ? "approved but failed" : "approved") : "rejected", reason: reason ?? error ?? "" }, { ref: { type: "ApprovalRequest", id } });
  if (error) throw new AppError("APPROVAL_FAILED", `Approved, but it couldn't be applied: ${error}`, 409);
  return { status: approve ? "APPROVED" : "REJECTED", result };
}

export async function withdrawApproval(ctx: Ctx, id: string) {
  assertStaff(ctx);
  const n = await prisma.approvalRequest.updateMany({ where: { id, requestedById: ctx.user.id, status: "PENDING" }, data: { status: "CANCELLED" } });
  if (!n.count) throw new ValidationError("Only your own pending request can be withdrawn.");
}

export async function saveApprovalSettings(ctx: Ctx, input: Partial<ApprovalSettings>) {
  if (ctx.company.type !== "ADMIN" || !can(ctx, "admin.settings.manage")) throw new ForbiddenError();
  const cur = await approvalSettings();
  const next = { ...cur, ...input };
  for (const k of ["creditNoteAbove", "creditLimitAbove", "paymentDaysAbove", "offerPercentAbove", "offerAmountAbove", "paymentAbove"] as const)
    if (!Number.isFinite(next[k]) || next[k] < 0) throw new ValidationError("Thresholds can't be negative.");
  await prisma.setting.upsert({
    where: { scope_scopeId_key: { scope: "GLOBAL", scopeId: "", key: APPROVALS_KEY } },
    update: { value: next as unknown as Prisma.InputJsonValue, updatedById: ctx.user.id }, create: { scope: "GLOBAL", key: APPROVALS_KEY, value: next as unknown as Prisma.InputJsonValue, updatedById: ctx.user.id },
  });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "approvals.settings", entityType: "Setting", entityId: APPROVALS_KEY, before: cur, after: next });
  return next;
}
