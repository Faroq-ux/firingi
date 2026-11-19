/**
 * Self-registration for distributors, wholesalers, wholesale customers and drivers.
 * Every new account starts PENDING and needs FIRINGI approval before it can trade.
 */
import { platformSettings } from "./platform-settings";
import type { CompanyType } from "@prisma/client";
import { hashPassword } from "better-auth/crypto";
import { prisma } from "@/server/db";
import { AppError, ValidationError } from "@/server/errors";
import { checkCompanyVat, isValidPtNif } from "@/lib/tax-id";
import { writeAudit } from "./audit";
import { sendMail } from "./mailer";
import { consumeInvite, launchSettings } from "@/server/launch/service";

export type CompanyRegistration = {
  type: Exclude<CompanyType, "ADMIN">;
  countryCode: string;
  /** Phase 33: invitation code — required while FIRINGI runs as an invite-only pilot. */
  invite?: string | null;
  legalName: string;
  tradeName?: string | null;
  taxId: string;
  vatNumber?: string | null;
  /** economic activity code (CAE in Portugal…) — required for wholesale customers */
  activityCode?: string | null;
  companyEmail: string;
  phone: string;
  businessType?: string | null;
  owner: { name: string; email: string; password: string };
  headOffice: { line1: string; line2?: string | null; postalCode: string; cityId?: string | null; cityName: string };
};

const MARKET_FLAG = {
  CUSTOMER: "customerMarketEnabled",
  WHOLESALER: "wholesalerMarketEnabled",
  DISTRIBUTOR: "distributorSourcingEnabled",
} as const;

/** Countries where a given account type may register right now (market switches). */
export async function registrationCountries(type: Exclude<CompanyType, "ADMIN">) {
  return prisma.country.findMany({
    where: { isActive: true, [MARKET_FLAG[type]]: true },
    select: { id: true, code: true, name: true, flag: true, vatPrefix: true, cities: { where: { isActive: true }, select: { id: true, name: true }, orderBy: { name: "asc" } } },
    orderBy: { code: "asc" },
  });
}

export function normaliseTaxId(countryCode: string, taxId: string) {
  return countryCode === "PT" ? taxId.replace(/\D/g, "") : taxId.replace(/[\s.-]/g, "").toUpperCase();
}

