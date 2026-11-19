/**
 * Server wrappers that load data for the self-service components. Used by the
 * applicant hub (/application-status) and the vendor / buyer company pages.
 */
import { getLocale } from "next-intl/server";
import type { Ctx } from "@/server/context";
import { can } from "@/server/rbac/guard";
import { addressApprovalSettings, listOwnAddresses, lockedTillAddressIds, ownAddressRequests } from "@/server/services/addresses";
import { listOwnCompanyDocuments, ownCompanyProfile, euCountryOptions } from "@/server/data/self-service";
import { listOwnRestrictionApprovals } from "@/server/services/restrictions";
import { uploadableCompanyDocTypes } from "@/server/services/documents";
import { ADDRESS_KINDS } from "@/server/onboarding/rules";
import { pickLocalized } from "@/i18n/config";
import { activityScheme } from "@/lib/activity-code";
import { ProfileForm } from "./profile-form";
import { AddressesManager } from "./addresses-manager";
import { DocumentsManager } from "./documents-manager";
import { RestrictedAccess } from "./restricted-access";
import { SpecialGoods } from "./special-goods";

export async function ProfileSection({ ctx }: { ctx: Ctx }) {
  const [c, locale] = await Promise.all([ownCompanyProfile(ctx), getLocale()]);
  return (
    <ProfileForm
      canEdit={can(ctx, "company.profile.manage")}
      data={{
        type: c.type, legalName: c.legalName, tradeName: c.tradeName, taxId: c.taxId, vatNumber: c.vatNumber, email: c.email, phone: c.phone,
        website: c.website, businessType: c.businessType, locked: true,
        countryLabel: `${c.country.flag ?? ""} ${pickLocalized(c.country.name, locale)}`,
        legalForm: c.legalForm, certificateCode: c.registryCertificateCode, countryCode: c.country.code,
        activityCode: c.activityCode, activityCodes: c.activityCodes, activityName: activityScheme(c.country.code).name, activityExample: activityScheme(c.country.code).example,
      }}
    />
  );
}

export async function AddressesSection({ ctx, kinds }: { ctx: Ctx; kinds?: string[] }) {
  if (ctx.company.type === "ADMIN") return null;
  const [rows, countries, requests, locked, approval] = await Promise.all([listOwnAddresses(ctx), euCountryOptions(), ownAddressRequests(ctx), lockedTillAddressIds(ctx.company.id), addressApprovalSettings()]);
  const allowed = kinds ?? ADDRESS_KINDS[ctx.company.type];
  const fullEdit = can(ctx, "company.addresses.manage");
  return (
    <AddressesManager
      canEdit={fullEdit || can(ctx, "buyer.addresses.manage")}
      kinds={fullEdit ? allowed : allowed.filter((k) => k === "DELIVERY")}
      defaultCountry={ctx.company.countryCode}
      approvalOn={approval.enabled && ["UNDER_REVIEW", "APPROVED", "SUSPENDED"].includes(ctx.company.status)}
      requests={requests.filter((r) => allowed.includes(r.kind)).map((r) => {
        const d = r.data as { label?: string; line1?: string; postalCode?: string; cityName?: string };
        const cur = r.addressId ? rows.find((a) => a.id === r.addressId) : null;
        return { id: r.id, action: r.action, status: r.status, kind: r.kind, label: d.label ?? cur?.label ?? "", line: d.line1 ? `${d.line1}, ${d.postalCode ?? ""} ${d.cityName ?? ""}` : cur ? `${cur.line1}, ${cur.postalCode} ${cur.cityName}` : "", note: r.decisionNote, addressId: r.addressId, hasProof: !!r.proofKey };
      })}
      countries={countries}
      rows={rows.filter((a) => allowed.includes(a.kind)).map((a) => ({
        id: a.id, kind: a.kind, label: a.label, line1: a.line1, line2: a.line2, postalCode: a.postalCode, cityId: a.cityId, cityName: a.cityName,
        countryCode: a.country.code, countryFlag: a.country.flag, contactName: a.contactName, phone: a.phone, isDefault: a.isDefault, tillLocked: locked.has(a.id),
      }))}
    />
  );
}

export async function DocumentsSection({ ctx }: { ctx: Ctx }) {
  if (ctx.company.type === "ADMIN") return null;
  const rows = await listOwnCompanyDocuments(ctx);
  return (
    <DocumentsManager
      canEdit={can(ctx, "company.documents.manage")}
      types={uploadableCompanyDocTypes(ctx.company.type)}
      required={ctx.company.type === "CUSTOMER" ? ["POS_INVOICE"] : []}
      rows={rows.map((d) => ({ id: d.id, type: d.type, fileName: d.fileName, status: d.status, reviewNote: d.reviewNote, createdAt: d.createdAt.toISOString(), expiresAt: d.expiresAt?.toISOString() ?? null }))}
    />
  );
}

export async function RestrictedSection({ ctx }: { ctx: Ctx }) {
  const rows = await listOwnRestrictionApprovals(ctx);
  return (
    <RestrictedAccess
      rows={(["TOBACCO", "ALCOHOL"] as const).map((r) => {
        const a = rows.find((x) => x.restriction === r);
        return { restriction: r, status: a?.status ?? null, validUntil: a?.validUntil?.toISOString() ?? null, reviewNote: a?.reviewNote ?? null };
      })}
    />
  );
}

/** Phase 47e — which special goods the business sells, and what it may buy. */
export async function SpecialGoodsSection({ ctx }: { ctx: Ctx }) {
  if (ctx.company.type === "ADMIN" || ctx.company.type === "DISTRIBUTOR") return null;
  const { specialOverview } = await import("@/server/special/service");
  const o = await specialOverview(ctx.company.id);
  if (!o.enabled) return null;
  return <SpecialGoods sells={o.sells} declared={o.declared} codes={o.codes} canEdit={can(ctx, "company.profile.manage")} rows={o.rows.map((r) => ({ target: r.target, open: r.open, warn: r.warn, reason: r.reason, label: r.label, category: r.category ? pickLocalizedName(r.category) : null }))} />;
}
const pickLocalizedName = (n: unknown) => (typeof n === "string" ? n : (n as Record<string, string> | null)?.en ?? Object.values((n as Record<string, string>) ?? {})[0] ?? "");
