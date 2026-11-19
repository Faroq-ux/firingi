/** Company addresses (warehouse / pickup for vendors, delivery for buyers). */
import type { AddressKind } from "@prisma/client";
import { prisma } from "@/server/db";
import type { Ctx } from "@/server/context";
import { can } from "@/server/rbac/guard";
import { ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import { ADDRESS_KINDS, addressMustBeDomestic } from "@/server/onboarding/rules";
import { writeAudit } from "./audit";
import { storeUpload } from "./storage";
import { POS_INVOICE_MAX_AGE_DAYS } from "@/server/onboarding/rules";

export type AddressInput = {
  id?: string; kind: AddressKind; label: string; line1: string; line2?: string | null; postalCode: string;
  countryCode: string; cityId?: string | null; cityName: string; contactName?: string | null; phone?: string | null; isDefault?: boolean;
};

function canManage(ctx: Ctx, kind?: AddressKind) {
  if (can(ctx, "company.addresses.manage")) return true;
  // Purchasers may maintain delivery addresses without full company rights.
  return kind === "DELIVERY" && can(ctx, "buyer.addresses.manage");
}

export async function listOwnAddresses(ctx: Ctx) {
  if (!canManage(ctx) && !can(ctx, "buyer.addresses.manage") && !can(ctx, "company.profile.manage")) throw new ForbiddenError();
  return prisma.address.findMany({
    where: { companyId: ctx.company.id, isActive: true },
    include: { country: { select: { code: true, flag: true } } },
    orderBy: [{ kind: "asc" }, { isDefault: "desc" }, { createdAt: "asc" }],
  });
}

export type AddressSaved = { id: string | null; pending: boolean; requestId?: string };

/** Check an address for this company; returns the row data to store (throws when it isn't allowed). */
async function prepareAddress(company: { id: string; type: Ctx["company"]["type"]; countryId: string }, input: AddressInput) {
  if (!ADDRESS_KINDS[company.type as Exclude<typeof company.type, "ADMIN">]?.includes(input.kind)) throw new ValidationError("This address type is not available for your account.");
  const country = await prisma.country.findUnique({ where: { code: input.countryCode } });
  if (!country || !country.isEU) throw new ValidationError("Please choose an EU country.");
  if (addressMustBeDomestic(company.type as Exclude<typeof company.type, "ADMIN">, input.kind) && country.id !== company.countryId)
    throw new ValidationError("This address must be in your company's country.");
  let lat = null, lng = null;
  if (input.cityId) {
    const city = await prisma.city.findFirst({ where: { id: input.cityId, countryId: country.id } });
    if (!city) throw new ValidationError("City does not belong to the selected country.");
    // Until address-level geocoding is connected, use the city's coordinates.
    lat = city.latitude; lng = city.longitude;
  }
  return {
    kind: input.kind, label: input.label.trim(), line1: input.line1.trim(), line2: input.line2?.trim() || null, postalCode: input.postalCode.trim(),
    countryId: country.id, cityId: input.cityId || null, cityName: input.cityName.trim(), contactName: input.contactName?.trim() || null,
    phone: input.phone?.trim() || null, latitude: lat, longitude: lng,
  };
}

/** Store an address (directly, or once FIRINGI approved the change). */
async function applyAddress(companyId: string, actorUserId: string, actorCompanyId: string, input: AddressInput, data: Awaited<ReturnType<typeof prepareAddress>>, branchId?: string | null) {
  // Phase 36: the plan's warehouse limit (a new warehouse / pickup point, or another address becoming one)
  if (["WAREHOUSE", "PICKUP"].includes(input.kind)) {
    const before = input.id ? await prisma.address.findFirst({ where: { id: input.id, companyId }, select: { kind: true } }) : null;
    if (!before || !["WAREHOUSE", "PICKUP"].includes(before.kind)) await (await import("@/server/plans/service")).assertWithinLimit(companyId, "warehouses");
  }
  return prisma.$transaction(async (tx) => {
    let existing = null;
    if (input.id) {
      existing = await tx.address.findFirst({ where: { id: input.id, companyId, isActive: true } });
      if (!existing) throw new NotFoundError("Address");
      if (existing.kind === "HEAD_OFFICE" && input.kind !== "HEAD_OFFICE") throw new ValidationError("The head office address can't change type.");
    }
    if (input.isDefault) await tx.address.updateMany({ where: { companyId, kind: input.kind, isDefault: true }, data: { isDefault: false } });
    const isFirstOfKind = !(await tx.address.count({ where: { companyId, kind: input.kind, isActive: true, NOT: input.id ? { id: input.id } : undefined } }));
    const row = input.id
      ? await tx.address.update({
          where: { id: input.id },
          data: { ...data, isDefault: !!input.isDefault || isFirstOfKind || (existing!.kind === input.kind && existing!.isDefault) },
        })
      : await tx.address.create({ data: { ...data, companyId, isDefault: !!input.isDefault || isFirstOfKind, ...(branchId ? { branchId } : {}) } });
    await writeAudit({ actorUserId, actorCompanyId, action: input.id ? "address.updated" : "address.created", entityType: "Address", entityId: row.id, after: data }, tx);
    return row;
  });
}

/**
 * Phase 47d — once a company has sent its registration to FIRINGI, its addresses (head office, billing, warehouse,
 * pickup, delivery / shop) change only with FIRINGI's approval. FIRINGI switches this per address kind.
 */
export async function addressNeedsApproval(companyId: string, kind: AddressKind) {
  const s = await addressApprovalSettings();
  if (!s.enabled || !s.kinds[kind]) return false;
  const c = await prisma.company.findUnique({ where: { id: companyId }, select: { status: true, type: true } });
  return !!c && c.type !== "ADMIN" && (c.status === "UNDER_REVIEW" || c.status === "APPROVED" || c.status === "SUSPENDED");
}

/** The address a till issues its receipts from: the till's own address, else the head office. */
export async function tillIssuingAddressId(companyId: string, registerAddressId: string | null) {
  if (registerAddressId) return registerAddressId;
  return (await prisma.address.findFirst({ where: { companyId, kind: "HEAD_OFFICE", isActive: true }, orderBy: { createdAt: "asc" }, select: { id: true } }))?.id ?? null;
}

/** Addresses printed on receipts a till has already issued — fixed for good (a new address = a new till). */
export async function lockedTillAddressIds(companyId: string) {
  const tills = await prisma.posRegister.findMany({ where: { companyId, sales: { some: {} } }, select: { addressId: true } });
  const ids = new Set<string>();
  for (const t of tills) { const id = await tillIssuingAddressId(companyId, t.addressId); if (id) ids.add(id); }
  return ids;
}
const TILL_LOCKED = "This address is printed on your till receipts, so it can't be changed or removed. For a new address, open a new till there.";

export type AddressProof = { file: File; issuedOn?: Date | null };

/** A recent invoice from the company's own till, as proof of an address: dated, not in the future, recent. */
async function storeProof(companyId: string, proof: AddressProof) {
  const d = proof.issuedOn;
  const today = new Date(); today.setUTCHours(0, 0, 0, 0);
  if (!d || Number.isNaN(d.getTime())) throw new ValidationError("Enter the date on the till invoice.");
  if (d.getTime() > today.getTime() + 86_400_000) throw new ValidationError("The invoice date can't be in the future.");
  if (d.getTime() < today.getTime() - POS_INVOICE_MAX_AGE_DAYS * 86_400_000) throw new ValidationError(`The till invoice must be recent (at most ${POS_INVOICE_MAX_AGE_DAYS} days old).`);
  const st = await storeUpload(proof.file, `companies/${companyId}/address-proof`);
  return { proofKey: st.key, proofName: st.fileName, proofMime: st.mimeType, proofIssuedOn: d };
}

/** Same place? (street, postal code, city, country, kind) — only a new place needs FIRINGI's approval. */
function samePlace(a: { kind: AddressKind; line1: string; line2: string | null; postalCode: string; cityId: string | null; cityName: string; countryId: string }, d: Awaited<ReturnType<typeof prepareAddress>>) {
  const n = (v: string | null | undefined) => (v ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  return a.kind === d.kind && n(a.line1) === n(d.line1) && n(a.line2) === n(d.line2) && n(a.postalCode).replace(/\s/g, "") === n(d.postalCode).replace(/\s/g, "") && (a.cityId ?? "") === (d.cityId ?? "") && n(a.cityName) === n(d.cityName) && a.countryId === d.countryId;
}

export async function saveAddress(ctx: Ctx, input: AddressInput, opts: { branchId?: string | null; proof?: AddressProof | null } = {}): Promise<AddressSaved> {
  if (ctx.company.type === "ADMIN") throw new ForbiddenError();
  if (!canManage(ctx, input.kind)) throw new ForbiddenError();
  const existing = input.id ? await prisma.address.findFirst({ where: { id: input.id, companyId: ctx.company.id, isActive: true } }) : null;
  if (input.id && !existing) throw new NotFoundError("Address");
  if (existing && existing.kind !== input.kind && !canManage(ctx, existing.kind)) throw new ForbiddenError();
  if (existing?.kind === "HEAD_OFFICE" && input.kind !== "HEAD_OFFICE") throw new ValidationError("The head office address can't change type.");
  if (existing && (await lockedTillAddressIds(ctx.company.id)).has(existing.id)) throw new ValidationError(TILL_LOCKED);
  const data = await prepareAddress(ctx.company, input);
  // Approval the first time only: a new address, or an address moved to another place. Name, contact, phone and
  // "default" of an approved address change at once.
  const newPlace = !existing || !samePlace(existing, data);
  if (newPlace && await addressNeedsApproval(ctx.company.id, input.kind)) {
    const proof = opts.proof?.file && opts.proof.file.size > 0 ? await storeProof(ctx.company.id, opts.proof) : null;
    const requestId = await requestChange(ctx, input.id ? "UPDATE" : "CREATE", input.kind, input.id ?? null, { ...input, label: data.label }, opts.branchId ?? null, proof);
    return { id: input.id ?? null, pending: true, requestId };
  }
  const row = await applyAddress(ctx.company.id, ctx.user.id, ctx.company.id, input, data, opts.branchId);
  return { id: row.id, pending: false };
}

/** A change waiting for FIRINGI: one open request per address (a newer one replaces it). */
async function requestChange(ctx: Ctx, action: "CREATE" | "UPDATE" | "REMOVE", kind: AddressKind, addressId: string | null, input: AddressInput | null, branchId: string | null, proof: Awaited<ReturnType<typeof storeProof>> | null = null) {
  if (addressId) await prisma.addressChangeRequest.updateMany({ where: { companyId: ctx.company.id, addressId, status: "PENDING" }, data: { status: "CANCELLED", decidedAt: new Date(), decisionNote: "Replaced by a newer request" } });
  const r = await prisma.addressChangeRequest.create({ data: { companyId: ctx.company.id, addressId, action, kind, data: (input ?? {}) as never, branchId, requestedById: ctx.user.id, ...(proof ?? {}) } });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "address.change_requested", entityType: "AddressChangeRequest", entityId: r.id, after: { action, kind, addressId, input } as never });
  const admin = await prisma.company.findFirst({ where: { type: "ADMIN" }, select: { id: true } });
  if (admin) {
    const { notify } = await import("@/server/notify/dispatch");
    const where = input ? `${input.label}: ${input.line1}, ${input.postalCode} ${input.cityName}` : "";
    await notify("address.change_requested", [{ companyId: admin.id }], { company: ctx.company.tradeName ?? ctx.company.legalName, change: `${action.toLowerCase()} ${kind.toLowerCase().replace("_", " ")} ${where}`.trim() }, { ref: { type: "AddressChangeRequest", id: r.id } }).catch(() => null);
  }
  return r.id;
}

