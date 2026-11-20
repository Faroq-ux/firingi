import { describe, expect, it } from "vitest";
import {
  DEFAULT_REVIEW_SETTINGS as D, cleanReviewSettings, cleanText, combineStats, complaints, detailAvg, fold, mergeReviewSettings, monthlyTrend, ratingStat, screen, starText, validScore,
} from "@/lib/reviews";

const F = D.filter;

describe("product reviews rules (Phase 53)", () => {
  it("the filter holds contact details, links, insults, competitors and blocked words", () => {
    expect(screen("Great mozzarella, melts well on pizza.", F)).toEqual([]);
    expect(screen("Call me on +351 912 345 678 for a better price", F)).toEqual(["CONTACT"]);
    expect(screen("Escreva para joao.silva@gmail.com", F)).toEqual(["CONTACT"]);
    expect(screen("mail me: joao at gmail dot com", F)).toEqual(["CONTACT"]);
    expect(screen("Add me on WhatsApp", F)).toEqual(["CONTACT"]);
    expect(screen("Cheaper at www.example-shop.pt", F)).toEqual(["LINK"]);
    expect(screen("see https://x.io/abc", F)).toEqual(["LINK"]);
    expect(screen("Estes vigaristas mandaram tudo partido", F)).toEqual(["INSULT"]);
    expect(screen("Péssimo, são uns LADRÕES", F)).toEqual(["INSULT"]); // accents and case folded
    expect(screen("Better from Makro", { ...F, competitors: ["Makro", "Recheio"] })).toEqual(["COMPETITOR"]);
    expect(screen("Not as good as recheio's", { ...F, competitors: ["Recheio"] })).toEqual(["COMPETITOR"]);
    expect(screen("ok", { ...F, words: ["ok"] })).toEqual(["WORD"]);
    // numbers that aren't phone numbers, words that only contain a bad word
    expect(screen("Box of 24 × 330 ml, 12,50 € per case, best before 2026-12-01", F)).toEqual([]);
    expect(screen("A scampi dish", F)).toEqual([]); // "scam" inside a word is fine
    // switched off
    expect(screen("call 912345678 www.x.com idiot", { ...F, contacts: false, links: false, insults: false })).toEqual([]);
  });

  it("totals: average, distribution, detail scores, across suppliers", () => {
    const s = ratingStat([{ stars: 5, quality: 5, packaging: 4 }, { stars: 4, quality: 4 }, { stars: 2, freshness: 1 }, { stars: 9 }]);
    expect(s.count).toBe(3);
    expect(s.avg).toBe(3.67);
    expect(s.dist).toEqual([0, 1, 0, 1, 1]);
    expect(detailAvg(s, "quality")).toBe(4.5);
    expect(detailAvg(s, "value")).toBeNull();
    const all = combineStats([s, ratingStat([{ stars: 5 }])]);
    expect(all.count).toBe(4);
    expect(all.avg).toBe(4);
    expect(all.dist).toEqual([0, 1, 0, 1, 2]);
    expect(starText(4.25, "pt-PT")).toBe("4,3");
  });

  it("common complaints come from 3★ and below, in several languages and from low detail scores", () => {
    const c = complaints([
      { stars: 2, body: "A caixa chegou danificada e a validade era curta" },
      { stars: 1, body: "Arrived DAMAGED" },
      { stars: 3, body: "", packaging: 1 },
      { stars: 5, body: "damaged box but great product" }, // not a complaint
      { stars: 2, body: "Zu teuer", value: 2 },
    ]);
    expect(c[0]).toEqual({ theme: "DAMAGED", count: 2 });
    expect(c.find((x) => x.theme === "PACKAGING")?.count).toBe(2);
    expect(c.find((x) => x.theme === "PRICE")?.count).toBe(1);
  });

  it("monthly trend for the last 12 months", () => {
    const now = new Date("2026-11-20T10:00:00Z");
    const t = monthlyTrend([
      { stars: 4, createdAt: new Date("2026-11-02T00:00:00Z") }, { stars: 2, createdAt: new Date("2026-11-10T00:00:00Z") },
      { stars: 5, createdAt: new Date("2026-01-05T00:00:00Z") }, { stars: 1, createdAt: new Date("2025-11-30T00:00:00Z") },
    ], now, 12);
    expect(t).toHaveLength(12);
    expect(t[0].month).toBe("2025-12");
    expect(t[11]).toEqual({ month: "2026-11", avg: 3, count: 2 });
    expect(t[1]).toEqual({ month: "2026-01", avg: 5, count: 1 });
    expect(t[5].avg).toBeNull();
  });

  it("settings: defaults, limits; text cleaned; scores checked", () => {
    const m = mergeReviewSettings({ maxPhotos: 1, parts: { aiSummary: false } as never, filter: { competitors: [" Makro ", "x", "Makro"] } as never });
    expect(m.maxPhotos).toBe(1);
    expect(m.parts.aiSummary).toBe(false);
    expect(m.parts.reviews).toBe(true);
    expect(m.filter.competitors).toEqual(["Makro"]);
    expect(m.filter.contacts).toBe(true);
    expect(() => cleanReviewSettings({ ...D, maxPhotos: 5 })).toThrow(/Photos/);
    expect(() => cleanReviewSettings({ ...D, reminder: { afterDays: 0 } })).toThrow(/Reminder/);
    expect(cleanReviewSettings(D).maxChars).toBe(2000);
    expect(cleanText("  a \n\n\n\n b  ", 100)).toBe("a\n\n b"); // blank lines collapsed, indentation kept
    expect(cleanText("abcdef", 3)).toBe("abc");
    expect(validScore(5)).toBe(true);
    expect(validScore(0)).toBe(false);
    expect(validScore(3.5)).toBe(false);
    expect(fold("Ção")).toBe("cao");
  });
});
