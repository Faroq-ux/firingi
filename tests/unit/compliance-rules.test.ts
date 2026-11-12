import { describe, expect, it } from "vitest";
import { applies, evaluate, pausePlan, reminderDue, score, type CertLite } from "@/server/compliance/rules";

const T = { id: "t1", key: "HACCP", hasExpiry: true, graceDays: 0 };
const D = (s: string) => new Date(`${s}T00:00:00Z`);
const today = D("2026-11-12");
const cert = (o: Partial<CertLite>): CertLite => ({ id: "c", typeId: "t1", status: "APPROVED", expiresOn: null, reviewedAt: D("2026-01-01"), createdAt: D("2026-01-01"), supersededAt: null, ...o });

describe("certificate state", () => {
  it("missing, pending, rejected", () => {
    expect(evaluate(T, [], [], today).state).toBe("MISSING");
    expect(evaluate(T, [cert({ status: "PENDING", reviewedAt: null })], [], today).state).toBe("PENDING");
    expect(evaluate(T, [cert({ status: "REJECTED" })], [], today).state).toBe("REJECTED");
    expect(evaluate(T, [cert({ typeId: "other" })], [], today).state).toBe("MISSING");
  });
  it("valid, expiring within 30 days, expiring today still counts", () => {
    expect(evaluate(T, [cert({ expiresOn: D("2027-06-01") })], [], today)).toMatchObject({ state: "VALID", daysLeft: 201 });
    expect(evaluate(T, [cert({ expiresOn: D("2026-12-01") })], [], today)).toMatchObject({ state: "EXPIRING", daysLeft: 19 });
    expect(evaluate(T, [cert({ expiresOn: D("2026-11-12") })], [], today)).toMatchObject({ state: "EXPIRING", daysLeft: 0 });
    expect(evaluate({ ...T, hasExpiry: false }, [cert({ expiresOn: D("2020-01-01") })], [], today).state).toBe("VALID");
  });
  it("expired → grace days → expired; a waiver covers it", () => {
    const c = [cert({ status: "EXPIRED", expiresOn: D("2026-11-05") })];
    expect(evaluate(T, c, [], today).state).toBe("EXPIRED");
    expect(evaluate({ ...T, graceDays: 14 }, c, [], today)).toMatchObject({ state: "GRACE", graceUntil: D("2026-11-19") });
    expect(evaluate({ ...T, graceDays: 7 }, c, [], today).state).toBe("GRACE"); // grace ends today
    expect(evaluate({ ...T, graceDays: 6 }, c, [], today).state).toBe("EXPIRED");
    expect(evaluate(T, c, [{ typeId: "t1", until: D("2026-11-30"), revokedAt: null }], today).state).toBe("WAIVED");
    expect(evaluate(T, c, [{ typeId: "t1", until: D("2026-11-11"), revokedAt: null }], today).state).toBe("EXPIRED");
    expect(evaluate(T, c, [{ typeId: "t1", until: D("2026-11-30"), revokedAt: D("2026-11-10") }], today).state).toBe("EXPIRED");
  });
  it("a pending renewal doesn't replace the valid certificate; superseded ones are ignored", () => {
    const e = evaluate(T, [cert({ id: "old", expiresOn: D("2026-11-20") }), cert({ id: "new", status: "PENDING", reviewedAt: null, createdAt: D("2026-11-10") })], [], today);
    expect(e).toMatchObject({ state: "EXPIRING", current: { id: "old" }, pending: { id: "new" } });
    expect(evaluate(T, [cert({ supersededAt: D("2026-10-01"), expiresOn: D("2027-01-01") })], [], today).state).toBe("MISSING");
  });
  it("applies by supplier type and country", () => {
    const t = { ...T, appliesTo: ["WHOLESALER" as const], countryIds: ["pt"], categoryIds: [], required: true, isActive: true };
    expect(applies(t, { type: "WHOLESALER", countryId: "pt" })).toBe(true);
    expect(applies(t, { type: "DISTRIBUTOR", countryId: "pt" })).toBe(false);
    expect(applies(t, { type: "WHOLESALER", countryId: "es" })).toBe(false);
    expect(applies({ ...t, countryIds: [] }, { type: "WHOLESALER", countryId: "es" })).toBe(true);
    expect(applies({ ...t, isActive: false }, { type: "WHOLESALER", countryId: "pt" })).toBe(false);
  });
});

describe("score, pause plan, reminders", () => {
  it("required weigh double", () => {
    expect(score([])).toBe(100);
    expect(score([{ required: true, state: "VALID" }, { required: false, state: "MISSING" }])).toBe(67);
    expect(score([{ required: true, state: "EXPIRED" }, { required: false, state: "VALID" }])).toBe(33);
  });
  it("only required types that aren't covered pause — whole supplier or by category", () => {
    const p = pausePlan([
      { type: { key: "HACCP", required: true, categoryIds: [] }, state: "EXPIRED" },
      { type: { key: "HALAL", required: true, categoryIds: ["meat"] }, state: "MISSING" },
      { type: { key: "ORGANIC", required: false, categoryIds: [] }, state: "MISSING" },
      { type: { key: "TAX", required: true, categoryIds: [] }, state: "GRACE" },
    ]);
    expect(p).toEqual({ whole: ["HACCP"], byCategory: [{ key: "HALAL", categoryIds: ["meat"] }] });
  });
  it("one reminder per threshold; a late first run sends one message", () => {
    expect(reminderDue(45, [])).toBeNull();
    expect(reminderDue(30, [])).toEqual({ day: 30, mark: [30] });
    expect(reminderDue(20, [30])).toBeNull();
    expect(reminderDue(14, [30])).toEqual({ day: 14, mark: [14] });
    expect(reminderDue(5, [])).toEqual({ day: 7, mark: [30, 14, 7] });
    expect(reminderDue(3, [30, 14, 7])).toBeNull();
    expect(reminderDue(-1, [])).toBeNull();
  });
});
