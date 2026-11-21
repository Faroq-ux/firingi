import { describe, expect, it } from "vitest";
import Decimal from "decimal.js";
import { cartHash, DEFAULT_WA, intentOf, localeFromPhone, mergeWaSettings, toWhatsApp } from "@/lib/wa-ordering";
import { decideDelivery } from "@/server/orders/delivery-rule";

describe("replies FIRINGI understands without the AI", () => {
  it("yes, no and repeat in several languages and from buttons", () => {
    for (const y of ["YES", "Sim!", "sí", "oui", "Ja", "tak", "ναι", "wa_confirm", "OK 👍"]) expect(intentOf(y)).toBe("YES");
    for (const n of ["no", "NÃO", "non", "nein", "anuluj", "wa_cancel"]) expect(intentOf(n)).toBe("NO");
    for (const r of ["repeat", "Repetir", "same again", "wa_repeat"]) expect(intentOf(r)).toBe("REPEAT");
  });
  it("anything longer or unclear goes to the AI (never a bare number)", () => {
    expect(intentOf("yes but add 2 more cokes please")).toBeNull();
    expect(intentOf("2")).toBeNull();
    expect(intentOf("")).toBeNull();
  });
});

describe("language from the number", () => {
  it("uses the longest country code", () => {
    expect(localeFromPhone("+351 912 345 678")).toBe("pt-PT");
    expect(localeFromPhone("34600111222")).toBe("es");
    expect(localeFromPhone("+420777000111")).toBe("cs");
    expect(localeFromPhone("+1 555 0100")).toBe("en");
  });
});

describe("WhatsApp text", () => {
  it("bold, tables as lines, links spelled out", () => {
    const t = toWhatsApp("## Order\n**Total:** 10 €\n| Product | Qty |\n|---|---|\n| Coca-Cola | 2 |\n[Pay](https://x.test/p)");
    expect(t).toContain("*Order*");
    expect(t).toContain("*Total:* 10 €");
    expect(t).toContain("Coca-Cola · 2");
    expect(t).not.toContain("|---");
    expect(t).toContain("Pay: https://x.test/p");
  });
  it("cart fingerprint ignores line order, sees quantity changes", () => {
    const a = cartHash([{ offerId: "a", qty: 1 }, { offerId: "b", qty: 2 }]);
    expect(cartHash([{ offerId: "b", qty: 2 }, { offerId: "a", qty: 1 }])).toBe(a);
    expect(cartHash([{ offerId: "a", qty: 1 }, { offerId: "b", qty: 3 }])).not.toBe(a);
  });
});

describe("settings", () => {
  it("wholesale customers on, wholesalers and unknown numbers off by default; bad values repaired", () => {
    expect(DEFAULT_WA.audiences).toEqual({ customers: true, wholesalers: false, unknownNumbers: false });
    const s = mergeWaSettings({ audiences: { wholesalers: true }, draftMinutes: 5, templates: { orderUpdate: "Bad Name!", language: "Portuguese" } });
    expect(s.audiences.wholesalers).toBe(true);
    expect(s.audiences.customers).toBe(true);
    expect(s.draftMinutes).toBe(DEFAULT_WA.draftMinutes);
    expect(s.templates.orderUpdate).toBe("");
    expect(s.templates.language).toBe("pt_PT");
    expect(mergeWaSettings(null)).toEqual(DEFAULT_WA);
  });
});

describe("small orders per month", () => {
  const firingi: { id: string; minOrderValue: string; feeNet: string; freeEnabled: boolean; freeFrom: string | null } = { id: "f", minOrderValue: "50", feeNet: "9.90", freeEnabled: false, freeFrom: null };
  const vendor = { id: "v", kind: "AMOUNT" as const, amount: "150", units: null, flatFeeNet: null };
  const run = (goods: number, left: number | null, v: typeof vendor | null = vendor, f: typeof firingi = firingi) =>
    decideDelivery({ goodsNet: goods, units: 1, supplierDelivers: false, crossBorder: false, firingi: f, vendor: v, smallOrdersLeft: left });
  it("below the wholesaler's free-delivery amount: a small order FIRINGI delivers", () => {
    const d = run(80, 2);
    expect(d.ok && d.small).toBe(true);
    expect(d.ok && d.mode).toBe("FIRINGI_FLEET");
  });
  it("used up: must reach the wholesaler's own free-delivery amount", () => {
    const d = run(80, 0);
    expect(d.ok).toBe(false);
    if (!d.ok) { expect(d.reason).toBe("SMALL_ORDER_LIMIT"); expect(d.minimum.toString()).toBe("150"); expect(d.missing.toString()).toBe("70"); }
    expect(run(150, 0).ok).toBe(true);
  });
  it("no limit or nothing to reach: never blocked, not counted without a target", () => {
    expect(run(80, null).ok).toBe(true);
    const none = run(80, 0, null);
    expect(none.ok && none.small).toBe(false);
  });
  it("without a wholesaler minimum, FIRINGI's free delivery is the target", () => {
    const d = run(80, 0, null, { ...firingi, freeEnabled: true, freeFrom: "120" });
    expect(!d.ok && d.minimum.equals(new Decimal(120))).toBe(true);
  });
  it("below FIRINGI's minimum stays BELOW_MINIMUM", () => {
    const d = run(30, 0);
    expect(!d.ok && d.reason).toBe("BELOW_MINIMUM");
  });
});

describe("the keywords in every translation", () => {
  it("YES / NO / REPEAT asked for in each language are understood, and mean one thing only", async () => {
    const { readdirSync, readFileSync } = await import("node:fs");
    const { KEYWORDS } = await import("@/lib/wa-ordering");
    for (const k of KEYWORDS.YES) { expect(KEYWORDS.NO.has(k)).toBe(false); expect(KEYWORDS.REPEAT.has(k)).toBe(false); }
    for (const k of KEYWORDS.NO) expect(KEYWORDS.REPEAT.has(k)).toBe(false);
    for (const f of readdirSync("src/messages")) {
      const b = JSON.parse(readFileSync(`src/messages/${f}`, "utf8")).waOrder;
      const caps = (s: string) => [...s.matchAll(/(?<![\p{L}])([\p{Lu}]{2,})(?![\p{L}])/gu)].map((m) => m[1]).filter((w) => !["FIRINGI", "YES"].includes(w) || f === "en.json");
      const [yes, no] = caps(b.bot.confirmHint);
      const [repeat] = caps(b.bot.reminder);
      expect(intentOf(yes), `${f} yes ${yes}`).toBe("YES");
      expect(intentOf(no), `${f} no ${no}`).toBe("NO");
      expect(intentOf(repeat), `${f} repeat ${repeat}`).toBe("REPEAT");
    }
  });
});
