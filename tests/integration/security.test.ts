/**
 * Phase 11: security policy — required two-factor login, session length, sessions.
 */
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { DEFAULT_SECURITY, endOtherSessions, endSession, mustSetUpTwoFactor, mySessions, resetTwoFactor, securityOverview, sessionTooOld, setSecurityPolicy, signOutEverywhere } from "@/server/services/security";
import { ctxFor } from "../helpers";

const SA = "superadmin@firingi.test";
afterEach(() => prisma.setting.deleteMany({ where: { key: "security.policy" } }));
afterAll(() => prisma.$disconnect());

async function fakeSessions(email: string, n: number) {
  const u = await prisma.user.findUniqueOrThrow({ where: { email } });
  const ids = [];
  for (let i = 0; i < n; i++)
    ids.push((await prisma.session.create({ data: { userId: u.id, token: `t-${Date.now()}-${i}-${Math.random()}`, expiresAt: new Date(Date.now() + 3600_000), userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X) Chrome/120", ipAddress: "10.0.0.1" } })).id);
  return ids;
}

describe("security policy", () => {
  it("defaults: nothing required, 12-hour sessions", async () => {
    expect(DEFAULT_SECURITY).toEqual({ requireTwoFactorStaff: false, requireTwoFactorOwners: false, maxSessionHours: 12 });
    expect(await mustSetUpTwoFactor(await ctxFor("ops@firingi.test"))).toBe(false);
    expect(await sessionTooOld(new Date(Date.now() - 11 * 3600_000))).toBe(false);
    expect(await sessionTooOld(new Date(Date.now() - 13 * 3600_000))).toBe(true);
  });

  it("required for staff: staff without it must set it up; drivers, owners and staff with it don't", async () => {
    const sa = await ctxFor(SA);
    await expect(setSecurityPolicy(sa, { requireTwoFactorStaff: true, requireTwoFactorOwners: false, maxSessionHours: 8 })).rejects.toThrow(/for yourself first/);
    await setSecurityPolicy({ ...sa, user: { ...sa.user, twoFactor: true } }, { requireTwoFactorStaff: true, requireTwoFactorOwners: false, maxSessionHours: 8 });
    expect(await mustSetUpTwoFactor(await ctxFor("ops@firingi.test"))).toBe(true);
    expect(await mustSetUpTwoFactor(await ctxFor("driver@firingi.test"))).toBe(false);
    expect(await mustSetUpTwoFactor(await ctxFor("owner@kebabhouse.test"))).toBe(false);
    const ops = await prisma.user.findUniqueOrThrow({ where: { email: "ops@firingi.test" } });
    await prisma.user.update({ where: { id: ops.id }, data: { twoFactorEnabled: true } });
    try {
      expect(await mustSetUpTwoFactor(await ctxFor("ops@firingi.test"))).toBe(false);
    } finally {
      await prisma.user.update({ where: { id: ops.id }, data: { twoFactorEnabled: false } });
    }
    expect(await sessionTooOld(new Date(Date.now() - 9 * 3600_000))).toBe(true);
  });

  it("required for owners: owners yes, employees no", async () => {
    await setSecurityPolicy(await ctxFor(SA), { requireTwoFactorStaff: false, requireTwoFactorOwners: true, maxSessionHours: 12 });
    expect(await mustSetUpTwoFactor(await ctxFor("owner@kebabhouse.test"))).toBe(true);
    expect(await mustSetUpTwoFactor(await ctxFor("buyer@kebabhouse.test"))).toBe(false);
    expect(await mustSetUpTwoFactor(await ctxFor("ops@firingi.test"))).toBe(false);
  });

  it("only Super Admin changes it; values are checked", async () => {
    await expect(setSecurityPolicy(await ctxFor("ops@firingi.test"), DEFAULT_SECURITY)).rejects.toThrow();
    await expect(setSecurityPolicy(await ctxFor("owner@lisboacentral.test"), DEFAULT_SECURITY)).rejects.toThrow();
    await expect(setSecurityPolicy(await ctxFor(SA), { ...DEFAULT_SECURITY, maxSessionHours: 0 })).rejects.toThrow(/1–168/);
  });
});

describe("sessions", () => {
  it("users see and end their own sessions", async () => {
    const ctx = await ctxFor("buyer@kebabhouse.test");
    const [a, b] = await fakeSessions("buyer@kebabhouse.test", 2);
    const mine = await mySessions(ctx);
    expect(mine.find((s) => s.id === a)).toMatchObject({ device: "Chrome · macOS", ip: "10.0.0.1", current: false });
    await endSession(ctx, a);
    expect((await mySessions(ctx)).some((s) => s.id === a)).toBe(false);
    await expect(endSession(await ctxFor("owner@kebabhouse.test"), b)).rejects.toThrow(); // not theirs
    expect(await endOtherSessions(ctx)).toBeGreaterThanOrEqual(1);
    expect((await mySessions(ctx)).filter((s) => !s.current)).toHaveLength(0);
  });

  it("Super Admin signs a user out everywhere and resets two-factor", async () => {
    const sa = await ctxFor(SA);
    await fakeSessions("support@firingi.test", 3);
    const support = await prisma.user.findUniqueOrThrow({ where: { email: "support@firingi.test" } });
    expect(await signOutEverywhere(sa, support.id)).toBeGreaterThanOrEqual(3);
    expect(await prisma.session.count({ where: { userId: support.id } })).toBe(0);
    await prisma.user.update({ where: { id: support.id }, data: { twoFactorEnabled: true } });
    await prisma.twoFactor.create({ data: { userId: support.id, secret: "x", backupCodes: "y" } });
    expect((await securityOverview(sa)).find((u) => u.id === support.id)?.twoFactor).toBe(true);
    await resetTwoFactor(sa, support.id);
    expect(await prisma.twoFactor.count({ where: { userId: support.id } })).toBe(0);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: support.id } })).twoFactorEnabled).toBe(false);
    await expect(resetTwoFactor(sa, sa.user.id)).rejects.toThrow(/own/);
    await expect(signOutEverywhere(await ctxFor("support@firingi.test"), sa.user.id)).rejects.toThrow();
  });
});
