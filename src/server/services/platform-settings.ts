/**
 * Marketplace, order, vendor and customer settings (Super Admin). One GLOBAL Setting row
 * "platform.settings"; missing values fall back to DEFAULT_PLATFORM. The existing
 * "catalogue.offerApprovalRequired" row stays the source for offer approval.
 */
import { cache } from "react";
import { prisma } from "@/server/db";
import type { Ctx } from "@/server/context";
import { can } from "@/server/rbac/guard";
import { ForbiddenError, ValidationError } from "@/server/errors";
import { writeAudit } from "./audit";

const KEY = "platform.settings";
export type PlatformSettings = {
  supportEmail: string; supportPhone: string | null;
  /** Shown on top of every portal (e.g. planned maintenance); empty = none. */
  notice: string | null;
  /** New applications accepted per account type (country markets still apply). */
  registrations: { CUSTOMER: boolean; WHOLESALER: boolean; DISTRIBUTOR: boolean; DRIVER: boolean };
  /** Buyers may cancel an order until the supplier confirms it. */
  buyerCanCancel: boolean;
  /** Furthest requested delivery date, in days from today. */
  maxRequestedDays: number;
};
export const DEFAULT_PLATFORM: PlatformSettings = {
  supportEmail: "support@firingi.test", supportPhone: null, notice: null,
  registrations: { CUSTOMER: true, WHOLESALER: true, DISTRIBUTOR: true, DRIVER: true },
  buyerCanCancel: true, maxRequestedDays: 30,
};

export const platformSettings = cache(async (): Promise<PlatformSettings> => {
  const s = await prisma.setting.findUnique({ where: { scope_scopeId_key: { scope: "GLOBAL", scopeId: "", key: KEY } } });
  const v = (s?.value ?? {}) as Partial<PlatformSettings>;
  return { ...DEFAULT_PLATFORM, ...v, registrations: { ...DEFAULT_PLATFORM.registrations, ...(v.registrations ?? {}) } };
});

export async function updatePlatformSettings(ctx: Ctx, patch: Partial<PlatformSettings> & { offerApprovalRequired?: boolean }) {
  if (ctx.company.type !== "ADMIN" || !can(ctx, "admin.settings.manage")) throw new ForbiddenError();
  const before = await platformSettings();
  const { offerApprovalRequired, ...rest } = patch;
  const next: PlatformSettings = { ...before, ...rest, registrations: { ...before.registrations, ...(rest.registrations ?? {}) } };
  next.supportEmail = next.supportEmail.trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(next.supportEmail)) throw new ValidationError("Enter a valid support e-mail.");
  next.supportPhone = next.supportPhone?.trim() || null;
  next.notice = next.notice?.trim().slice(0, 300) || null;
  next.buyerCanCancel = !!next.buyerCanCancel;
  if (!Number.isInteger(Number(next.maxRequestedDays)) || next.maxRequestedDays < 1 || next.maxRequestedDays > 180) throw new ValidationError("Requested delivery: 1–180 days ahead.");
  next.maxRequestedDays = Number(next.maxRequestedDays);
  for (const k of Object.keys(next.registrations) as (keyof PlatformSettings["registrations"])[]) next.registrations[k] = !!next.registrations[k];
  await prisma.$transaction(async (tx) => {
    await tx.setting.upsert({ where: { scope_scopeId_key: { scope: "GLOBAL", scopeId: "", key: KEY } }, update: { value: next, updatedById: ctx.user.id }, create: { scope: "GLOBAL", scopeId: "", key: KEY, value: next, updatedById: ctx.user.id } });
    if (offerApprovalRequired !== undefined)
      await tx.setting.upsert({ where: { scope_scopeId_key: { scope: "GLOBAL", scopeId: "", key: "catalogue.offerApprovalRequired" } }, update: { value: !!offerApprovalRequired, updatedById: ctx.user.id }, create: { scope: "GLOBAL", scopeId: "", key: "catalogue.offerApprovalRequired", value: !!offerApprovalRequired, updatedById: ctx.user.id } });
    await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "setting.platform", entityType: "Setting", entityId: KEY, before, after: { ...next, ...(offerApprovalRequired !== undefined ? { offerApprovalRequired } : {}) } }, tx);
  });
  return next;
}

export async function offerApprovalSetting() {
  const s = await prisma.setting.findUnique({ where: { scope_scopeId_key: { scope: "GLOBAL", scopeId: "", key: "catalogue.offerApprovalRequired" } } });
  return s?.value === true; // default: offers on approved products go live directly
}
