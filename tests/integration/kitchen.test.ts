/**
 * Phase 54: menu costing & food waste — FIRINGI's switches; ingredients from what the business paid on FIRINGI (cost
 * per kg from the pack) and by hand; dishes with sub-recipes, yield, food cost %, target, suggested price, allergens;
 * loops refused; what-if price rise; menu engineering; the waste log (ingredient, dish, free text, a purchased lot
 * whose used quantity goes up) and donations; reports against the target; use-first and order-less suggestions; the
 * job's price-rise alert; staff who only log waste; dishes imported from the till.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { addToCart, clearCart } from "@/server/services/cart";
import { confirmOrder, placeOrder } from "@/server/services/orders";
import { setStock } from "@/server/services/vendor-catalogue";
import * as K from "@/server/kitchen/service";
import { DEFAULT_KITCHEN_SETTINGS, type KitchenSettings } from "@/lib/kitchen";
import { ctxFor } from "../helpers";

const SA = "superadmin@firingi.test", OWNER = "owner@kebabhouse.test", STAFF = "buyer@kebabhouse.test", LX = "owner@lisboacentral.test";
let co = "", orderId = "", offerId = "", productId = "", packPrice = 0, lotId = "", posItemId = "";

async function settings(p: Partial<KitchenSettings> = {}) { return K.saveKitchenSettings(await ctxFor(SA), { ...DEFAULT_KITCHEN_SETTINGS, ...p }); }
async function clean() {
  await prisma.kitchenWaste.deleteMany({ where: { companyId: co } });
  await prisma.kitchenRecipeLine.deleteMany({ where: { recipe: { companyId: co } } });
  await prisma.kitchenRecipe.deleteMany({ where: { companyId: co } });
  await prisma.kitchenIngredient.deleteMany({ where: { companyId: co } });
  await prisma.kitchenProfile.deleteMany({ where: { companyId: co } });
}

beforeAll(async () => {
  await prisma.setting.deleteMany({ where: { key: "kitchen.settings" } });
  await prisma.companyFeature.deleteMany({ where: { key: "KITCHEN" } });
  const owner = await ctxFor(OWNER), lx = await ctxFor(LX);
  co = owner.company.id;
  await clean();
  await clearCart(owner);
  const offer = await prisma.vendorOffer.findFirstOrThrow({ where: { vendorCompanyId: lx.company.id, status: "ACTIVE", packaging: { variant: { sku: "FIR-MOZZ2" }, unitsPerPack: 1 } }, include: { packaging: { include: { variant: true } } } });
  offerId = offer.id; productId = offer.packaging.variant.productId;
  const wh = await prisma.address.findFirstOrThrow({ where: { companyId: lx.company.id, kind: { in: ["WAREHOUSE", "PICKUP"] } } });
  const cur = await prisma.stockLevel.findUnique({ where: { offerId_addressId: { offerId, addressId: wh.id } } });
  await setStock(lx, offerId, wh.id, Math.max(800, (cur?.reserved ?? 0) + 500));
  await addToCart(owner, offerId, 6);
  const addr = await prisma.address.findFirstOrThrow({ where: { companyId: co, kind: "DELIVERY", isActive: true }, orderBy: { isDefault: "desc" } });
  orderId = ((await placeOrder(owner, { deliveryAddressId: addr.id })) as { id: string }).id;
  await confirmOrder(lx, orderId, {});
  packPrice = Number((await prisma.orderLine.findFirstOrThrow({ where: { orderId, offerId } })).unitSalePriceNet);
  const tomorrow = new Date(Date.now() + 86_400_000);
  lotId = (await prisma.purchasedLot.create({ data: { buyerCompanyId: co, orderId, offerId, packagingUnitId: offer.packagingUnitId, lotCode: "K-LOT-1", expiresOn: tomorrow, qty: 4 } })).id;
});
afterAll(async () => {
  await clean();
  await prisma.purchasedLot.deleteMany({ where: { id: lotId } });
  if (posItemId) await prisma.posItem.deleteMany({ where: { id: posItemId } });
  await prisma.setting.deleteMany({ where: { key: "kitchen.settings" } });
  await prisma.companyFeature.deleteMany({ where: { key: "KITCHEN" } });
  await prisma.$disconnect();
});

describe("menu costing & food waste", () => {
  it("FIRINGI switches it: the whole feature, the business type, each business, each part", async () => {
    const owner = await ctxFor(OWNER), sa = await ctxFor(SA);
    expect(await K.listIngredients(owner)).toEqual([]);
    await settings({ types: { CUSTOMER: false, WHOLESALER: false } });
    await expect(K.listIngredients(owner)).rejects.toThrow(/not available/);
    await K.setKitchenSwitch(sa, co, "ON");
    expect(await K.listIngredients(owner)).toEqual([]);
    await K.setKitchenSwitch(sa, co, "DEFAULT");
    await settings({ parts: { ...DEFAULT_KITCHEN_SETTINGS.parts, engineering: false } });
    await expect(K.menuEngineering(owner)).rejects.toThrow(/switched this part off/);
    await settings();
    await expect(K.listIngredients(await ctxFor(STAFF))).rejects.toThrow(); // staff log waste only
  });

  it("an ingredient bought on FIRINGI costs what the business paid, per kg of the pack", async () => {
    const owner = await ctxFor(OWNER);
    const p = (await K.purchasedProducts(owner)).find((x) => x.productId === productId)!;
    expect(p).toBeTruthy();
    expect(p.guess.unit).toBe("KG");
    await K.addIngredientFromPurchase(owner, { productId, name: "Mozzarella", unit: "KG", packSize: 2 });
    const m = (await K.listIngredients(owner)).find((x) => x.name === "Mozzarella")!;
    expect(m.cost).toBeCloseTo(packPrice / 2, 4);
    expect(m.costBasis).toBe("LAST");
    expect(m.source).toBe("FIRINGI");
  });

  it("dishes: sub-recipes, yield, food cost %, target, suggested price, allergens; loops refused", async () => {
    const owner = await ctxFor(OWNER);
    const pita = await K.saveIngredient(owner, { id: null, name: "Pita", unit: "PCS", manualCost: 0.25, supplierName: "Padaria", yieldPct: 100, allergens: ["GLUTEN", "XX"], allergensOwn: true, co2PerUnit: 0.1, packSize: null, active: true });
    const tom = await K.saveIngredient(owner, { id: null, name: "Tomato", unit: "KG", manualCost: 2, supplierName: null, yieldPct: 80, allergens: [], allergensOwn: true, co2PerUnit: null, packSize: null, active: true });
    await expect(K.saveIngredient(owner, { id: null, name: "Salt", unit: "KG", manualCost: null, supplierName: null, yieldPct: 100, allergens: [], allergensOwn: true, co2PerUnit: null, packSize: null, active: true })).rejects.toThrow(/cost/);
    const mozz = (await K.listIngredients(owner)).find((x) => x.name === "Mozzarella")!;
    const sauce = await K.saveRecipe(owner, { id: null, name: "Tomato sauce", kind: "SUB", category: null, posItemId: null, yieldQty: 1, yieldUnit: "KG", priceGross: null, vatRate: 13, targetPct: null, soldPerWeek: null, notes: null, active: true, lines: [{ ingredientId: tom.id, subRecipeId: null, qty: 1.2, unit: "KG" }] });
    const pizza = await K.saveRecipe(owner, {
      id: null, name: "Pizza Margherita", kind: "DISH", category: "Pizza", posItemId: null, yieldQty: 1, yieldUnit: null, priceGross: 5, vatRate: 13, targetPct: null, soldPerWeek: 120, notes: null, active: true,
      lines: [{ ingredientId: mozz.id, subRecipeId: null, qty: 150, unit: "G" }, { ingredientId: null, subRecipeId: sauce.id, qty: 100, unit: "G" }, { ingredientId: pita.id, subRecipeId: null, qty: 1, unit: "PCS" }],
    });
    await K.saveRecipe(owner, { id: null, name: "Bruschetta", kind: "DISH", category: null, posItemId: null, yieldQty: 1, yieldUnit: null, priceGross: 6, vatRate: 13, targetPct: null, soldPerWeek: 10, notes: null, active: true, lines: [{ ingredientId: pita.id, subRecipeId: null, qty: 1, unit: "PCS" }] });
    const d = await K.recipeDetail(owner, pizza.id);
    const expected = 0.15 * mozz.cost! + 0.1 * (1.2 / 0.8) * 2 + 0.25; // mozzarella + sauce (tomato at 80 % yield) + pita
    expect(d.recipe.cost).toBeCloseTo(expected, 3);
    expect(d.recipe.allergens).toContain("GLUTEN");
    expect(d.recipe.allergens).not.toContain("XX");
    expect(d.recipe.foodCostPct).toBeCloseTo(Math.round((expected / (5 / 1.13)) * 1000) / 10, 1);
    expect(d.recipe.suggested).toBeGreaterThan(0);
    if (d.recipe.over) {
      const price = await K.applySuggestedPrice(owner, pizza.id);
      expect((await K.recipeDetail(owner, pizza.id)).recipe.priceGross).toBe(price);
      expect((await K.recipeDetail(owner, pizza.id)).recipe.over).toBe(false);
    }
    // loops
    const base = await K.saveRecipe(owner, { id: null, name: "Base", kind: "SUB", category: null, posItemId: null, yieldQty: 1, yieldUnit: "KG", priceGross: null, vatRate: 13, targetPct: null, soldPerWeek: null, notes: null, active: true, lines: [{ ingredientId: null, subRecipeId: sauce.id, qty: 0.5, unit: "KG" }] });
    await expect(K.saveRecipe(owner, { id: sauce.id, name: "Tomato sauce", kind: "SUB", category: null, posItemId: null, yieldQty: 1, yieldUnit: "KG", priceGross: null, vatRate: 13, targetPct: null, soldPerWeek: null, notes: null, active: true, lines: [{ ingredientId: null, subRecipeId: base.id, qty: 0.1, unit: "KG" }] })).rejects.toThrow(/loop/);
    await expect(K.deleteIngredient(owner, tom.id)).rejects.toThrow(/used in/);
    await expect(K.deleteRecipe(owner, sauce.id)).rejects.toThrow(/used in/);
    await K.deleteRecipe(owner, base.id);
  });

  it("what if mozzarella gets 20 % dearer; menu engineering from sales", async () => {
    const owner = await ctxFor(OWNER);
    const mozz = (await K.listIngredients(owner)).find((x) => x.name === "Mozzarella")!;
    const w = await K.priceRiseWhatIf(owner, mozz.id, 20);
    const row = w.rows.find((r) => r.name === "Pizza Margherita")!;
    expect(row.cost).toBeCloseTo((await K.listRecipes(owner, "DISH")).recipes.find((r) => r.name === "Pizza Margherita")!.cost + 0.15 * mozz.cost! * 0.2, 3);
    expect(w.rows.find((r) => r.name === "Bruschetta")).toBeUndefined(); // doesn't use mozzarella
    const e = await K.menuEngineering(owner, 28);
    const pizza = e.items.find((i) => i.name === "Pizza Margherita")!;
    expect(pizza.sold).toBe(480); // 120 a week × 4
    expect(pizza.source).toBe("MANUAL");
    expect(["STAR", "PLOWHORSE"]).toContain(pizza.cls);
  });

  it("the waste log: ingredient, dish, free text, a purchased lot; donations apart", async () => {
    const owner = await ctxFor(OWNER), staff = await ctxFor(STAFF);
    const mozz = (await K.listIngredients(owner)).find((x) => x.name === "Mozzarella")!;
    const w1 = await K.logWaste(staff, { kind: "WASTE", reason: "EXPIRED", ingredientId: mozz.id, recipeId: null, lotId: null, label: null, qty: 500, unit: "G", note: null, recipient: null, receiptRef: null, at: null });
    expect(w1.cost).toBeCloseTo(0.5 * mozz.cost!, 2);
    expect(w1.kg).toBe(0.5);
    await expect(K.logWaste(staff, { kind: "WASTE", reason: null, ingredientId: mozz.id, recipeId: null, lotId: null, label: null, qty: 1, unit: "KG", note: null, recipient: null, receiptRef: null, at: null })).rejects.toThrow(/why/);
    await expect(K.logWaste(staff, { kind: "WASTE", reason: "SPOILED", ingredientId: mozz.id, recipeId: null, lotId: null, label: null, qty: 2, unit: "PCS", note: null, recipient: null, receiptRef: null, at: null })).rejects.toThrow(/Count/);
    const pizza = (await K.listRecipes(owner, "DISH")).recipes.find((r) => r.name === "Pizza Margherita")!;
    const w2 = await K.logWaste(staff, { kind: "WASTE", reason: "PLATE_WASTE", ingredientId: null, recipeId: pizza.id, lotId: null, label: null, qty: 2, unit: "PORTION", note: null, recipient: null, receiptRef: null, at: null });
    expect(w2.cost).toBeCloseTo(2 * pizza.cost, 2);
    await K.logWaste(staff, { kind: "WASTE", reason: "OTHER", ingredientId: null, recipeId: null, lotId: null, label: "Bread rolls", qty: 1.5, unit: "KG", note: null, recipient: null, receiptRef: null, at: null });
    // from the lot: packs; the lot's used quantity goes up; can't take more than is left
    const w3 = await K.logWaste(staff, { kind: "WASTE", reason: "EXPIRED", ingredientId: null, recipeId: null, lotId, label: null, qty: 1, unit: "PACK", note: null, recipient: null, receiptRef: null, at: null });
    expect(w3.cost).toBeCloseTo(packPrice, 2);
    expect((await prisma.purchasedLot.findUniqueOrThrow({ where: { id: lotId } })).usedQty).toBe(1);
    await expect(K.logWaste(staff, { kind: "WASTE", reason: "EXPIRED", ingredientId: null, recipeId: null, lotId, label: null, qty: 4, unit: "PACK", note: null, recipient: null, receiptRef: null, at: null })).rejects.toThrow(/left/);
    await K.deleteWaste(staff, w3.id); // same day, own entry: the pack goes back
    expect((await prisma.purchasedLot.findUniqueOrThrow({ where: { id: lotId } })).usedQty).toBe(0);
    await expect(K.logWaste(staff, { kind: "DONATION", reason: null, ingredientId: null, recipeId: null, lotId: null, label: "Bread", qty: 3, unit: "KG", note: null, recipient: "", receiptRef: null, at: null })).rejects.toThrow(/Who/);
    await K.logWaste(staff, { kind: "DONATION", reason: null, ingredientId: null, recipeId: null, lotId: null, label: "Bread", qty: 3, unit: "KG", note: null, recipient: "Refood Lisboa", receiptRef: "RF-12", at: null });
    expect((await K.wasteList(staff, { kind: "DONATION" }))[0].recipient).toBe("Refood Lisboa");
    expect((await K.wasteList(staff)).every((x) => x.kind === "WASTE")).toBe(true);
  });

  it("reports against the target; use-first and order-less suggestions", async () => {
    const owner = await ctxFor(OWNER), staff = await ctxFor(STAFF);
    const rep = await K.wasteReport(owner, 30);
    expect(rep.count).toBe(3);
    expect(rep.byReason.map((r) => r.reason)).toEqual(expect.arrayContaining(["EXPIRED", "PLATE_WASTE", "OTHER"]));
    expect(rep.donations).toMatchObject({ count: 1, kg: 3 });
    expect(rep.purchases).toBeGreaterThan(0);
    expect(rep.weekly).toHaveLength(8);
    const mozz = (await K.listIngredients(owner)).find((x) => x.name === "Mozzarella")!;
    for (let k = 0; k < 2; k++) await K.logWaste(staff, { kind: "WASTE", reason: "EXPIRED", ingredientId: mozz.id, recipeId: null, lotId: null, label: null, qty: 1, unit: "KG", note: null, recipient: null, receiptRef: null, at: null });
    const s = await K.kitchenSuggestions(owner);
    const lot = s.useFirst.find((l) => l.id === lotId)!;
    expect(lot.daysLeft).toBeLessThanOrEqual(1);
    expect(lot.dishes.map((d) => d.name)).toContain("Pizza Margherita");
    expect(s.orderLess.find((o) => o.ingredientId === mozz.id)?.wasteEntries).toBe(3);
    const ov = await K.kitchenOverview(owner);
    expect(ov.on && ov.useFirst).toBeGreaterThanOrEqual(1);
  });

  it("the daily job: a cost rise is reported, the business told", async () => {
    const owner = await ctxFor(OWNER);
    const mozz = (await K.listIngredients(owner)).find((x) => x.name === "Mozzarella")!;
    await prisma.kitchenIngredient.update({ where: { id: mozz.id }, data: { cost: mozz.cost! / 2 } }); // as if it used to be half
    const r = await K.runKitchenJob();
    expect(r.rises).toBeGreaterThanOrEqual(1);
    const after = await prisma.kitchenIngredient.findUniqueOrThrow({ where: { id: mozz.id } });
    expect(Number(after.cost)).toBeCloseTo(mozz.cost!, 4);
    expect(Number(after.prevCost)).toBeCloseTo(mozz.cost! / 2, 4);
    expect(r.useFirst).toBeGreaterThanOrEqual(1);
    expect((await K.runKitchenJob()).useFirst).toBe(0); // once a day
  });

  it("dishes come from the till: its recipes become costed dishes", async () => {
    const owner = await ctxFor(OWNER);
    const item = await prisma.posItem.create({ data: { companyId: co, name: "Pizza Fria", price: 7.5, vatRate: 13, recipe: { create: [{ offerId, qty: 0.2, unit: "KG" }] } } });
    posItemId = item.id;
    const r = await K.importFromTill(owner);
    expect(r.dishes).toBeGreaterThanOrEqual(1);
    const d = (await K.listRecipes(owner, "DISH")).recipes.find((x) => x.posItemId === item.id)!;
    expect(d.priceGross).toBe(7.5);
    expect(d.priceFromTill).toBe(true);
    const mozz = (await K.listIngredients(owner)).find((x) => x.productId === productId)!;
    expect(d.cost).toBeCloseTo(0.2 * mozz.cost!, 3);
    expect((await K.importFromTill(owner)).dishes).toBe(0); // only once
    const sa = await K.adminKitchenOverview(await ctxFor(SA));
    expect(sa.businesses).toBeGreaterThanOrEqual(1);
    expect(sa.waste.entries).toBeGreaterThanOrEqual(5);
  });
});