export async function registerCompany(input: CompanyRegistration) {
  if (!(await platformSettings()).registrations[input.type as "CUSTOMER" | "WHOLESALER" | "DISTRIBUTOR"])
    throw new ValidationError("New applications for this account type are paused. Please try again later.");
  const pilot = (await launchSettings()).pilot;
  if (pilot && !input.invite) throw new ValidationError("FIRINGI is open by invitation only during the pilot.", { invite: ["Invitation needed"] });
  const country = await prisma.country.findUnique({ where: { code: input.countryCode } });
  if (!country || !country.isActive || !country[MARKET_FLAG[input.type]])
    throw new ValidationError("Registration for this account type is not open in the selected country yet.", { countryCode: ["Not available"] });

  const taxId = normaliseTaxId(country.code, input.taxId);
  if (country.code === "PT" && !isValidPtNif(taxId)) throw new ValidationError("Invalid Portuguese NIF.", { taxId: ["Invalid NIF"] });
  if (taxId.length < 5) throw new ValidationError("Invalid tax ID.", { taxId: ["Invalid tax ID"] });

  // Every business (customer, wholesaler, distributor) gives its country-of-registration VAT number.
  const vatCheck = checkCompanyVat(input.vatNumber, country, taxId);
  if (!vatCheck.ok) throw new ValidationError(vatCheck.error, { vatNumber: [vatCheck.error] });
  const vat = vatCheck.vat;
  let activityCode: string | null = null;
  if (input.activityCode?.trim() || input.type === "CUSTOMER") {
    const { activityScheme, checkActivityCode } = await import("@/lib/activity-code");
    const a = checkActivityCode(input.activityCode, country.code);
    const sc = activityScheme(country.code);
    if (!a.ok) throw new ValidationError(`Enter your ${sc.name} code (e.g. ${sc.example}).`, { activityCode: [`${sc.name} e.g. ${sc.example}`] });
    activityCode = a.value;
  }

  if (input.headOffice.cityId) {
    const city = await prisma.city.findFirst({ where: { id: input.headOffice.cityId, countryId: country.id } });
    if (!city) throw new ValidationError("City does not belong to the selected country.", { cityId: ["Invalid city"] });
  }

  const ownerEmail = input.owner.email.trim().toLowerCase();
  if (await prisma.user.findUnique({ where: { email: ownerEmail } }))
    throw new AppError("EMAIL_TAKEN", "An account with this e-mail already exists. Please sign in.", 409);
  // One company, one NIF / VAT number: whatever the account type, a tax id is registered once.
  if (await prisma.company.findFirst({ where: { OR: [{ countryId: country.id, taxId }, { vatNumber: vat }] }, select: { id: true } }))
    throw new AppError("COMPANY_EXISTS", "A company with this NIF / VAT number is already registered on FIRINGI — one company, one NIF. Sign in to that account or contact FIRINGI support.", 409);

  const role = await prisma.role.findFirstOrThrow({ where: { companyId: null, key: "COMPANY_ADMIN" } });
  const passwordHash = await hashPassword(input.owner.password);

  const result = await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({ data: { email: ownerEmail, name: input.owner.name.trim(), phone: input.phone } });
    await tx.account.create({ data: { userId: user.id, accountId: user.id, providerId: "credential", password: passwordHash } });
    const company = await tx.company.create({
      data: {
        type: input.type,
        status: "PENDING",
        legalName: input.legalName.trim(),
        tradeName: input.tradeName?.trim() || null,
        taxId,
        vatNumber: vat,
        activityCode,
        countryId: country.id,
        email: input.companyEmail.trim().toLowerCase(),
        phone: input.phone,
        businessType: input.type === "CUSTOMER" ? input.businessType ?? null : null,
        defaultCurrencyCode: country.defaultCurrencyCode,
        defaultLanguageCode: country.defaultLanguageCode,
      },
    });
    await tx.membership.create({
      data: { userId: user.id, companyId: company.id, isOwner: true, roles: { create: { roleId: role.id } } },
    });
    const city = input.headOffice.cityId ? await tx.city.findFirst({ where: { id: input.headOffice.cityId, countryId: country.id }, select: { latitude: true, longitude: true } }) : null;
    await tx.address.create({
      data: {
        latitude: city?.latitude ?? null, longitude: city?.longitude ?? null,
        companyId: company.id, kind: "HEAD_OFFICE", label: "Head office", line1: input.headOffice.line1, line2: input.headOffice.line2 ?? null,
        postalCode: input.headOffice.postalCode, cityId: input.headOffice.cityId ?? null, cityName: input.headOffice.cityName,
        countryId: country.id, isDefault: true,
      },
    });
    if (pilot && input.invite) await consumeInvite(tx, input.invite, { type: input.type, countryCode: country.code, companyId: company.id });
    await tx.companyStatusHistory.create({ data: { companyId: company.id, toStatus: "PENDING", reason: pilot ? "Registration submitted (pilot invitation)" : "Registration submitted", byUserId: user.id } });
    await writeAudit({ actorUserId: user.id, actorCompanyId: company.id, action: "company.registered", entityType: "Company", entityId: company.id, after: { type: input.type, legalName: company.legalName, country: country.code } }, tx);
    return { userId: user.id, companyId: company.id };
  }).catch((e: unknown) => {
    // two sign-ups with the same NIF / VAT number at the same moment: the database keeps one company per tax id
    if ((e as { code?: string })?.code === "P2002") throw new AppError("COMPANY_EXISTS", "A company with this NIF / VAT number is already registered on FIRINGI — one company, one NIF. Sign in to that account or contact FIRINGI support.", 409);
    throw e;
  });

  await sendMail({
    to: ownerEmail,
    subject: "FIRINGI — application received",
    text: `Hello ${input.owner.name},\n\nWe received the application for ${input.legalName}. Please upload the requested documents and submit your application for review.\n\nFIRINGI`,
  });
  return result;
}

export type DriverRegistration = {
  name: string; email: string; password: string; phone: string; licenceNumber: string; licenceExpiry?: Date | null;
};

/** Independent drivers apply to join the FIRINGI fleet (vendor drivers are added by vendors in Phase 6). */
export async function registerDriver(input: DriverRegistration) {
  if (!(await platformSettings()).registrations.DRIVER) throw new ValidationError("New driver applications are paused. Please try again later.");
  const email = input.email.trim().toLowerCase();
  if (await prisma.user.findUnique({ where: { email } })) throw new AppError("EMAIL_TAKEN", "An account with this e-mail already exists. Please sign in.", 409);
  const firingi = await prisma.company.findFirstOrThrow({ where: { type: "ADMIN" }, orderBy: { createdAt: "asc" } });
  const role = await prisma.role.findFirstOrThrow({ where: { companyId: null, key: "ADMIN_DRIVER" } });
  const passwordHash = await hashPassword(input.password);
  return prisma.$transaction(async (tx) => {
    const user = await tx.user.create({ data: { email, name: input.name.trim(), phone: input.phone } });
    await tx.account.create({ data: { userId: user.id, accountId: user.id, providerId: "credential", password: passwordHash } });
    await tx.membership.create({ data: { userId: user.id, companyId: firingi.id, jobTitle: "Driver (applicant)", roles: { create: { roleId: role.id } } } });
    const driver = await tx.driver.create({
      data: { userId: user.id, ownerCompanyId: firingi.id, licenceNumber: input.licenceNumber.trim(), licenceExpiry: input.licenceExpiry ?? null, status: "PENDING" },
    });
    await writeAudit({ actorUserId: user.id, actorCompanyId: firingi.id, action: "driver.registered", entityType: "Driver", entityId: driver.id }, tx);
    return { userId: user.id, driverId: driver.id };
  });
}
