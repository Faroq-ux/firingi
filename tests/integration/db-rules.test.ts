/**
 * Rules enforced by the DATABASE itself (triggers / CHECKs) — they hold even if
 * application code is bypassed.
 */
import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { companyId, makeOffers } from "../helpers";

afterAll(() => prisma.$disconnect());

const DIST_PT = "Distribuidora Atlântico, Lda";
const WHS_LX = "Grossista Lisboa Central, Lda";
const WHS_PORTO = "Grossista Porto Norte, Lda";
const KEBAB = "Kebab House Lisboa, Lda";

async function cartFor(buyer: string, email: string) {
  const user = await prisma.user.findUniqueOrThrow({ where: { email } });
  const buyerCompanyId = await companyId(buyer);
  await prisma.cartItem.deleteMany({ where: { cart: { buyerCompanyId, userId: user.id } } });
  return prisma.cart.upsert({
    where: { buyerCompanyId_userId: { buyerCompanyId, userId: user.id } },
    update: {},
    create: { buyerCompanyId, userId: user.id },
  });
}

describe("vendor offers", () => {
  it("sellerType is forced to the vendor's real company type", async () => {
    const offers = await makeOffers([DIST_PT]);
    const offer = await prisma.vendorOffer.findUniqueOrThrow({ where: { id: offers[DIST_PT] } });
    expect(offer.sellerType).toBe("DISTRIBUTOR"); // fixture tried to write WHOLESALER
  });

  it("customers cannot create offers", async () => {
    await expect(makeOffers([KEBAB])).rejects.toThrow(/OFFER_VENDOR_INVALID/);
  });

  it("a company's type can never change", async () => {
    await expect(prisma.company.update({ where: { id: await companyId(DIST_PT) }, data: { type: "WHOLESALER" } })).rejects.toThrow(
      /COMPANY_TYPE_IMMUTABLE/,
    );
  });
});

describe("cart rules (checklist: customer never buys from distributors; one vendor per cart)", () => {
  it("customer cannot put a distributor product in the cart", async () => {
    const offers = await makeOffers([DIST_PT]);
    const cart = await cartFor(KEBAB, "owner@kebabhouse.test");
    await expect(prisma.cartItem.create({ data: { cartId: cart.id, offerId: offers[DIST_PT], qty: 1 } })).rejects.toThrow(/SELLER_NOT_ALLOWED/);
  });

  it("customer cannot mix two wholesalers in one cart, and the cart unlocks when emptied", async () => {
    const offers = await makeOffers([WHS_LX, WHS_PORTO]);
    const cart = await cartFor(KEBAB, "owner@kebabhouse.test");
    await prisma.cartItem.create({ data: { cartId: cart.id, offerId: offers[WHS_LX], qty: 2 } });
    expect((await prisma.cart.findUniqueOrThrow({ where: { id: cart.id } })).sellerCompanyId).toBe(await companyId(WHS_LX));

    await expect(prisma.cartItem.create({ data: { cartId: cart.id, offerId: offers[WHS_PORTO], qty: 1 } })).rejects.toThrow(/CART_SELLER_MISMATCH/);

    await prisma.cartItem.deleteMany({ where: { cartId: cart.id } });
    expect((await prisma.cart.findUniqueOrThrow({ where: { id: cart.id } })).sellerCompanyId).toBeNull();
    await prisma.cartItem.create({ data: { cartId: cart.id, offerId: offers[WHS_PORTO], qty: 1 } });
  });

  it("wholesaler buys from distributors only", async () => {
    const offers = await makeOffers([DIST_PT, WHS_PORTO]);
    const cart = await cartFor(WHS_LX, "purchasing@lisboacentral.test");
    await expect(prisma.cartItem.create({ data: { cartId: cart.id, offerId: offers[WHS_PORTO], qty: 1 } })).rejects.toThrow(/SELLER_NOT_ALLOWED/);
    await prisma.cartItem.create({ data: { cartId: cart.id, offerId: offers[DIST_PT], qty: 1 } });
  });
});

