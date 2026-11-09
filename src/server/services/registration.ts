/**
 * Self-registration for distributors, wholesalers, wholesale customers and drivers.
 * Every new account starts PENDING and needs FIRINGI approval before it can trade.
 */
import type { CompanyType } from "@prisma/client";
import { hashPassword } from "better-auth/crypto";
import { prisma } from "@/server/db";
import { AppError, ValidationError } from "@/server/errors";
import { isValidPtNif, looksLikeEuVat } from "@/lib/tax-id";
import { writeAudit } from "./audit";
import { sendMail } from "./mailer";

export type CompanyRegistration = {
  type: Exclude<CompanyType, "ADMIN">;
  countryCode: string;
  legalName: string;
  tradeName?: string | null;
  taxId: string;
  vatNumber?: string | null;
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
  const country = await prisma.country.findUnique({ where: { code: input.countryCode } });
  if (!country || !country.isActive || !country[MARKET_FLAG[input.type]])
    throw new ValidationError("Registration for this account type is not open in the selected country yet.", { countryCode: ["Not available"] });

  const taxId = normaliseTaxId(country.code, input.taxId);
  if (country.code === "PT" && !isValidPtNif(taxId)) throw new ValidationError("Invalid Portuguese NIF.", { taxId: ["Invalid NIF"] });
  if (taxId.length < 5) throw new ValidationError("Invalid tax ID.", { taxId: ["Invalid tax ID"] });

  const vat = input.vatNumber ? input.vatNumber.replace(/[\s.-]/g, "").toUpperCase() : null;
  if (input.type === "DISTRIBUTOR" && !vat) throw new ValidationError("Distributors must provide an EU VAT number.", { vatNumber: ["Required"] });
  if (vat && (!looksLikeEuVat(vat) || !vat.startsWith(country.vatPrefix ?? country.code)))
    throw new ValidationError(`VAT number must start with ${country.vatPrefix ?? country.code}.`, { vatNumber: ["Invalid VAT number"] });

  if (input.headOffice.cityId) {
    const city = await prisma.city.findFirst({ where: { id: input.headOffice.cityId, countryId: country.id } });
    if (!city) throw new ValidationError("City does not belong to the selected country.", { cityId: ["Invalid city"] });
  }

  const ownerEmail = input.owner.email.trim().toLowerCase();
  if (await prisma.user.findUnique({ where: { email: ownerEmail } }))
    throw new AppError("EMAIL_TAKEN", "An account with this e-mail already exists. Please sign in.", 409);
  if (await prisma.company.findFirst({ where: { countryId: country.id, taxId, type: input.type } }))
    throw new AppError("COMPANY_EXISTS", "This company is already registered for this account type. Contact FIRINGI support.", 409);

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
    await tx.address.create({
      data: {
        companyId: company.id, kind: "HEAD_OFFICE", label: "Head office", line1: input.headOffice.line1, line2: input.headOffice.line2 ?? null,
        postalCode: input.headOffice.postalCode, cityId: input.headOffice.cityId ?? null, cityName: input.headOffice.cityName,
        countryId: country.id, isDefault: true,
      },
    });
    await tx.companyStatusHistory.create({ data: { companyId: company.id, toStatus: "PENDING", reason: "Registration submitted", byUserId: user.id } });
    await writeAudit({ actorUserId: user.id, actorCompanyId: company.id, action: "company.registered", entityType: "Company", entityId: company.id, after: { type: input.type, legalName: company.legalName, country: country.code } }, tx);
    return { userId: user.id, companyId: company.id };
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
