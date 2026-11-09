import { prisma } from "@/server/db";
import { loadContext } from "@/server/context";

/** Build the request context of a seeded user (as if they were signed in). */
export async function ctxFor(email: string, companyLegalName?: string) {
  const user = await prisma.user.findUniqueOrThrow({ where: { email } });
  const company = companyLegalName ? await prisma.company.findFirstOrThrow({ where: { legalName: companyLegalName } }) : null;
  const ctx = await loadContext(user.id, "test-session", company?.id);
  if (!ctx) throw new Error(`no context for ${email}`);
  return ctx;
}

export async function companyId(legalName: string) {
  return (await prisma.company.findFirstOrThrow({ where: { legalName } })).id;
}

/** Minimal catalogue fixture: one product, one packaging unit, one offer per given vendor. */
export async function makeOffers(vendorNames: string[]) {
  const category = await prisma.category.findUniqueOrThrow({ where: { slug: "soft-drinks" } });
  const taxCat = await prisma.taxCategory.findUniqueOrThrow({ where: { code: "STANDARD" } });
  const pt = await prisma.country.findUniqueOrThrow({ where: { code: "PT" } });
  const suffix = Math.random().toString(36).slice(2, 8);
  const product = await prisma.product.create({
    data: {
      categoryId: category.id, taxCategoryId: taxCat.id, name: { en: `Cola ${suffix}` }, status: "APPROVED",
      variants: { create: { sku: `COLA-${suffix}`, packagings: { create: { uomCode: "CX", name: { en: "Case 24" }, unitsPerPack: 24 } } } },
    },
    include: { variants: { include: { packagings: true } } },
  });
  const packagingUnitId = product.variants[0].packagings[0].id;
  const offers: Record<string, string> = {};
  for (const name of vendorNames) {
    const vendorCompanyId = await companyId(name);
    // sellerType is deliberately WRONG here — the DB trigger must correct it.
    const o = await prisma.vendorOffer.create({
      data: { vendorCompanyId, packagingUnitId, countryId: pt.id, sellerType: "WHOLESALER", status: "ACTIVE" },
    });
    offers[name] = o.id;
  }
  return offers;
}

/** Small but real files (correct magic bytes) for upload tests. */
export const pdfFile = (name = "doc.pdf") => new File([Buffer.from("%PDF-1.4\n% test document\n%%EOF")], name, { type: "application/pdf" });
export const pngFile = (name = "img.png") =>
  new File([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])], name, { type: "image/png" });
export const fakePdf = () => new File([Buffer.from("MZ this is really an exe")], "evil.pdf", { type: "application/pdf" });

let seq = 0;
/** Unique valid-looking PT NIF for each test registration. */
export async function freshNif() {
  const { makePtNif } = await import("@/lib/tax-id");
  return makePtNif(String(52000000 + Date.now() % 900000 + ++seq).slice(0, 8));
}
