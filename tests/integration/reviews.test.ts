/**
 * Phase 53: product reviews & questions — only a business that received the product can review it (one review per
 * product and supplier, editable; photos); the filter holds contact details / links; FIRINGI publishes or hides with a
 * reason; helpful votes; reports hold a post; the supplier's one public reply; questions answered by the supplier and
 * FIRINGI (official) and by buyers who bought it; FIRINGI's switches (whole feature, business types, each business);
 * stars for cards, "4★ and up"; supplier insights; the reminder job (once per product); the AI summary.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { addToCart, clearCart } from "@/server/services/cart";
import { changeOrderStatus, confirmOrder, placeOrder } from "@/server/services/orders";
import { setStock } from "@/server/services/vendor-catalogue";
import * as R from "@/server/reviews/service";
import { DEFAULT_REVIEW_SETTINGS, type ReviewSettings } from "@/lib/reviews";
import { ctxFor, pngFile } from "../helpers";

const SA = "superadmin@firingi.test", OPS = "ops@firingi.test", KEBAB = "owner@kebabhouse.test", KRAKOW = "owner@kebabkrakow.test";
const LX = "owner@lisboacentral.test", OTHER_VENDOR = "owner@atlantico.test";
let offerId = "", productId = "", sellerId = "", orderId = "", kebabId = "", unboughtOffer = "";

async function settings(p: Partial<ReviewSettings> = {}) { return R.saveReviewSettings(await ctxFor(SA), { ...DEFAULT_REVIEW_SETTINGS, ...p }); }
async function clean() {
  if (!productId) return;
  const ids = (await prisma.productReview.findMany({ where: { productId }, select: { id: true } })).map((r) => r.id);
  await prisma.contentReport.deleteMany({ where: { targetId: { in: ids } } });
  await prisma.productReview.deleteMany({ where: { productId } });
  const q = (await prisma.productQuestion.findMany({ where: { productId }, select: { id: true } })).map((x) => x.id);
  const a = (await prisma.productAnswer.findMany({ where: { questionId: { in: q } }, select: { id: true } })).map((x) => x.id);
  await prisma.contentReport.deleteMany({ where: { targetId: { in: [...q, ...a] } } });
  await prisma.productQuestion.deleteMany({ where: { productId } });
  await prisma.productRatingStat.deleteMany({ where: { productId } });
  await prisma.reviewSummary.deleteMany({ where: { productId } });
  await prisma.reviewReminder.deleteMany({ where: { productId } });
}

beforeAll(async () => {
  await prisma.setting.deleteMany({ where: { key: "reviews.settings" } });
  await prisma.companyFeature.deleteMany({ where: { key: "REVIEWS" } });
  const kebab = await ctxFor(KEBAB), lx = await ctxFor(LX);
  kebabId = kebab.company.id; sellerId = lx.company.id;
  // a delivered order of one product from Lisboa Central
  await clearCart(kebab);
  const offer = await prisma.vendorOffer.findFirstOrThrow({ where: { vendorCompanyId: sellerId, status: "ACTIVE", packaging: { variant: { sku: "FIR-PIZZABOX33" } } }, include: { packaging: { include: { variant: true } } } });
  offerId = offer.id; productId = offer.packaging.variant.productId;
  await clean();
  const wh = await prisma.address.findFirstOrThrow({ where: { companyId: sellerId, kind: { in: ["WAREHOUSE", "PICKUP"] } } });
  const cur = await prisma.stockLevel.findUnique({ where: { offerId_addressId: { offerId, addressId: wh.id } } });
  await setStock(lx, offerId, wh.id, Math.max(800, (cur?.reserved ?? 0) + 500));
  await addToCart(kebab, offerId, 8);
  const addr = await prisma.address.findFirstOrThrow({ where: { companyId: kebabId, kind: "DELIVERY", isActive: true }, orderBy: { isDefault: "desc" } });
  orderId = ((await placeOrder(kebab, { deliveryAddressId: addr.id })) as { id: string }).id;
  await confirmOrder(lx, orderId, {});
  for (const s of ["READY_FOR_PICKUP", "DISPATCHED", "OUT_FOR_DELIVERY", "DELIVERED"] as const) await changeOrderStatus(lx, orderId, s);
  // an offer of Lisboa Central's that Kebab House never received
  const bought = (await prisma.orderLine.findMany({ where: { order: { buyerCompanyId: kebabId, status: "DELIVERED" } }, select: { offer: { select: { packaging: { select: { variant: { select: { productId: true } } } } } } } })).map((l) => l.offer.packaging.variant.productId);
  unboughtOffer = (await prisma.vendorOffer.findFirstOrThrow({ where: { vendorCompanyId: sellerId, status: "ACTIVE", packaging: { variant: { productId: { notIn: bought } } } } })).id;
});
afterAll(async () => {
  await clean();
  await prisma.setting.deleteMany({ where: { key: "reviews.settings" } });
  await prisma.companyFeature.deleteMany({ where: { key: "REVIEWS" } });
  await prisma.$disconnect();
});

describe("product reviews & questions", () => {
  it("only a business that received the product may review it — once, editable, with photos", async () => {
    const kebab = await ctxFor(KEBAB);
    expect((await prisma.orderLine.findFirstOrThrow({ where: { orderId } })).qtyDelivered).toBeGreaterThan(0);
    await expect(R.saveReview(kebab, { offerId: unboughtOffer, stars: 5 })).rejects.toThrow(/delivered/);
    const v0 = await R.productReviews(kebab, offerId);
    expect(v0.on && v0.canWrite).toBe(true);
    const r = await R.saveReview(kebab, { offerId, stars: 4, quality: 5, packaging: 3, body: "Sturdy boxes, keep pizzas hot.", photos: [pngFile("box.png")] });
    expect(r.status).toBe("PUBLISHED");
    await expect(R.saveReview(kebab, { offerId, stars: 0 })).rejects.toThrow(/stars/);
    await R.saveReview(kebab, { offerId, stars: 5, quality: 5, body: "Sturdy boxes, keep pizzas hot. Reordered.", keep: [0] });
    const rows = await prisma.productReview.findMany({ where: { productId, buyerCompanyId: kebabId } });
    expect(rows).toHaveLength(1);
    expect(rows[0].editedAt).not.toBeNull();
    expect(rows[0].photos).toHaveLength(1);
    expect(rows[0].packaging).toBeNull(); // cleared on edit
    const v = await R.productReviews(kebab, offerId);
    expect(v.on && v.stat).toMatchObject({ count: 1, avg: 5 });
    expect(v.on && v.my?.stars).toBe(5);
    // photos: published → anyone signed in; the key never leaves the server
    expect(await R.reviewPhotoKey(await ctxFor(KRAKOW), rows[0].id, 0)).toMatch(/^reviews\//);
    await expect(R.saveReview(kebab, { offerId, stars: 5, photos: [pngFile("a.png"), pngFile("b.png"), pngFile("c.png")], keep: [0] })).rejects.toThrow(/Up to 3/);
  });

  it("the filter holds contact details and links; FIRINGI publishes it", async () => {
    const kebab = await ctxFor(KEBAB), krakow = await ctxFor(KRAKOW), sa = await ctxFor(SA);
    const r = await R.saveReview(kebab, { offerId, stars: 2, body: "Cheaper direct: call 912 345 678 or www.boxes.pt" });
    expect(r).toMatchObject({ status: "HELD", holdReasons: ["CONTACT", "LINK"] });
    const other = await R.productReviews(krakow, offerId);
    expect(other.on && other.reviews.map((x) => x.id)).not.toContain(r.id);
    expect(other.on && other.stat.count).toBe(0); // held reviews don't count
    const mine = await R.productReviews(kebab, offerId);
    expect(mine.on && mine.my?.status).toBe("HELD");
    const q = await R.moderationQueue(sa, { tab: "HELD" });
    expect(q.items.some((x) => x.id === r.id && x.kind === "REVIEW")).toBe(true);
    await expect(R.moderationQueue(krakow)).rejects.toThrow();
    await R.moderate(sa, "REVIEW", r.id, "PUBLISH", null);
    const after = await R.productReviews(krakow, offerId);
    expect(after.on && after.stat).toMatchObject({ count: 1, avg: 2 });
    await R.saveReview(kebab, { offerId, stars: 5, quality: 5, body: "Sturdy boxes, keep pizzas hot. Reordered." });
  });

  it("helpful votes: once per business, not for your own review", async () => {
    const kebab = await ctxFor(KEBAB), krakow = await ctxFor(KRAKOW);
    const id = (await prisma.productReview.findFirstOrThrow({ where: { productId, buyerCompanyId: kebabId } })).id;
    expect(await R.voteHelpful(krakow, id, true)).toBe(1);
    expect(await R.voteHelpful(krakow, id, true)).toBe(1);
    await expect(R.voteHelpful(kebab, id, true)).rejects.toThrow(/own review/);
    expect(await R.voteHelpful(krakow, id, false)).toBe(0);
    await R.voteHelpful(krakow, id, true);
  });

  it("the supplier replies once, in public; another supplier can't; the filter applies", async () => {
    const lx = await ctxFor(LX), other = await ctxFor(OTHER_VENDOR), kebab = await ctxFor(KEBAB);
    const id = (await prisma.productReview.findFirstOrThrow({ where: { productId, buyerCompanyId: kebabId } })).id;
    await expect(R.replyToReview(other, id, "Thanks!")).rejects.toThrow();
    expect((await R.replyToReview(lx, id, "Thank you — glad they work for you.")).status).toBe("PUBLISHED");
    const v = await R.productReviews(kebab, offerId);
    expect(v.on && v.reviews.find((x) => x.id === id)?.reply?.text).toMatch(/glad/);
    expect((await R.replyToReview(lx, id, "Order direct at www.lisboacentral.pt")).status).toBe("HELD");
    const hidden = await R.productReviews(await ctxFor(KRAKOW), offerId);
    expect(hidden.on && hidden.reviews.find((x) => x.id === id)?.reply).toBeNull();
    await R.moderate(await ctxFor(SA), "REPLY", id, "PUBLISH", null);
    const vr = await R.vendorReviews(lx, { filter: "all" });
    expect(vr.items.find((x) => x.id === id)?.replyStatus).toBe("PUBLISHED");
  });

  it("reports hold a post for FIRINGI; hidden with a reason, it no longer counts and can't be edited", async () => {
    await settings({ autoHoldReports: 1 });
    const krakow = await ctxFor(KRAKOW), kebab = await ctxFor(KEBAB), sa = await ctxFor(SA);
    const id = (await prisma.productReview.findFirstOrThrow({ where: { productId, buyerCompanyId: kebabId } })).id;
    await expect(R.reportContent(kebab, "REVIEW", id, "SPAM")).rejects.toThrow(/own post/);
    expect((await R.reportContent(krakow, "REVIEW", id, "FALSE", "We bought the same, it was different"))).toEqual({ held: true });
    expect((await R.moderationQueue(sa, { tab: "REPORTED" })).items.find((x) => x.id === id)?.reportReasons[0].reason).toBe("FALSE");
    await expect(R.moderate(sa, "REVIEW", id, "HIDE", "")).rejects.toThrow(/reason/);
    await R.moderate(sa, "REVIEW", id, "HIDE", "Not a verified experience of this product");
    expect((await prisma.contentReport.findFirstOrThrow({ where: { targetId: id } })).status).toBe("HIDDEN");
    expect(await prisma.productRatingStat.findUnique({ where: { productId_sellerCompanyId: { productId, sellerCompanyId: sellerId } } })).toBeNull();
    await expect(R.saveReview(kebab, { offerId, stars: 5 })).rejects.toThrow(/hid/);
    await R.moderate(sa, "REVIEW", id, "PUBLISH", null);
    await settings();
  });

  it("questions: supplier and FIRINGI answer officially; only buyers who received it answer too", async () => {
    const kebab = await ctxFor(KEBAB), krakow = await ctxFor(KRAKOW), lx = await ctxFor(LX), sa = await ctxFor(SA);
    const q = await R.askQuestion(krakow, offerId, "Are these boxes grease-proof?");
    expect(q.status).toBe("PUBLISHED");
    expect((await R.vendorQuestions(lx, { open: true })).items.some((x) => x.id === q.id)).toBe(true);
    expect((await R.answerQuestion(lx, q.id, "Yes, coated inside.")).role).toBe("SUPPLIER");
    expect((await R.answerQuestion(sa, q.id, "Confirmed by the spec sheet.")).role).toBe("FIRINGI");
    expect((await R.answerQuestion(kebab, q.id, "Yes, no leaks in our kitchen.")).role).toBe("BUYER");
    await expect(R.answerQuestion(await ctxFor(OTHER_VENDOR), q.id, "x y z")).rejects.toThrow(); // another supplier, even one selling the same product
    const view = await R.productQuestions(krakow, offerId);
    const mine = view!.questions.find((x) => x.id === q.id)!;
    expect(mine.answers.map((a) => a.role)).toEqual(["SUPPLIER", "FIRINGI", "BUYER"]); // official first
    expect((await prisma.productQuestion.findUniqueOrThrow({ where: { id: q.id } })).answerCount).toBe(3);
    expect((await R.vendorQuestions(lx, { open: true })).items.some((x) => x.id === q.id)).toBe(false);
    const held = await R.askQuestion(krakow, offerId, "Email me at buyer@example.com please");
    expect(held.status).toBe("HELD");
  });

  it("FIRINGI's switches: business types, each business, whose products show reviews", async () => {
    const kebab = await ctxFor(KEBAB), sa = await ctxFor(SA);
    await settings({ buyers: { CUSTOMER: false, WHOLESALER: true } });
    await expect(R.saveReview(kebab, { offerId, stars: 5 })).rejects.toThrow(/switched off/);
    await R.setReviewSwitch(sa, kebabId, "ON");
    expect((await R.saveReview(kebab, { offerId, stars: 5, body: "Sturdy boxes." })).status).toBe("PUBLISHED");
    await R.setReviewSwitch(sa, kebabId, "DEFAULT");
    await settings({ sellers: { WHOLESALER: false, DISTRIBUTOR: true } });
    await R.recomputeAllStats();
    expect((await R.productReviews(kebab, offerId)).on).toBe(false);
    expect((await R.cardRatings([{ productId, sellerId }])).size).toBe(0);
    await R.setReviewSwitch(sa, sellerId, "ON"); // this supplier on its own
    expect((await R.productReviews(kebab, offerId)).on).toBe(true);
    await R.setReviewSwitch(sa, sellerId, "DEFAULT");
    await settings();
    await R.recomputeAllStats();
  });

  it("stars on cards, '4★ and up', sorting; supplier insights; the buyer's own page", async () => {
    const kebab = await ctxFor(KEBAB), lx = await ctxFor(LX);
    const m = await R.cardRatings([{ productId, sellerId }, { productId, sellerId: null }]);
    expect(m.get(`${productId}:${sellerId}`)).toEqual({ avg: 5, count: 1 });
    expect(m.get(`${productId}:`)?.count).toBeGreaterThanOrEqual(1);
    const w = (await R.ratingWhere(kebab, 4)) as { id?: { in: string[] }; packaging?: unknown };
    if (w.id) expect(w.id.in).toContain(offerId); else expect(JSON.stringify(w)).toContain(productId);
    await settings({ parts: { ...DEFAULT_REVIEW_SETTINGS.parts, searchStars: false } });
    expect((await R.cardRatings([{ productId, sellerId }])).size).toBe(0);
    await settings();
    const ins = await R.vendorInsights(lx);
    expect(ins!.count).toBeGreaterThanOrEqual(1);
    expect(ins!.products.find((p) => p.productId === productId)?.avg).toBe(5);
    expect(ins!.trend).toHaveLength(12);
    const my = await R.myReviews(kebab);
    expect(my.on && my.reviews.some((r) => r.offerId === offerId)).toBe(true);
    expect(my.on && my.todo.some((t) => t.offerId === offerId)).toBe(false);
  });

  it("reminds a few days after delivery — once per product", async () => {
    const kebab = await ctxFor(KEBAB);
    await prisma.productReview.deleteMany({ where: { productId, buyerCompanyId: kebabId } });
    await R.recomputeAllStats();
    await prisma.reviewReminder.deleteMany({ where: { buyerCompanyId: kebabId } });
    const later = new Date(Date.now() + 4 * 86_400_000); // the job four days after delivery (history rows are append-only)
    const first = await R.runReviewJob(later);
    expect(first.reminders).toBeGreaterThanOrEqual(1);
    expect(await prisma.reviewReminder.count({ where: { buyerCompanyId: kebabId, productId } })).toBe(1);
    await R.runReviewJob(later);
    expect(await prisma.reviewReminder.count({ where: { buyerCompanyId: kebabId, productId } })).toBe(1);
    const my = await R.myReviews(kebab);
    expect(my.on && my.todo.some((t) => t.offerId === offerId)).toBe(true);
    await settings({ parts: { ...DEFAULT_REVIEW_SETTINGS.parts, reminders: false } });
    expect((await R.runReviewJob(later)).reminders).toBe(0);
    await settings();
  });

  it("AI summary: none without an AI; simulated in development; cached until the reviews change", async () => {
    const kebab = await ctxFor(KEBAB);
    await R.saveReview(kebab, { offerId, stars: 4, body: "Good boxes but the delivery box was damaged." });
    await settings({ aiMinReviews: 1 });
    const had = process.env.ASSISTANT_SIMULATE;
    delete process.env.ASSISTANT_SIMULATE;
    if (!process.env.ANTHROPIC_API_KEY) expect(await R.reviewSummary(kebab, offerId, "en")).toBeNull();
    process.env.ASSISTANT_SIMULATE = "1";
    try {
      if (!process.env.ANTHROPIC_API_KEY) {
        const s = await R.reviewSummary(kebab, offerId, "en");
        expect(s).toMatchObject({ simulated: true, basedOn: 1 });
        expect(await prisma.reviewSummary.count({ where: { productId } })).toBe(1);
        await R.saveReview(kebab, { offerId, stars: 3, body: "OK." });
        expect(await prisma.reviewSummary.count({ where: { productId } })).toBe(0); // cleared on change
      }
    } finally {
      if (had === undefined) delete process.env.ASSISTANT_SIMULATE; else process.env.ASSISTANT_SIMULATE = had;
      await settings();
    }
    expect(await R.moderationCounts(await ctxFor(OPS))).toHaveProperty("held");
  });
});