/** The company's own open / recent address requests. */
export async function ownAddressRequests(ctx: Ctx) {
  return prisma.addressChangeRequest.findMany({ where: { companyId: ctx.company.id, OR: [{ status: "PENDING" }, { decidedAt: { gte: new Date(Date.now() - 30 * 86_400_000) } }] }, orderBy: { createdAt: "desc" }, take: 30 });
}

/** Attach the till invoice to an open request afterwards (e.g. a shop created together with its address). */
export async function attachAddressProof(ctx: Ctx, id: string, proof: AddressProof) {
  const r = await prisma.addressChangeRequest.findFirst({ where: { id, companyId: ctx.company.id, status: "PENDING" } });
  if (!r) throw new NotFoundError("Request");
  if (!canManage(ctx, r.kind)) throw new ForbiddenError();
  const p = await storeProof(ctx.company.id, proof);
  await prisma.addressChangeRequest.update({ where: { id }, data: p });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "address.proof_attached", entityType: "AddressChangeRequest", entityId: id, after: { file: p.proofName, issuedOn: p.proofIssuedOn } });
}

/** The till invoice of a request: for the company itself and FIRINGI staff only. */
export async function readAddressProof(ctx: Ctx, id: string) {
  const r = await prisma.addressChangeRequest.findUnique({ where: { id }, include: { company: { select: { type: true } } } });
  if (!r?.proofKey) throw new NotFoundError("File");
  const { canViewType } = await import("./admin-access");
  const ok = ctx.company.type === "ADMIN" ? canViewType(ctx, r.company.type) : r.companyId === ctx.company.id;
  if (!ok) throw new ForbiddenError();
  const { readStored } = await import("./storage");
  return { data: await readStored(r.proofKey), mimeType: r.proofMime ?? "application/octet-stream", fileName: r.proofName ?? "till-invoice" };
}

