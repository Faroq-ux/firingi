"use server";
/** Registration and applicant self-service actions. */
import { z } from "zod";
import { headers, cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { auth } from "@/server/auth/auth";
import { AppError, fromDbError } from "@/server/errors";
import { LOCALE_COOKIE } from "@/i18n/config";
import { registerCompany, registerDriver } from "@/server/services/registration";
import { updateOwnProfile, submitForReview } from "@/server/services/company";
import { saveAddress, removeAddress } from "@/server/services/addresses";
import { uploadCompanyDocument, uploadOwnDriverDocument, deleteOwnDocument } from "@/server/services/documents";
import { requestRestrictionAccess } from "@/server/services/restrictions";
import { defineAction, runAction, type ActionResult } from "./_action";

const password = z.string().min(10, "At least 10 characters").max(128);
const phone = z.string().trim().min(6, "Enter a phone number").max(30);

const companySchema = z.object({
  type: z.enum(["DISTRIBUTOR", "WHOLESALER", "CUSTOMER"]),
  countryCode: z.string().length(2),
  legalName: z.string().trim().min(2).max(200),
  tradeName: z.string().trim().max(200).optional().nullable(),
  taxId: z.string().trim().min(5).max(20),
  vatNumber: z.string().trim().max(20).optional().nullable(),
  companyEmail: z.string().trim().email(),
  phone,
  businessType: z.string().max(40).optional().nullable(),
  ownerName: z.string().trim().min(2).max(120),
  ownerEmail: z.string().trim().email(),
  password,
  line1: z.string().trim().min(3).max(200),
  line2: z.string().trim().max(200).optional().nullable(),
  postalCode: z.string().trim().min(3).max(12),
  cityId: z.string().optional().nullable(),
  cityName: z.string().trim().min(2).max(100),
  acceptTerms: z.literal(true, { errorMap: () => ({ message: "You must accept the terms" }) }),
});

async function signInAfterRegistration(email: string, pw: string, locale: string) {
  await auth.api.signInEmail({ body: { email, password: pw }, headers: await headers() });
  (await cookies()).set(LOCALE_COOKIE, locale, { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" });
}

/** Public: not wrapped in defineAction because the caller is not signed in yet. */
export async function registerCompanyAction(raw: z.input<typeof companySchema>): Promise<ActionResult<{ redirectTo: string }>> {
  const parsed = companySchema.safeParse(raw);
  if (!parsed.success)
    return { ok: false, code: "VALIDATION", error: "Please check the highlighted fields.", fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]> };
  const i = parsed.data;
  try {
    await registerCompany({
      type: i.type, countryCode: i.countryCode, legalName: i.legalName, tradeName: i.tradeName, taxId: i.taxId, vatNumber: i.vatNumber,
      companyEmail: i.companyEmail, phone: i.phone, businessType: i.businessType,
      owner: { name: i.ownerName, email: i.ownerEmail, password: i.password },
      headOffice: { line1: i.line1, line2: i.line2, postalCode: i.postalCode, cityId: i.cityId, cityName: i.cityName },
    });
    await signInAfterRegistration(i.ownerEmail.toLowerCase(), i.password, i.countryCode === "PT" ? "pt-PT" : i.countryCode === "ES" ? "es" : "en");
    return { ok: true, data: { redirectTo: "/application-status" } };
  } catch (e) {
    const err = e instanceof AppError ? e : fromDbError(e);
    if (err) return { ok: false, code: err.code, error: err.message, fieldErrors: (err as { fieldErrors?: Record<string, string[]> }).fieldErrors };
    console.error(e);
    return { ok: false, code: "INTERNAL", error: "Something went wrong. Please try again." };
  }
}

const driverSchema = z.object({
  name: z.string().trim().min(2).max(120), email: z.string().trim().email(), password, phone,
  licenceNumber: z.string().trim().min(4).max(30), licenceExpiry: z.string().optional().nullable(),
  acceptTerms: z.literal(true, { errorMap: () => ({ message: "You must accept the terms" }) }),
});

export async function registerDriverAction(raw: z.input<typeof driverSchema>): Promise<ActionResult<{ redirectTo: string }>> {
  const parsed = driverSchema.safeParse(raw);
  if (!parsed.success)
    return { ok: false, code: "VALIDATION", error: "Please check the highlighted fields.", fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]> };
  try {
    const i = parsed.data;
    await registerDriver({ ...i, licenceExpiry: i.licenceExpiry ? new Date(i.licenceExpiry) : null });
    await signInAfterRegistration(i.email.toLowerCase(), i.password, "pt-PT");
    return { ok: true, data: { redirectTo: "/application-status" } };
  } catch (e) {
    const err = e instanceof AppError ? e : fromDbError(e);
    if (err) return { ok: false, code: err.code, error: err.message };
    console.error(e);
    return { ok: false, code: "INTERNAL", error: "Something went wrong. Please try again." };
  }
}

export const updateProfileAction = defineAction({
  permission: "company.profile.manage",
  schema: z.object({
    legalName: z.string().trim().min(2).max(200).optional(),
    tradeName: z.string().trim().max(200).optional().nullable(),
    vatNumber: z.string().trim().max(20).optional().nullable(),
    email: z.string().trim().email(),
    phone: z.string().trim().max(30).optional().nullable(),
    website: z.string().trim().max(200).optional().nullable(),
    businessType: z.string().max(40).optional().nullable(),
  }),
  handler: async (ctx, input) => {
    await updateOwnProfile(ctx, input);
    revalidatePath("/", "layout");
    return null;
  },
});

export const saveAddressAction = defineAction({
  permission: null, // checked per address kind in the service
  schema: z.object({
    id: z.string().optional(),
    kind: z.enum(["HEAD_OFFICE", "BILLING", "WAREHOUSE", "PICKUP", "DELIVERY"]),
    label: z.string().trim().min(1).max(80),
    line1: z.string().trim().min(3).max(200),
    line2: z.string().trim().max(200).optional().nullable(),
    postalCode: z.string().trim().min(3).max(12),
    countryCode: z.string().length(2),
    cityId: z.string().optional().nullable(),
    cityName: z.string().trim().min(2).max(100),
    contactName: z.string().trim().max(120).optional().nullable(),
    phone: z.string().trim().max(30).optional().nullable(),
    isDefault: z.boolean().optional(),
  }),
  handler: async (ctx, input) => {
    const a = await saveAddress(ctx, input);
    revalidatePath("/", "layout");
    return { id: a.id };
  },
});

export const removeAddressAction = defineAction({
  permission: null,
  schema: z.object({ id: z.string() }),
  handler: async (ctx, { id }) => {
    await removeAddress(ctx, id);
    revalidatePath("/", "layout");
    return null;
  },
});

const docType = z.enum([
  "BUSINESS_REGISTRATION", "TAX_ID_CERTIFICATE", "TRADE_LICENCE", "ID_DOCUMENT", "DRIVING_LICENCE", "CONTRACT", "OTHER",
]);
const optDate = (v: FormDataEntryValue | null) => (typeof v === "string" && v ? new Date(v) : null);

export async function uploadDocumentAction(fd: FormData) {
  return runAction(async (ctx) => {
    const type = docType.parse(fd.get("type"));
    const file = fd.get("file") as File;
    const target = fd.get("target");
    const doc = target === "driver"
      ? await uploadOwnDriverDocument(ctx, { type, file, expiresAt: optDate(fd.get("expiresAt")) })
      : await uploadCompanyDocument(ctx, { type, file, expiresAt: optDate(fd.get("expiresAt")) });
    revalidatePath("/", "layout");
    return { id: doc.id };
  });
}

export const deleteDocumentAction = defineAction({
  permission: null,
  schema: z.object({ id: z.string() }),
  handler: async (ctx, { id }) => {
    await deleteOwnDocument(ctx, id);
    revalidatePath("/", "layout");
    return null;
  },
});

export const submitApplicationAction = defineAction({
  permission: null,
  schema: z.object({}),
  handler: async (ctx) => {
    await submitForReview(ctx);
    revalidatePath("/", "layout");
    return null;
  },
});

export async function requestRestrictionAction(fd: FormData) {
  return runAction(async (ctx) => {
    const input = z
      .object({
        restriction: z.enum(["TOBACCO", "ALCOHOL"]),
        licenceNumber: z.string().trim().min(3).max(60),
        issuingAuthority: z.string().trim().min(2).max(120),
      })
      .parse({ restriction: fd.get("restriction"), licenceNumber: fd.get("licenceNumber"), issuingAuthority: fd.get("issuingAuthority") });
    const a = await requestRestrictionAccess(ctx, { ...input, validUntil: optDate(fd.get("validUntil")), file: fd.get("file") as File });
    revalidatePath("/", "layout");
    return { id: a.id };
  });
}
