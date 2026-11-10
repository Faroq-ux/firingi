/**
 * Phase 15: marketing campaigns — audience, consent / opt-out, channels, tracking, attribution.
 */
import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { addToCart, clearCart } from "@/server/services/cart";
import { placeOrder } from "@/server/services/orders";
import { setStock } from "@/server/services/vendor-catalogue";
import { saveSegment } from "@/server/services/crm-insights";
import { myPreferences, savePreferences } from "@/server/services/notifications";
import { campaignStats, getCampaign, previewAudience, processScheduledCampaigns, saveCampaign, sendCampaign, trackClick, trackOpen, unsubscribe } from "@/server/marketing/campaigns";
import { ctxFor } from "../helpers";

afterAll(() => prisma.$disconnect());
const SA = "superadmin@firingi.test", SALES = "sales@firingi.test", KEBAB = "owner@kebabhouse.test";

describe("campaigns", () => {
  it("segment audience on e-mail + in-app + SMS: consent rules, tracking, an order after the click is attributed, unsubscribe", async () => {
    const sales = await ctxFor(SALES);
    const kebab = await ctxFor(KEBAB);
    const seg = await saveSegment(sales, null, { name: `Kebab segment ${Date.now()}`, rules: { types: ["CUSTOMER"], countryCodes: ["PT"] } });
    await expect(saveCampaign(sales, null, { name: "x", channels: [], audience: {}, subject: { en: "a" }, body: { en: "b" } })).rejects.toThrow(/channel/);
    await expect(saveCampaign(sales, null, { name: "x", channels: ["WHATSAPP"], audience: {}, subject: { en: "a" }, body: { en: "b" } })).rejects.toThrow(/template/);
    await expect(saveCampaign(await ctxFor(KEBAB), null, { name: "x", channels: ["EMAIL"], audience: {}, subject: { en: "a" }, body: { en: "b" } })).rejects.toThrow();
    const c = await saveCampaign(sales, null, {
      name: "Summer pizza week", channels: ["EMAIL", "IN_APP", "SMS"], audience: { segmentId: seg.id },
      subject: { en: "Pizza week", pt: "Semana da pizza" }, body: { en: "Boxes and flour on offer.", pt: "Caixas e farinha em promoção." }, ctaPath: "/buy/catalogue/deals",
    });
    const preview = await previewAudience(sales, { segmentId: seg.id }, ["EMAIL", "SMS"]);
    expect(preview.companies).toBeGreaterThan(0);
    expect(preview.reach.EMAIL).toBeGreaterThan(0);

    const counts = await sendCampaign(sales, c.id);
    expect(counts.sent).toBeGreaterThan(0);
    await expect(sendCampaign(sales, c.id)).rejects.toThrow(/already/);
    const mine = await prisma.campaignRecipient.findMany({ where: { campaignId: c.id, userId: kebab.user.id } });
    expect(mine.map((r) => r.channel).sort()).toEqual(["EMAIL", "IN_APP", "SMS"]);
    expect(mine.find((r) => r.channel === "IN_APP")!.status).toBe("SENT");
    const sms = mine.find((r) => r.channel === "SMS")!;
    if (sms.status === "SKIPPED") expect(sms.skipReason).toMatch(/SMS consent|mobile/);
    // Portuguese texts, designed e-mail with an unsubscribe link and an open pixel
    const email = await prisma.notificationMessage.findUniqueOrThrow({ where: { id: mine.find((r) => r.channel === "EMAIL")!.messageId! } });
    expect(email.subject).toBe("Semana da pizza");
    const html = (email.variables as { _html: string })._html;
    expect(html).toContain("/m/u/");
    expect(html).toContain("/api/m/o/");
    expect((await prisma.notification.findFirstOrThrow({ where: { userId: kebab.user.id, type: "marketing.campaign" }, orderBy: { createdAt: "desc" } })).title).toBe("Semana da pizza");
    // no Kebab House people → no wholesaler in this segment
    const lx = await ctxFor("owner@lisboacentral.test");
    expect(await prisma.campaignRecipient.count({ where: { campaignId: c.id, companyId: lx.company.id } })).toBe(0);

    const tok = mine.find((r) => r.channel === "EMAIL")!.token;
    await trackOpen(tok);
    expect(await trackClick(tok)).toBe("/buy/catalogue/deals");
    // an order placed after the click counts for the campaign
    const offer = await prisma.vendorOffer.findFirstOrThrow({ where: { vendorCompanyId: lx.company.id, status: "ACTIVE", packaging: { variant: { sku: "FIR-MOZZ2" }, unitsPerPack: 1 } } });
    const wh = await prisma.address.findFirstOrThrow({ where: { companyId: lx.company.id, kind: { in: ["WAREHOUSE", "PICKUP"] } } });
    await setStock(lx, offer.id, wh.id, 3000);
    await clearCart(kebab); await addToCart(kebab, offer.id, 10);
    await placeOrder(kebab, { deliveryAddressId: (await prisma.address.findFirstOrThrow({ where: { companyId: kebab.company.id, kind: "DELIVERY", isActive: true }, orderBy: { isDefault: "desc" } })).id });
    const st = (await campaignStats([c.id])).get(c.id)!;
    expect(st.opened).toBeGreaterThanOrEqual(1);
    expect(st.clicked).toBeGreaterThanOrEqual(1);
    expect(st.orders).toBeGreaterThanOrEqual(1);
    expect(st.revenue).toBeGreaterThan(0);
    expect((await getCampaign(sales, c.id)).byChannel.length).toBeGreaterThan(0);

    // unsubscribe → offers & news off everywhere; the next campaign skips this person
    expect(await unsubscribe(tok)).toBe(true);
    expect(await unsubscribe("nope")).toBe(false);
    const prefs = await myPreferences(kebab);
    expect(prefs.categories.find((x) => x.category === "marketing")!.channels.every((ch) => !ch.enabled)).toBe(true);
    const c2 = await saveCampaign(sales, null, { name: "Second", channels: ["EMAIL"], audience: { companyIds: [kebab.company.id] }, subject: { en: "Hi" }, body: { en: "Again" }, scheduledAt: new Date(Date.now() + 1000) });
    expect(c2.status).toBe("SCHEDULED");
    await prisma.marketingCampaign.update({ where: { id: c2.id }, data: { scheduledAt: new Date(Date.now() - 1000) } });
    expect((await processScheduledCampaigns()).campaigns).toBe(1);
    const r2 = await prisma.campaignRecipient.findFirstOrThrow({ where: { campaignId: c2.id, userId: kebab.user.id } });
    expect([r2.status, r2.skipReason]).toEqual(["SKIPPED", "Opted out of offers & news"]);
    // switching it back on in the settings
    await savePreferences(kebab, { prefs: [{ category: "marketing", channel: "EMAIL", enabled: true }], phone: null, smsConsent: false, whatsappConsent: false });
    expect((await myPreferences(kebab)).categories.find((x) => x.category === "marketing")!.channels.find((ch) => ch.channel === "EMAIL")!.enabled).toBe(true);
    void SA;
  });
});