/** The company withdraws its own open request. */
export async function cancelAddressRequest(ctx: Ctx, id: string) {
  const r = await prisma.addressChangeRequest.findFirst({ where: { id, companyId: ctx.company.id, status: "PENDING" } });
  if (!r) throw new NotFoundError("Request");
  if (!canManage(ctx, r.kind)) throw new ForbiddenError();
  await prisma.addressChangeRequest.update({ where: { id }, data: { status: "CANCELLED", decidedAt: new Date(), decisionNote: "Withdrawn by the company" } });
}

export async function removeAddress(ctx: Ctx, id: string) {
  const a = await prisma.address.findFirst({ where: { id, companyId: ctx.company.id, isActive: true } });
  if (!a) throw new NotFoundError("Address");
  if (!canManage(ctx, a.kind)) throw new ForbiddenError();
  if (a.kind === "HEAD_OFFICE") throw new ValidationError("The head office address can be edited but not removed.");
  if ((await lockedTillAddressIds(ctx.company.id)).has(a.id)) throw new ValidationError(TILL_LOCKED);
  // Soft delete: past orders keep referencing it.
  await prisma.address.update({ where: { id }, data: { isActive: false, isDefault: false } });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "address.removed", entityType: "Address", entityId: id });
  return { pending: false };
}

