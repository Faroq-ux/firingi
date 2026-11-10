/**
 * Phase 11: payment settings and credit control at checkout.
 */
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { addToCart, cartView, clearCart } from "@/server/services/cart";
import { placeOrder } from "@/server/services/orders";
import { setStock } from "@/server/services/vendor-catalogue";
import { DEFAULT_PAYMENTS, applyBuyerDefaults, creditStatuses, paymentInstructions, paymentPolicy, paymentRisk, setPaymentPolicy } from "@/server/services/payments";
import { ctxFor } from "../helpers";

const SA = "superadmin@firingi.test";
let kebabId = "";
afterEach(async () => {
  await prisma.setting.deleteMany({ where: { key: "payments.policy" } });
  if (kebabId) await prisma.company.update({ where: { id: kebabId }, data: { creditLimit: null } });
});
afterAll(() => prisma.$disconnect());

async function cartOf(qty: number) {
  const kebab = await ctxFor("owner@kebabhouse.test");
  kebabId = kebab.company.id;
  const lx = await ctxFor("owner@lisboacentral.test");
  const offer = await prisma.vendorOffer.findFirstOrThrow({ where: { vendorCompanyId: lx.company.id, packaging: { variant: { sku: "FIR-MOZZ2" }, unitsPerPack: 1 } } });
  const wh = await prisma.address.findFirstOrThrow({ where: { companyId: lx.company.id, kind: { in: ["WAREHOUSE", "PICKUP"] } } });
  await setStock(lx, offer.id, wh.id, 900);
  await clearCart(kebab);
  await addToCart(kebab, offer.id, qty);
  const addr = await prisma.address.findFirstOrThrow({ where: { companyId: kebab.company.id, kind: "DELIVERY", isActive: true } });
  return { kebab, addr };
}

describe("payment settings", () => {
  it("defaults, validation and who may change them", async () => {
    expect(await paymentPolicy()).toEqual(DEFAULT_PAYMENTS);
    const sa = await ctxFor(SA);
    await expect(setPaymentPolicy(sa, { ...DEFAULT_PAYMENTS, methods: { ...DEFAULT_PAYMENTS.methods, BANK_TRANSFER: false } })).rejects.toThrow(/at least one/);
    await expect(setPaymentPolicy(sa, { ...DEFAULT_PAYMENTS, methods: { ...DEFAULT_PAYMENTS.methods, MB_WAY: true } })).rejects.toThrow(/MB WAY/);
    await expect(setPaymentPolicy(await ctxFor("sales@firingi.test"), DEFAULT_PAYMENTS)).rejects.toThrow();
    const saved = await setPaymentPolicy(sa, { ...DEFAULT_PAYMENTS, methods: { ...DEFAULT_PAYMENTS.methods, MB_WAY: true, CARD: true }, mbWayPhone: "+351 912 345 678" });
    expect(saved.methods.CARD).toBe(false); // needs a provider
    expect(saved.mbWayPhone).toBe("+351912345678");
    const pt = await prisma.country.findUniqueOrThrow({ where: { code: "PT" } });
    const how = await paymentInstructions(pt.id);
    expect(how.mbWay).toEqual({ phone: "+351912345678" });
    expect(how.bankTransfer?.iban).toBeTruthy();
  });

  it("approved buyers get the default terms and limit (only where unset)", async () => {
    const sa = await ctxFor(SA);
    await setPaymentPolicy(sa, { ...DEFAULT_PAYMENTS, defaultTermsDays: { CUSTOMER: 7, WHOLESALER: 30 }, defaultCreditLimit: { CUSTOMER: 2500, WHOLESALER: null } });
    const pt = await prisma.country.findUniqueOrThrow({ where: { code: "PT" } });
    const c = await prisma.company.create({ data: { type: "CUSTOMER", legalName: `Temp ${Date.now()}`, taxId: String(Date.now()).slice(-9), countryId: pt.id, email: "t@t.test" } });
    await prisma.$transaction((tx) => applyBuyerDefaults(tx, c.id));
    expect(await prisma.company.findUniqueOrThrow({ where: { id: c.id } })).toMatchObject({ paymentTermsDays: 7 });
    expect(Number((await prisma.company.findUniqueOrThrow({ where: { id: c.id } })).creditLimit)).toBe(2500);
  });
});

describe("credit control at checkout", () => {
  it("credit limit: the cart warns and checkout is refused above the available credit", async () => {
    const { kebab, addr } = await cartOf(20);
    const [before] = await creditStatuses([kebab.company.id]);
    await prisma.company.update({ where: { id: kebab.company.id }, data: { creditLimit: before.exposure + 50 } });
    const view = await cartView(kebab);
    expect(view.credit).toMatchObject({ code: "CREDIT_LIMIT" });
    await expect(placeOrder(kebab, { deliveryAddressId: addr.id })).rejects.toThrow(/above your available credit/);
    // off → allowed
    await setPaymentPolicy(await ctxFor(SA), { ...DEFAULT_PAYMENTS, creditCheck: false });
    expect((await cartView(kebab)).credit).toBeNull();
  });

  it("overdue invoices block new orders after the grace period", async () => {
    const { kebab, addr } = await cartOf(10);
    const inv = await prisma.invoice.findFirst({ where: { recipientCompanyId: kebab.company.id, docType: "INVOICE", status: "ISSUED" } });
    if (!inv) return; // no invoice in this database yet (other suites create them)
    const due = inv.dueAt;
    await prisma.invoice.update({ where: { id: inv.id }, data: { dueAt: new Date(Date.now() - 40 * 86400_000) } });
    try {
      const [s] = await creditStatuses([kebab.company.id]);
      if (s.overdue === 0) return; // already paid
      expect(s.oldestOverdueDays).toBeGreaterThanOrEqual(40);
      expect((await cartView(kebab)).credit).toMatchObject({ code: "PAYMENT_OVERDUE" });
      await expect(placeOrder(kebab, { deliveryAddressId: addr.id })).rejects.toThrow(/overdue for \d+ days/);
      await setPaymentPolicy(await ctxFor(SA), { ...DEFAULT_PAYMENTS, overdueBlockDays: null });
      expect((await cartView(kebab)).credit).toBeNull();
      expect((await paymentRisk(await ctxFor("finance@firingi.test"))).find((r) => r.id === kebab.company.id)?.status).toBe("OVERDUE");
    } finally {
      await prisma.invoice.update({ where: { id: inv.id }, data: { dueAt: due } });
    }
  });

  it("payment risk is FIRINGI-only", async () => {
    await expect(paymentRisk(await ctxFor("owner@kebabhouse.test"))).rejects.toThrow();
    const rows = await paymentRisk(await ctxFor(SA));
    expect(rows.every((r) => r.type === "CUSTOMER" || r.type === "WHOLESALER")).toBe(true);
  });
});
