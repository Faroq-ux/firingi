/**
 * Phase 44: food information & allergens — the supplier fills in a product (checks, completeness), FIRINGI
 * approves / rejects, buyers filter and see badges, a recipe change reaches the customers who bought it (urgent
 * with an allergen profile), "required to sell" hides products without approved data, review off publishes at
 * once, spreadsheet (FIRINGI + GS1) import, the AI label reading (validated), the reseller outputs (public page,
 * export), certificate reminders and the allergen recall link.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { placeOrder, changeOrderStatus } from "@/server/services/orders";
import { addToCart, clearCart } from "@/server/services/cart";
import { setStock } from "@/server/services/vendor-catalogue";
import { browseCatalogue } from "@/server/data/catalogue-buyer";
import { setAiTransportForTests } from "@/server/ai/assistant";
import * as F from "@/server/food/service";
import { importFood } from "@/server/food/import";
import { readLabel } from "@/server/food/label-ai";
import { ALLERGENS, DEFAULT_FOOD_SETTINGS, type FoodSettings } from "@/lib/food";
import { ctxFor, pngFile } from "../helpers";

const KEBAB = "owner@kebabhouse.test", LX = "owner@lisboacentral.test", SA = "superadmin@firingi.test";
const FREE = Object.fromEntries(ALLERGENS.map((a) => [a, "FREE"]));
const CAKE = {
  allergens: { ...FREE, GLUTEN: "CONTAINS", EGGS: "CONTAINS", MILK: "CONTAINS", SULPHITES: "CONTAINS" },
  ingredients: { pt: "Farinha de *trigo*, açúcar, *ovos*, manteiga (*leite*), rum (*sulfitos*)." },
  nutrition: { basis: "100g", energyKj: 1674, energyKcal: 400, fat: 18, saturates: 10, carbohydrate: 52, sugars: 30, protein: 6, salt: 0.4 },
  diets: [], originCountryCode: "PT", storage: { pt: "Conservar em local fresco e seco." }, shelfLifeDays: 120,
};
let cake = "", cakeOffer = "", sauce = "", kebabId = "", addressId = "";
const placed: string[] = [];
const settings = async (patch: Partial<FoodSettings> = {}) => F.saveFoodSettings(await ctxFor(SA), { ...DEFAULT_FOOD_SETTINGS, ...patch });
const csv = (text: string, name = "food.csv") => new File([Buffer.from(text, "utf8")], name, { type: "text/csv" });

beforeAll(async () => {
  const lx = await ctxFor(LX), kb = await ctxFor(KEBAB);
  kebabId = kb.company.id;
  await prisma.setting.deleteMany({ where: { key: "food.settings" } });
  const o = await prisma.vendorOffer.findFirstOrThrow({ where: { vendorCompanyId: lx.company.id, vendorSku: "GRO-KEBAB10", status: "ACTIVE" }, include: { packaging: { include: { variant: true } } } });
  cakeOffer = o.id; cake = o.packaging.variant.productId;
  const s = await prisma.vendorOffer.findFirstOrThrow({ where: { vendorCompanyId: lx.company.id, status: "ACTIVE", packaging: { variant: { sku: "FIR-LUSO15" } } }, include: { packaging: { include: { variant: true } } } });
  sauce = s.packaging.variant.productId;
  await prisma.foodInfo.deleteMany({ where: { productId: { in: [cake, sauce] } } });
  await prisma.product.updateMany({ where: { id: { in: [cake, sauce] } }, data: { foodInfoId: null, allergensContain: [], allergensMayContain: [], allergensFree: [], diets: [], foodBlockedAt: null, foodBlockReason: null } });
  const wh = await prisma.address.findFirstOrThrow({ where: { companyId: lx.company.id, kind: { in: ["WAREHOUSE", "PICKUP"] } } });
  await setStock(lx, cakeOffer, wh.id, 500);
  addressId = (await prisma.address.findFirstOrThrow({ where: { companyId: kebabId, kind: "DELIVERY", isActive: true }, orderBy: { isDefault: "desc" } })).id;
});
afterAll(async () => {
  setAiTransportForTests(null);
  const sa = await ctxFor(SA);
  for (const id of placed) await changeOrderStatus(sa, id, "CANCELLED", "test clean-up").catch(() => null);
  await prisma.foodChange.deleteMany({ where: { productId: { in: [cake, sauce] } } });
  await prisma.product.updateMany({ where: { id: { in: [cake, sauce] } }, data: { foodInfoId: null, allergensContain: [], allergensMayContain: [], allergensFree: [], diets: [], foodBlockedAt: null, foodBlockReason: null } });
  await prisma.foodInfo.deleteMany({ where: { productId: { in: [cake, sauce] } } });
  await prisma.foodProfile.deleteMany({ where: { companyId: kebabId } });
  await prisma.setting.deleteMany({ where: { key: "food.settings" } });
  await F.recomputeGate(prisma);
  await prisma.$disconnect();
});

describe("food information & allergens", () => {
  it("the supplier fills in a product: checks, completeness, then FIRINGI rejects with a reason and approves the fix", async () => {
    const lx = await ctxFor(LX), sa = await ctxFor(SA);
    const list = await F.supplierFoodList(lx);
    const row = list.rows.find((r) => r.productId === cake)!;
    expect(row.required).toEqual(["ALLERGENS", "INGREDIENTS", "NUTRITION", "STORAGE"]);
    expect(row.score).toBe(0);
    // what can't be right is refused
    await expect(F.saveFoodDraft(lx, cake, { ...CAKE, nutrition: { ...CAKE.nutrition, saturates: 25 } })).rejects.toThrow(/Saturates/);
    // incomplete: can be saved, not sent
    await F.saveFoodDraft(lx, cake, { ...CAKE, storage: {} });
    await expect(F.submitFood(lx, cake)).rejects.toThrow(/Still missing: storage/);
    await F.saveFoodDraft(lx, cake, CAKE);
    const sent = await F.submitFood(lx, cake);
    expect(sent.status).toBe("PENDING");
    expect(await prisma.notificationMessage.count({ where: { eventKey: "food.review" } })).toBeGreaterThan(0);
    const q = await F.reviewQueue(sa);
    expect(q.find((r) => r.productId === cake)?.isNew).toBe(true);
    await expect(F.rejectFood(sa, sent.id, " ")).rejects.toThrow(/what to fix/);
    await F.rejectFood(sa, sent.id, "The label says it may contain nuts.");
    const ed = await F.foodEditor(lx, cake);
    expect(ed.working?.status).toBe("REJECTED");
    expect(ed.working?.reviewNote).toMatch(/nuts/);
    await F.saveFoodDraft(lx, cake, { ...CAKE, allergens: { ...CAKE.allergens, NUTS: "MAY_CONTAIN" } });
    const again = await F.submitFood(lx, cake);
    const res = await F.approveFood(sa, again.id);
    expect(res.changed).toBe(false); // the first approved version: nothing to tell customers
    const p = await prisma.product.findUniqueOrThrow({ where: { id: cake } });
    expect(p.allergensContain.sort()).toEqual(["EGGS", "GLUTEN", "MILK", "SULPHITES"]);
    expect(p.allergensMayContain).toEqual(["NUTS"]);
    expect(p.foodInfoId).toBe(again.id);
    expect((await F.supplierFoodList(lx)).rows.find((r) => r.productId === cake)!.score).toBe(100);
  });

  it("buyers: badges on the catalogue item, 'free from' and diet filters, full information on the product page", async () => {
    const kb = await ctxFor(KEBAB);
    const noGluten = await browseCatalogue(kb, { free: ["GLUTEN"] });
    expect(noGluten.items.some((i) => i.productId === cake)).toBe(false);
    expect(noGluten.items.every((i) => i.food.approved && !i.food.contain.includes("GLUTEN") && !i.food.mayContain.includes("GLUTEN"))).toBe(true);
    expect(noGluten.items.some((i) => i.sku === "FIR-ARROZ1")).toBe(true);
    const vegan = await browseCatalogue(kb, { diet: "VEGAN" });
    expect(vegan.items.length).toBeGreaterThan(0);
    expect(vegan.items.every((i) => i.food.diets.includes("VEGAN"))).toBe(true);
    const all = await browseCatalogue(kb, { q: "kebab" });
    expect(all.items.find((i) => i.productId === cake)?.food.contain).toContain("EGGS");
    const pf = await F.buyerProductFood(kb, cake, "pt-PT");
    expect(pf?.approved).toBe(true);
    if (!pf?.approved) return;
    expect(pf.ingredients?.segments.filter((s) => s.b).map((s) => s.t)).toEqual(["trigo", "ovos", "leite", "sulfitos"]);
    expect(pf.mayContain).toEqual(["NUTS"]);
    expect(pf.nutrition?.energyKcal).toBe(400);
  });

  it("a recipe change reaches the customers who bought it — urgent with a matching allergen profile", async () => {
    const kb = await ctxFor(KEBAB), lx = await ctxFor(LX), sa = await ctxFor(SA);
    await clearCart(kb);
    await addToCart(kb, cakeOffer, 30);
    placed.push((await placeOrder(kb, { deliveryAddressId: addressId })).id);
    await settings({ profile: true });
    await F.saveProfile(kb, { avoid: ["PEANUTS", "SESAME"], includeTraces: true, hideInCatalogue: false });
    const before = await prisma.notificationMessage.count({ where: { eventKey: "food.recipe_changed" } });
    await F.saveFoodDraft(lx, cake, { ...CAKE, allergens: { ...CAKE.allergens, NUTS: "MAY_CONTAIN", SESAME: "MAY_CONTAIN" }, ingredients: { pt: `${CAKE.ingredients.pt} Decorado com *sésamo*.` } });
    const v = await F.submitFood(lx, cake);
    const q = await F.reviewQueue(sa);
    expect(q.find((r) => r.id === v.id)?.allergenAdded).toBe(true);
    const res = await F.approveFood(sa, v.id);
    expect(res.changed).toBe(true);
    expect(res.allergenAdded).toBe(true);
    const ch = await prisma.foodChange.findFirstOrThrow({ where: { productId: cake }, orderBy: { createdAt: "desc" } });
    expect(ch.notifiedCompanies).toBeGreaterThanOrEqual(1);
    expect(await prisma.notificationMessage.count({ where: { eventKey: "food.recipe_changed" } })).toBeGreaterThan(before);
    const mine = await F.myRecipeChanges(kb, "pt-PT");
    const c = mine.find((x) => x.productId === cake)!;
    expect(c.diff.mayContainAdded).toEqual(["SESAME"]);
    expect(c.urgent).toBe(true);
    // the profile flags it on badges, and can hide it from the catalogue
    expect((await F.foodBadges(kb, [cake])).get(cake)?.hits).toEqual(["SESAME"]);
    await F.saveProfile(kb, { avoid: ["SESAME"], includeTraces: true, hideInCatalogue: true });
    expect((await browseCatalogue(kb, { q: "kebab" })).items.some((i) => i.productId === cake)).toBe(false);
    await F.saveProfile(kb, { avoid: [], includeTraces: true, hideInCatalogue: false });
    // previous version superseded
    expect(await prisma.foodInfo.count({ where: { productId: cake, status: "APPROVED" } })).toBe(1);
  });

  it("'required to sell': products without approved, complete information are hidden; switching off shows them again", async () => {
    const kb = await ctxFor(KEBAB);
    const visible = async (productId: string) => (await browseCatalogue(kb, { q: productId === cake ? "kebab" : "luso" })).items.some((i) => i.productId === productId);
    expect(await visible(sauce)).toBe(true);
    await settings({ requireToSell: true });
    const p = await prisma.product.findUniqueOrThrow({ where: { id: sauce } });
    expect(p.foodBlockReason).toBe("NO_FOOD_INFO");
    expect(await visible(sauce)).toBe(false);
    expect(await visible(cake)).toBe(true);
    const sa = await ctxFor(SA);
    expect((await F.qualityDashboard(sa)).tiles.blockedNow).toBeGreaterThan(0);
    await settings({ requireToSell: false });
    expect(await visible(sauce)).toBe(true);
  });

  it("review off: a complete version goes live at once", async () => {
    const lx = await ctxFor(LX);
    await settings({ review: false });
    await F.saveFoodDraft(lx, sauce, { allergens: { ...FREE, MILK: "CONTAINS", EGGS: "CONTAINS", MUSTARD: "MAY_CONTAIN" }, ingredients: { pt: "Óleo vegetal, *ovo*, alho, *leite*, sal." }, nutrition: { basis: "100g", energyKj: 2510, energyKcal: 600, fat: 65, saturates: 6, carbohydrate: 3, sugars: 2, protein: 1.5, salt: 1.6 }, storage: { pt: "Depois de aberto, conservar no frio." }, afterOpeningDays: 30, originCountryCode: "PT" });
    const r = await F.submitFood(lx, sauce);
    expect(r.status).toBe("APPROVED");
    const v = await prisma.foodInfo.findUniqueOrThrow({ where: { id: r.id } });
    expect(v.reviewNote).toMatch(/without review/);
    await settings();
  });

  it("spreadsheet import: FIRINGI template and GS1 headers; unknown products and bad values reported; preview saves nothing", async () => {
    const lx = await ctxFor(LX);
    const ours = ["sku;gluten;crustaceans;eggs;fish;peanuts;soy;milk;nuts;celery;mustard;sesame;sulphites;lupin;molluscs;ingredients_pt;basis;energy_kj;energy_kcal;fat;saturates;carbohydrate;sugars;protein;salt;storage_pt",
      "GRO-KEBAB10;contém;não;sim;não;não;não;sim;pode conter;não;não;pode conter;sim;não;não;Farinha de *trigo*, *ovos*, *leite*, rum (*sulfitos*), *sésamo*;100g;1674;400;18;10;52;30;6;0,4;Local seco",
      "NOPE-1;contém;;;;;;;;;;;;;;x;;;;;;;;;;",
      "GRO-MOZZ2;maybe;;;;;;;;;;;;;;x;;;;;;;;;;"].join("\n");
    const prev = await importFood(lx, { file: csv(ours), apply: false });
    expect(prev.totals).toMatchObject({ rows: 3, ok: 1, notFound: 1, error: 1 });
    expect(prev.rows.find((r) => r.ref === "GRO-MOZZ2")?.message).toMatch(/maybe/);
    expect(prev.saved).toBe(0);
    const applied = await importFood(lx, { file: csv(ours), apply: true, submit: true });
    expect(applied.saved).toBe(1);
    expect(applied.submitted).toBe(1);
    const v = await prisma.foodInfo.findFirstOrThrow({ where: { productId: cake, status: "PENDING" }, orderBy: { version: "desc" } });
    expect(v.source).toBe("IMPORT");
    expect((v.allergens as Record<string, string>).NUTS).toBe("MAY_CONTAIN");
    await F.rejectFood(await ctxFor(SA), v.id, "test");
    // GS1 / GDSN-style headers
    const gtin = (await prisma.productVariant.findFirstOrThrow({ where: { productId: cake } })).gtin;
    if (gtin) {
      const gs1 = [`gtin;allergen:AW;allergen:AE;allergen:AM;allergen:AN;nutrient:ENER-KJO;nutrient:ENER-E14;ingredientStatement:en`, `${gtin};CONTAINS;CONTAINS;CONTAINS;MAY_CONTAIN;1674;400;*Wheat* flour, *eggs*, *milk*`].join("\n");
      const g = await importFood(lx, { file: csv(gs1), apply: false });
      expect(g.rows[0].status).toBe("INCOMPLETE");
      expect(g.rows[0].productId).toBe(cake);
    }
  });

  it("the AI reads the label into a draft — its answer is validated, and a photo is needed", async () => {
    const lx = await ctxFor(LX);
    await F.saveFoodDraft(lx, sauce, { allergens: {} });
    await expect(readLabel(lx, sauce)).rejects.toThrow(/photo of the label/);
    await F.uploadFoodFile(lx, sauce, "LABEL", pngFile("label.png"));
    const tool = (input: unknown) => async () => ({
      id: "msg_t", type: "message", role: "assistant", model: "test", stop_reason: "tool_use", stop_sequence: null,
      content: [{ type: "tool_use", id: "tu_1", name: "record_food_info", input }], usage: { input_tokens: 1, output_tokens: 1 },
    }) as never;
    setAiTransportForTests(tool({ allergens: { GLUTEN: "SOMETIMES" }, ingredients: null, nutrition: null, diets: [], unsure: "" }));
    await expect(readLabel(lx, sauce)).rejects.toThrow(/incomplete/);
    setAiTransportForTests(tool({ allergens: { ...FREE, EGGS: "CONTAINS", MILK: "CONTAINS" }, ingredients: "Óleo, *ovo*, alho, *leite*", ingredientsLanguage: "pt", nutrition: { basis: "100g", energyKj: 2510, energyKcal: 600, fat: 65, saturates: 6, carbohydrate: 3, sugars: 2, protein: 1.5, salt: 1.6 }, diets: [], originCountryCode: "pt", storage: "Conservar no frio", unsure: "The salt value was blurred." }));
    const r = await readLabel(lx, sauce);
    expect(r.simulated).toBe(false);
    const d = await prisma.foodInfo.findUniqueOrThrow({ where: { id: r.id } });
    expect(d.status).toBe("DRAFT");
    expect(d.source).toBe("AI");
    expect(d.aiNote).toMatch(/blurred/);
    expect(d.originCountryCode).toBe("PT");
    setAiTransportForTests(null);
  });

  it("resellers: the export, the public page (only approved, switchable) and the products they buy", async () => {
    const kb = await ctxFor(KEBAB);
    const mine = await F.myFoodProducts(kb, "pt-PT");
    expect(mine.some((p) => p.productId === cake && p.approved)).toBe(true);
    const out = await F.exportCsv(kb, "pt-PT");
    expect(out).toContain("allergen_gluten");
    expect(out).toMatch(/kebab/i);
    const pub = await F.publicFood(cake, "en");
    expect(pub?.contain).toContain("GLUTEN");
    expect(JSON.stringify(pub)).not.toMatch(/price|Lisboa/i);
    await settings({ publicPage: false, export: false });
    expect(await F.publicFood(cake, "en")).toBeNull();
    await expect(F.exportCsv(kb, "pt-PT")).rejects.toThrow(/switched off/);
    await settings();
  });

  it("certificates: a halal claim with its certificate; reminders before it expires; allergen recall needs a lot", async () => {
    const lx = await ctxFor(LX), sa = await ctxFor(SA);
    const soon = new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10);
    await F.saveFoodDraft(lx, cake, { ...CAKE, allergens: { ...CAKE.allergens, NUTS: "MAY_CONTAIN", SESAME: "MAY_CONTAIN" } });
    await F.saveCertificate(lx, cake, { diet: "HALAL", number: "HAL-2026-77", issuer: "Halal PT", expiresOn: soon });
    const v = await F.submitFood(lx, cake);
    await F.approveFood(sa, v.id);
    expect((await prisma.product.findUniqueOrThrow({ where: { id: cake } })).diets).toContain("HALAL");
    const before = await prisma.notificationMessage.count({ where: { eventKey: "food.cert_expiring" } });
    const r = await F.runFoodJob();
    expect(r.reminded).toBeGreaterThanOrEqual(1);
    expect(await prisma.notificationMessage.count({ where: { eventKey: "food.cert_expiring" } })).toBeGreaterThan(before);
    expect((await F.runFoodJob()).reminded).toBe(0); // once per reminder day
    expect((await F.qualityDashboard(sa)).certificates.some((c) => c.productId === cake)).toBe(true);
    await expect(F.startAllergenRecall(sa, { offerId: cakeOffer, lotCode: " ", allergen: "NUTS" })).rejects.toThrow(/lot/);
    await expect(F.startAllergenRecall(sa, { offerId: cakeOffer, lotCode: "L1", allergen: "CHOCOLATE" })).rejects.toThrow(/allergen/);
  });

  it("only sellers of the product, and FIRINGI, can edit its food information", async () => {
    const kb = await ctxFor(KEBAB);
    await expect(F.saveFoodDraft(kb, cake, CAKE)).rejects.toThrow();
    await expect(F.reviewQueue(kb)).rejects.toThrow();
    await expect(F.saveFoodSettings(await ctxFor(LX), DEFAULT_FOOD_SETTINGS)).rejects.toThrow();
  });
});