// ── FIRINGI: settings and decisions ──────────────────────────────────────────

export const ADDRESS_APPROVAL_KEY = "address.approval";
export type AddressApprovalSettings = { enabled: boolean; proofRequired: boolean; kinds: Record<AddressKind, boolean> };
const ALL_KINDS: AddressKind[] = ["HEAD_OFFICE", "BILLING", "WAREHOUSE", "PICKUP", "DELIVERY"];

export async function addressApprovalSettings(): Promise<AddressApprovalSettings> {
  const row = await prisma.setting.findFirst({ where: { scope: "GLOBAL", scopeId: "", key: ADDRESS_APPROVAL_KEY } });
  const v = (row?.value ?? {}) as Partial<AddressApprovalSettings>;
  return { enabled: v.enabled ?? true, proofRequired: v.proofRequired ?? true, kinds: Object.fromEntries(ALL_KINDS.map((k) => [k, v.kinds?.[k] ?? true])) as Record<AddressKind, boolean> };
}

function requireStaff(ctx: Ctx, manage = false) {
  if (ctx.company.type !== "ADMIN" || !can(ctx, manage ? ["admin.settings.manage"] : ["admin.customers.approve", "admin.vendors.approve", "admin.settings.manage"])) throw new ForbiddenError();
}

export async function saveAddressApprovalSettings(ctx: Ctx, v: AddressApprovalSettings) {
  requireStaff(ctx, true);
  const value = { enabled: !!v.enabled, proofRequired: !!v.proofRequired, kinds: Object.fromEntries(ALL_KINDS.map((k) => [k, !!v.kinds?.[k]])) };
  const before = await addressApprovalSettings();
  await prisma.setting.upsert({
    where: { scope_scopeId_key: { scope: "GLOBAL", scopeId: "", key: ADDRESS_APPROVAL_KEY } },
    update: { value: value as never, updatedById: ctx.user.id },
    create: { scope: "GLOBAL", scopeId: "", key: ADDRESS_APPROVAL_KEY, value: value as never, updatedById: ctx.user.id },
  });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "address.approval_settings", entityType: "Setting", entityId: ADDRESS_APPROVAL_KEY, before: before as never, after: value as never });
  return value;
}

