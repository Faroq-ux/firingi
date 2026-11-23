import { describe, expect, it } from "vitest";
import { buyerTypeFor, channelOf, consignmentAllowed, confirmer, countLines, mergeConsignmentSettings, nextCountDue, onShelf, shelfByOffer, takeLots, type CLot } from "@/lib/consignment";

const lot = (id: string, offerId: string, sent: number, exp: string | null, x: Partial<CLot> = {}): CLot => ({ id, offerId, expiresOn: exp, qtySent: sent, qtyShort: 0, qtyUsed: 0, qtyReturned: 0, received: true, ...x });

describe("consignment rules", () => {
  it("settings: defaults, channels, bounds", () => {
    const d = mergeConsignmentSettings(null);
    expect(d).toMatchObject({ enabled: true, requireApproval: true, channels: { DISTRIBUTOR_WHOLESALER: true, WHOLESALER_CUSTOMER: true }, autoConfirmDays: 3 });
    const s = mergeConsignmentSettings({ autoConfirmDays: 99, channels: { DISTRIBUTOR_WHOLESALER: false } as never, disabledVendors: ["a", "a", ""] });
    expect(s.autoConfirmDays).toBe(30);
    expect(s.channels).toEqual({ DISTRIBUTOR_WHOLESALER: false, WHOLESALER_CUSTOMER: true });
    expect(s.disabledVendors).toEqual(["a"]);
  });
  it("channels: distributor → wholesaler, wholesaler → customer; switches", () => {
    expect(channelOf("DISTRIBUTOR")).toBe("DISTRIBUTOR_WHOLESALER");
    expect(channelOf("WHOLESALER")).toBe("WHOLESALER_CUSTOMER");
    expect(buyerTypeFor("DISTRIBUTOR")).toBe("WHOLESALER");
    expect(buyerTypeFor("WHOLESALER")).toBe("CUSTOMER");
    const s = mergeConsignmentSettings({ channels: { DISTRIBUTOR_WHOLESALER: false, WHOLESALER_CUSTOMER: true }, disabledVendors: ["w2"] });
    expect(consignmentAllowed(s, { id: "d", type: "DISTRIBUTOR" })).toBe(false);
    expect(consignmentAllowed(s, { id: "w", type: "WHOLESALER" })).toBe(true);
    expect(consignmentAllowed(s, { id: "w2", type: "WHOLESALER" })).toBe(false);
    expect(consignmentAllowed({ ...s, enabled: false }, { id: "w", type: "WHOLESALER" })).toBe(false);
  });
  it("on the shelf: received, less short, used and returned; nothing while on the way", () => {
    expect(onShelf(lot("a", "o", 10, null, { qtyShort: 1, qtyUsed: 3, qtyReturned: 2 }))).toBe(4);
    expect(onShelf(lot("a", "o", 10, null, { received: false }))).toBe(0);
    expect(shelfByOffer([lot("a", "o", 5, null), lot("b", "o", 3, null), lot("c", "p", 2, null)]).get("o")).toBe(8);
  });
  it("used goods first to expire first, returns latest first; not enough → null", () => {
    const lots = [lot("a", "o", 5, "2027-03-01"), lot("b", "o", 5, "2027-01-01"), lot("c", "o", 5, null)];
    expect(takeLots(lots, "o", 7, "FEFO")).toEqual([{ lotId: "b", qty: 5 }, { lotId: "a", qty: 2 }]);
    expect(takeLots(lots, "o", 6, "LATEST")).toEqual([{ lotId: "c", qty: 5 }, { lotId: "a", qty: 1 }]);
    expect(takeLots(lots, "o", 16)).toBeNull();
    expect(takeLots(lots, "o", 0)).toEqual([]);
  });
  it("count: used = expected − counted; not counted = all used; over the expected refused", () => {
    const exp = new Map([["o", 10], ["p", 4], ["z", 0]]);
    expect(countLines(exp, { o: 6 }).lines).toEqual([{ offerId: "o", expected: 10, counted: 6, used: 4 }, { offerId: "p", expected: 4, counted: 0, used: 4 }]);
    expect(countLines(exp, { o: 11 }).error).toMatch(/higher/);
    expect(countLines(exp, { o: -1 }).error).toMatch(/whole numbers/);
  });
  it("next count and who confirms", () => {
    const c = new Date("2026-01-01T00:00:00Z");
    expect(nextCountDue(null, c, 7).toISOString()).toBe("2026-01-08T00:00:00.000Z");
    expect(nextCountDue(new Date("2026-02-01T00:00:00Z"), c, 14).toISOString()).toBe("2026-02-15T00:00:00.000Z");
    const site = { vendorCompanyId: "v", buyerCompanyId: "b" };
    expect(confirmer("v", site)).toBe("b");
    expect(confirmer("b", site)).toBe("v");
  });
});