describe("append-only history", () => {
  it("audit log rows cannot be updated or deleted", async () => {
    const row = await prisma.auditLog.create({ data: { action: "test.event", entityType: "Test" } });
    await expect(prisma.auditLog.update({ where: { id: row.id }, data: { action: "tampered" } })).rejects.toThrow(/APPEND_ONLY/);
    await expect(prisma.auditLog.delete({ where: { id: row.id } })).rejects.toThrow(/APPEND_ONLY/);
  });
});

describe("invoices", () => {
  it("issued invoices cannot be modified or deleted; drafts can", async () => {
    const entity = await prisma.legalEntity.findFirstOrThrow();
    const recipientCompanyId = await companyId(KEBAB);
    const base = {
      legalEntityId: entity.id, docType: "INVOICE" as const, recipientCompanyId, issuerSnapshot: {}, recipientSnapshot: {},
      netTotal: 100, vatTotal: 23, grossTotal: 123,
    };
    const draft = await prisma.invoice.create({ data: base });
    await prisma.invoice.update({ where: { id: draft.id }, data: { netTotal: 90 } });
    await prisma.invoice.delete({ where: { id: draft.id } });

    const issued = await prisma.invoice.create({ data: { ...base, status: "ISSUED", fullNumber: `FT TEST/${Date.now()}`, number: 1, issuedAt: new Date() } });
    await expect(prisma.invoice.update({ where: { id: issued.id }, data: { grossTotal: 1 } })).rejects.toThrow(/INVOICE_IMMUTABLE/);
    await expect(prisma.invoice.update({ where: { id: issued.id }, data: { status: "DRAFT" } })).rejects.toThrow(/INVOICE_IMMUTABLE/);
    await expect(prisma.invoice.delete({ where: { id: issued.id } })).rejects.toThrow(/INVOICE_IMMUTABLE/);
    await expect(
      prisma.invoiceLine.create({ data: { invoiceId: issued.id, position: 1, description: "x", qty: 1, unitPriceNet: 1, taxRate: 23, lineNet: 1, lineVat: 0.23 } }),
    ).rejects.toThrow(/INVOICE_IMMUTABLE/);
    // Allowed: status moves to credited, PDF key attached.
    await prisma.invoice.update({ where: { id: issued.id }, data: { status: "CREDITED", pdfKey: "invoices/x.pdf" } });
  });
});

describe("commission & promotions", () => {
  it("commission rules can be closed but never rewritten or deleted", async () => {
    const rule = await prisma.commissionRule.create({ data: { vendorCompanyId: await companyId(WHS_LX), rate: 8 } });
    await expect(prisma.commissionRule.update({ where: { id: rule.id }, data: { rate: 5 } })).rejects.toThrow(/COMMISSION_HISTORY/);
    await expect(prisma.commissionRule.delete({ where: { id: rule.id } })).rejects.toThrow(/COMMISSION_HISTORY/);
    await prisma.commissionRule.update({ where: { id: rule.id }, data: { validTo: new Date() } });
    await expect(prisma.commissionRule.create({ data: { vendorCompanyId: await companyId(WHS_LX), rate: 150 } })).rejects.toThrow();
  });

  it("vendor promotions must be 100% vendor-funded; admin splits must sum to 100", async () => {
    const vendor = await companyId(WHS_LX);
    const common = { name: { en: "Promo" }, kind: "PERCENT" as const, value: 10, validFrom: new Date() };
    await expect(
      prisma.promotion.create({ data: { ...common, ownerType: "VENDOR", ownerCompanyId: vendor, firingiFundPct: 50, vendorFundPct: 50 } }),
    ).rejects.toThrow(/vendor_promotion_vendor_funded/);
    await expect(prisma.promotion.create({ data: { ...common, ownerType: "ADMIN", firingiFundPct: 60, vendorFundPct: 60 } })).rejects.toThrow(
      /promotion_funding_sums_to_100/,
    );
    const split = await prisma.promotion.create({ data: { ...common, ownerType: "ADMIN", firingiFundPct: 50, vendorFundPct: 50 } });
    expect(Number(split.firingiFundPct)).toBe(50);
  });
});
