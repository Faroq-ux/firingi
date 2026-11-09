/**
 * Server wrappers that load data for the self-service components. Used by the
 * applicant hub (/application-status) and the vendor / buyer company pages.
 */
import { getLocale } from "next-intl/server";
import type { Ctx } from "@/server/context";
import { can } from "@/server/rbac/guard";
import { listOwnAddresses } from "@/server/services/addresses";
import { listOwnCompanyDocuments, ownCompanyProfile, euCountryOptions } from "@/server/data/self-service";
import { listOwnRestrictionApprovals } from "@/server/services/restrictions";
import { uploadableCompanyDocTypes } from "@/server/services/documents";
import { ADDRESS_KINDS, REQUIRED_DOCUMENTS } from "@/server/onboarding/rules";
import { pickLocalized } from "@/i18n/config";
import { ProfileForm } from "./profile-form";
import { AddressesManager } from "./addresses-manager";
import { DocumentsManager } from "./documents-manager";
import { RestrictedAccess } from "./restricted-access";

export async function ProfileSection({ ctx }: { ctx: Ctx }) {
  const [c, locale] = await Promise.all([ownCompanyProfile(ctx), getLocale()]);
  return (
    <ProfileForm
      canEdit={can(ctx, "company.profile.manage")}
      data={{
        type: c.type, legalName: c.legalName, tradeName: c.tradeName, taxId: c.taxId, vatNumber: c.vatNumber, email: c.email, phone: c.phone,
        website: c.website, businessType: c.businessType, locked: c.status !== "PENDING" && c.status !== "REJECTED",
        countryLabel: `${c.country.flag ?? ""} ${pickLocalized(c.country.name, locale)}`,
      }}
    />
  );
}

export async function AddressesSection({ ctx, kinds }: { ctx: Ctx; kinds?: string[] }) {
  if (ctx.company.type === "ADMIN") return null;
  const [rows, countries] = await Promise.all([listOwnAddresses(ctx), euCountryOptions()]);
  const allowed = kinds ?? ADDRESS_KINDS[ctx.company.type];
  const fullEdit = can(ctx, "company.addresses.manage");
  return (
    <AddressesManager
      canEdit={fullEdit || can(ctx, "buyer.addresses.manage")}
      kinds={fullEdit ? allowed : allowed.filter((k) => k === "DELIVERY")}
      defaultCountry={ctx.company.countryCode}
      countries={countries}
      rows={rows.filter((a) => allowed.includes(a.kind)).map((a) => ({
        id: a.id, kind: a.kind, label: a.label, line1: a.line1, line2: a.line2, postalCode: a.postalCode, cityId: a.cityId, cityName: a.cityName,
        countryCode: a.country.code, countryFlag: a.country.flag, contactName: a.contactName, phone: a.phone, isDefault: a.isDefault,
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
      required={REQUIRED_DOCUMENTS[ctx.company.type]}
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