/** FIRINGI's queue of address changes (open first), with the current address beside the proposed one. */
export async function adminAddressRequests(ctx: Ctx, opts: { status?: "PENDING" | "ALL"; companyId?: string; types?: ("DISTRIBUTOR" | "WHOLESALER" | "CUSTOMER")[] } = {}) {
  requireStaff(ctx);
  const { canDecideType } = await import("./admin-access");
  const rows = await prisma.addressChangeRequest.findMany({
    where: { ...(opts.status === "ALL" ? {} : { status: "PENDING" }), ...(opts.companyId ? { companyId: opts.companyId } : {}), ...(opts.types ? { company: { type: { in: opts.types } } } : {}) },
    orderBy: [{ status: "asc" }, { createdAt: "asc" }], take: 200,
    include: { company: { select: { id: true, legalName: true, tradeName: true, type: true, taxId: true, country: { select: { code: true, flag: true } } } } },
  });
  const addrIds = rows.map((r) => r.addressId).filter(Boolean) as string[];
  const current = new Map((await prisma.address.findMany({ where: { id: { in: addrIds } }, select: { id: true, label: true, line1: true, line2: true, postalCode: true, cityName: true, country: { select: { code: true } } } })).map((a) => [a.id, a]));
  const users = new Map((await prisma.user.findMany({ where: { id: { in: rows.map((r) => r.requestedById) } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
  return rows.map((r) => ({ ...r, current: r.addressId ? current.get(r.addressId) ?? null : null, requestedBy: users.get(r.requestedById) ?? "", canDecide: canDecideType(ctx, r.company.type) }));
}

/** Approve (apply it) or reject (with a reason) an address change; the company is told either way. */
export async function decideAddressRequest(ctx: Ctx, id: string, approve: boolean, note?: string | null, opts: { bypassProof?: boolean } = {}) {
  requireStaff(ctx);
  const r = await prisma.addressChangeRequest.findUnique({ where: { id }, include: { company: { select: { id: true, type: true, countryId: true } } } });
  if (!r || r.status !== "PENDING") throw new NotFoundError("Request");
  const { canDecideType } = await import("./admin-access");
  if (!canDecideType(ctx, r.company.type)) throw new ForbiddenError();
  if (!approve && !note?.trim()) throw new ValidationError("Give the company a reason for refusing the change.");
  const bypassed = approve && r.action !== "REMOVE" && !r.proofKey;
  if (bypassed && (await addressApprovalSettings()).proofRequired && !opts.bypassProof) throw new ValidationError("No till invoice is attached. Ask the company for one, or approve anyway (bypass).");
  let appliedAddressId: string | null = null;
  if (approve && r.addressId && (await lockedTillAddressIds(r.company.id)).has(r.addressId)) throw new ValidationError("This address is now printed on the company's till receipts — it can't change any more. Refuse the request.");
  if (approve) {
    if (r.action === "REMOVE") {
      await prisma.address.update({ where: { id: r.addressId! }, data: { isActive: false, isDefault: false } });
      await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "address.removed", entityType: "Address", entityId: r.addressId! });
      appliedAddressId = r.addressId;
    } else {
      const input = r.data as unknown as AddressInput;
      const data = await prepareAddress({ id: r.company.id, type: r.company.type, countryId: r.company.countryId }, input);
      const row = await applyAddress(r.company.id, ctx.user.id, ctx.company.id, input, data, r.branchId);
      appliedAddressId = row.id;
    }
  }
  await prisma.addressChangeRequest.update({ where: { id }, data: { status: approve ? "APPROVED" : "REJECTED", decidedById: ctx.user.id, decidedAt: new Date(), decisionNote: note?.trim().slice(0, 300) || null, appliedAddressId, proofBypassed: bypassed } });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: approve ? "address.change_approved" : "address.change_rejected", entityType: "AddressChangeRequest", entityId: id, after: { note: note ?? null, appliedAddressId, proofBypassed: bypassed } });
  const { notify } = await import("@/server/notify/dispatch");
  const label = (r.data as { label?: string } | null)?.label ?? r.kind.toLowerCase();
  await notify("address.change_decided", [{ companyId: r.company.id }], { address: label, decision: approve ? "approved" : "refused", note: note?.trim() ?? "" }, { ref: { type: "AddressChangeRequest", id } }).catch(() => null);
  return { ok: true, appliedAddressId };
}
