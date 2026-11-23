/** Footer pages (FIRINGI only): sustainability / careers settings, job openings and application checks. */
import { describe, expect, it } from "vitest";
import { checkApplication, cleanLanding, jobId, mergeLanding } from "@/lib/landing";

const base = { jobId: "", name: "Ana Silva", email: "ana@example.com", phone: "", link: "", message: "", consent: true, website: "", startedAt: Date.now() - 10_000 };

describe("applications", () => {
  it("accepts a real application; refuses spam, missing fields, bad e-mail or link, no consent", () => {
    expect(checkApplication(base)).toBeNull();
    expect(checkApplication({ ...base, link: "https://www.linkedin.com/in/ana" })).toBeNull();
    expect(checkApplication({ ...base, website: "x" })).toBe("SPAM");
    expect(checkApplication({ ...base, startedAt: Date.now() })).toBe("SPAM");
    expect(checkApplication({ ...base, name: " " })).toBe("REQUIRED");
    expect(checkApplication({ ...base, email: "ana@" })).toBe("EMAIL");
    expect(checkApplication({ ...base, link: "http://cv.example.com" })).toBe("LINK");
    expect(checkApplication({ ...base, consent: false })).toBe("CONSENT");
  });
  it("job ids from titles, unique", () => {
    expect(jobId("Sales Manager – Lisboa", [])).toBe("sales-manager-lisboa");
    expect(jobId("Sales Manager – Lisboa", ["sales-manager-lisboa"])).toBe("sales-manager-lisboa-2");
    expect(jobId("Ação & Logística", [])).toBe("acao-logistica");
  });
});

describe("settings", () => {
  it("both pages on by default; old settings without them still read", () => {
    const s = mergeLanding({});
    expect(s.about.sustainability.on).toBe(true);
    expect(s.about.careers.on).toBe(true);
    expect(s.jobs).toEqual([]);
    expect(mergeLanding({ about: { careers: { on: false, text: { en: "Hi" } } } } as never).about).toEqual({ sustainability: { on: true, text: {} }, careers: { on: false, text: { en: "Hi" } } });
  });
  it("checks openings and the careers e-mail", () => {
    const ok = mergeLanding({ jobs: [{ id: "driver", title: " Driver ", location: "Porto", type: "FULL_TIME", text: "", on: true }] } as never);
    expect(cleanLanding(ok, ["en"]).jobs[0].title).toBe("Driver");
    expect(() => cleanLanding(mergeLanding({ jobs: [{ id: "x", title: "", location: "", type: "FULL_TIME", text: "", on: true }] } as never), ["en"])).toThrow(/title/);
    expect(() => cleanLanding(mergeLanding({ jobs: [{ id: "a", title: "A" }, { id: "a", title: "B" }] } as never), ["en"])).toThrow(/unique/);
    expect(() => cleanLanding(mergeLanding({ careersEmail: "nope" }), ["en"])).toThrow(/e-mail/);
    expect(() => cleanLanding(mergeLanding({ about: { sustainability: { on: true, text: { xx: "t" } } } } as never), ["en"])).toThrow(/language/);
  });
});
