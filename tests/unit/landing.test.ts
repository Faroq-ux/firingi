import { describe, expect, it } from "vitest";
import { checkContact, cleanLanding, DEFAULT_LANDING, fill, flatten, isEmail, LANDING_SECTIONS, listItems, lookup, looksLikeSpam, mergeLanding, planBullets, underLimit, type ContactIn, type TextSources } from "@/lib/landing";
import { defaultLegal } from "@/lib/landing-legal";
import en from "@/messages/en.json";
import pt from "@/messages/pt-PT.json";

const LOCALES = ["en", "pt-PT", "es"];
const src = (p: Partial<TextSources> = {}): TextSources => ({ own: {}, ownEn: {}, msgs: {}, msgsEn: {}, ...p });

describe("landing settings", () => {
  it("fills defaults and keeps only known values", () => {
    const s = mergeLanding({ enabled: false, sections: { faq: false, bogus: true } as never, whatsapp: 5 as never, hidden: ["faq.items.2", 3 as never] });
    expect(s.enabled).toBe(false);
    expect(s.sections.faq).toBe(false);
    expect(s.sections.till).toBe(true);
    expect(Object.keys(s.sections)).toEqual([...LANDING_SECTIONS]);
    expect(s.whatsapp).toBe("");
    expect(s.hidden).toEqual(["faq.items.2"]);
    expect(mergeLanding(null)).toEqual(DEFAULT_LANDING);
  });
  it("cleans the WhatsApp number and checks every value", () => {
    expect(cleanLanding({ ...DEFAULT_LANDING, whatsapp: "+351 912 345 678" }, LOCALES).whatsapp).toBe("351912345678");
    expect(() => cleanLanding({ ...DEFAULT_LANDING, whatsapp: "123" }, LOCALES)).toThrow(/WhatsApp/);
    expect(cleanLanding({ ...DEFAULT_LANDING, whatsappVendors: "+351 913 000 000" }, LOCALES).whatsappVendors).toBe("351913000000");
    expect(() => cleanLanding({ ...DEFAULT_LANDING, whatsappVendors: "12" }, LOCALES)).toThrow(/Suppliers/);
    expect(() => cleanLanding({ ...DEFAULT_LANDING, email: "nope" }, LOCALES)).toThrow(/email/);
    expect(() => cleanLanding({ ...DEFAULT_LANDING, social: { ...DEFAULT_LANDING.social, instagram: "http://x.com" } }, LOCALES)).toThrow(/https/);
    expect(() => cleanLanding({ ...DEFAULT_LANDING, texts: { xx: { "hero.h1": "Hi" } } }, LOCALES)).toThrow(/language/);
    expect(() => cleanLanding({ ...DEFAULT_LANDING, texts: { en: { "hero h1!": "Hi" } } }, LOCALES)).toThrow(/Unknown text/);
    expect(cleanLanding({ ...DEFAULT_LANDING, texts: { "pt-PT": { "hero.h1": "Olá" } } }, LOCALES).texts["pt-PT"]["hero.h1"]).toBe("Olá");
  });
});

describe("landing texts", () => {
  it("prefers FIRINGI's own wording, then the translation, then own English, then English", () => {
    const s = src({ own: { a: "own" }, msgs: { a: "msg", b: "msg-b" }, ownEn: { b: "ownEn", c: "ownEn-c" }, msgsEn: { a: "en", b: "en", c: "en", d: "en-d" } });
    expect(lookup(s, "a")).toBe("own");
    expect(lookup(s, "b")).toBe("msg-b");
    expect(lookup(s, "c")).toBe("ownEn-c");
    expect(lookup(s, "d")).toBe("en-d");
    expect(lookup(src({ own: { a: "  " }, msgsEn: { a: "en" } }), "a")).toBe("en");
    expect(lookup(s, "missing")).toBe("");
  });
  it("lists numbered items from any source, minus the hidden ones", () => {
    const s = src({ msgsEn: { "faq.items.1.q": "", "faq.items.2.q": "", "faq.items.10.q": "" }, own: { "faq.items.3.q": "Mine" } });
    expect(listItems(s, "faq.items", [])).toEqual(["1", "2", "3", "10"]);
    expect(listItems(s, "faq.items", ["faq.items.2"])).toEqual(["1", "3", "10"]);
  });
  it("fills placeholders and flattens messages", () => {
    expect(fill("{n} boxes, {x}", { n: 3 })).toBe("3 boxes, {x}");
    expect(flatten({ a: { b: "1", c: { d: "2" } }, e: "3" })).toEqual({ "a.b": "1", "a.c.d": "2", e: "3" });
  });
  it("has the same landing texts in English and Portuguese, including the 14 categories", () => {
    const a = Object.keys(flatten(en.landing)).sort(), b = Object.keys(flatten(pt.landing)).sort();
    expect(b).toEqual(a);
    const e = src({ msgsEn: flatten(en.landing) });
    expect(listItems(e, "app.cats.items", [])).toHaveLength(14);
    expect(lookup(e, "sellPage.formH2")).toBeTruthy();
  });
  it("never tells buyers that vendors invoice them (FIRINGI invoices every buyer)", () => {
    for (const m of [en.landing, pt.landing]) for (const [k, v] of Object.entries(flatten(m))) {
      expect(`${k}: ${v}`).not.toMatch(/vendor(s)? (still )?(packs, )?invoices|each vendor invoices|fornecedor continua a preparar, faturar/i);
    }
  });
});

describe("vendor plan bullets", () => {
  const t = (k: string, v?: Record<string, string | number>) => fill(lookup(src({ msgsEn: flatten(en.landing) }), k), v) || k;
  it("describes limits, features and early payout", () => {
    const b = planBullets({ code: "PRO", name: "Pro", monthlyPrice: 49, features: [], maxProducts: 500, maxUsers: 5, maxWarehouses: 2, maxDrivers: null, earlyPayModel: "PERCENT", earlyPayRate: 1.5, freeEarlyPays: 0 }, t, "en");
    expect(b[0]).toContain("500");
    expect(b.some((x) => x.includes("1.5"))).toBe(true);
  });
});

describe("visitor forms", () => {
  const ok: ContactIn = { kind: "QUESTION", name: "Ana", company: "Café Ana", email: "ana@cafe.pt", phone: "", nif: "", type: "", message: "Hello", consent: true, website: "", startedAt: 1_000 };
  it("accepts a real message and names the first problem", () => {
    expect(checkContact(ok, 10_000)).toBeNull();
    expect(checkContact({ ...ok, name: " " }, 10_000)).toBe("REQUIRED");
    expect(checkContact({ ...ok, email: "ana@" }, 10_000)).toBe("EMAIL");
    expect(checkContact({ ...ok, consent: false }, 10_000)).toBe("CONSENT");
  });
  it("spots robots: honeypot, too fast, too many links", () => {
    expect(looksLikeSpam({ ...ok, website: "x" }, 10_000)).toBe(true);
    expect(looksLikeSpam(ok, 2_000)).toBe(true);
    expect(looksLikeSpam({ ...ok, message: "http://a http://b http://c" }, 10_000)).toBe(true);
    expect(looksLikeSpam(ok, 10_000)).toBe(false);
  });
  it("limits messages per visitor", () => {
    expect(underLimit([1, 2, 3, 4], 5, 5, 100).ok).toBe(true);
    expect(underLimit([1, 2, 3, 4, 5], 6, 5, 100).ok).toBe(false);
    expect(underLimit([1, 2, 3, 4, 5], 500, 5, 100).ok).toBe(true);
    expect(isEmail("a@b.pt")).toBe(true);
  });
});

describe("legal pages", () => {
  it("fills the company details into the GDPR privacy policy, in Portuguese for pt", () => {
    const co = { legalName: "FIRINGI Lda", nif: "509000000", address: "Lisboa", email: "privacy@firingi.test" };
    const en1 = defaultLegal("privacy", "en", co), pt1 = defaultLegal("privacy", "pt-PT", co);
    expect(en1).toContain("FIRINGI Lda, NIF 509000000, Lisboa");
    expect(en1).toContain("GDPR");
    expect(en1).toContain("privacy@firingi.test");
    expect(pt1).toContain("RGPD");
    expect(pt1).toContain("CNPD");
    expect(defaultLegal("cookies", "de", { ...co, email: "" })).toContain("the contact form on the website");
    expect(defaultLegal("terms", "en", co)).toMatch(/FIRINGI invoices you/);
  });
});
