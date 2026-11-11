/**
 * Phase 19: job-run log, health report, built-in alerts (open once, re-notify, escalate, resolve),
 * error log, health / heartbeat / cron endpoints, public status.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { jobStatus, recordExternalRun, runJob } from "@/server/ops/jobs";
import { healthReport } from "@/server/ops/health";
import { checkAndAlert } from "@/server/ops/alerts";
import { errorCount, errorGroups, recordError } from "@/server/ops/errors";
import { publicStatus } from "@/server/ops/status";
import { GET as health } from "@/app/api/health/route";
import { POST as heartbeat } from "@/app/api/ops/heartbeat/route";
import { POST as cronOps } from "@/app/api/cron/ops/route";

const SECRET = "test-cron-secret-0123456789abcdef";
const auth = { authorization: `Bearer ${SECRET}` };
const fail = (job: string) => runJob(job, async () => { throw new Error(`${job} broke`); }).catch(() => null);
const opsMessages = (event: string) => prisma.notificationMessage.count({ where: { eventKey: event, user: { email: "superadmin@firingi.test" } } });
let savedSecret: string | undefined;

beforeAll(async () => {
  savedSecret = process.env.CRON_SECRET;
  process.env.CRON_SECRET = SECRET;
  await prisma.opsAlert.deleteMany();
  await prisma.jobRun.deleteMany();
  await prisma.errorEvent.deleteMany();
});
afterAll(async () => {
  process.env.CRON_SECRET = savedSecret;
  await prisma.opsAlert.deleteMany();
  await prisma.jobRun.deleteMany();
});

describe("job-run log", () => {
  it("records successes with their result and failures with the error", async () => {
    expect(await runJob("ai", async () => ({ refreshed: 3 }))).toEqual({ refreshed: 3 });
    await expect(runJob("ai", async () => { throw new Error("model down"); })).rejects.toThrow("model down");
    const runs = await prisma.jobRun.findMany({ where: { job: "ai" }, orderBy: { startedAt: "asc" } });
    expect(runs.map((r) => r.ok)).toEqual([true, false]);
    expect(runs[0].summary).toEqual({ refreshed: 3 });
    expect(runs[1].error).toContain("model down");
    expect(runs.every((r) => r.finishedAt && r.durationMs !== null)).toBe(true);
  });

  it("knows never / ok / last-failed / failing / stale", async () => {
    let s = Object.fromEntries((await jobStatus()).map((j) => [j.key, j.state]));
    expect(s.allocation).toBe("never");
    expect(s.ai).toBe("last-failed");
    await runJob("allocation", async () => ({}));
    s = Object.fromEntries((await jobStatus()).map((j) => [j.key, j.state]));
    expect(s.allocation).toBe("ok");
    for (let i = 0; i < 3; i++) await fail("allocation");
    s = Object.fromEntries((await jobStatus()).map((j) => [j.key, j.state]));
    expect(s.allocation).toBe("failing");
    await prisma.jobRun.deleteMany({ where: { job: "allocation" } });
    await prisma.jobRun.create({ data: { job: "allocation", ok: true, startedAt: new Date(Date.now() - 90 * 60_000), finishedAt: new Date(Date.now() - 89 * 60_000), durationMs: 50 } });
    s = Object.fromEntries((await jobStatus()).map((j) => [j.key, j.state]));
    expect(s.allocation).toBe("stale"); // allowed 45 min
  });

  it("only the external jobs (backup, restore test) can report from outside", async () => {
    await expect(recordExternalRun({ job: "invoicing", ok: true })).rejects.toThrow(/Unknown external job/);
    const r = await recordExternalRun({ job: "backup", ok: true, durationMs: 4200, summary: { bytes: 1234 } });
    expect(r.durationMs).toBe(4200);
    expect(r.finishedAt!.getTime() - r.startedAt.getTime()).toBe(4200);
  });
});

describe("health report and alerts", () => {
  it("a failing critical job makes the report critical; jobs that never ran are not problems outside production", async () => {
    for (let i = 0; i < 3; i++) await fail("invoicing");
    const r = await healthReport();
    const byKey = Object.fromEntries(r.checks.map((c) => [c.key, c.state]));
    expect(byKey.db).toBe("ok");
    expect(byKey.storage).toBe("ok");
    expect(byKey["job:invoicing"]).toBe("critical");
    expect(byKey["job:allocation"]).toBe("critical"); // stale + critical job
    expect(byKey["job:notifications"]).toBeUndefined(); // never ran here
    expect(r.status).toBe("critical");
    const st = await publicStatus();
    expect(st.components.find((c) => c.key === "invoicing")!.state).toBe("critical");
    expect(st.components.find((c) => c.key === "files")!.state).toBe("ok");
  });

  it("opens one alert per problem and tells the super admins once", async () => {
    const before = await opsMessages("ops.alert");
    const a = await checkAndAlert();
    expect(a.opened).toBeGreaterThanOrEqual(2);
    const open = await prisma.opsAlert.findMany({ where: { resolvedAt: null } });
    expect(open.map((o) => o.key)).toEqual(expect.arrayContaining(["job:invoicing", "job:allocation"]));
    expect(open.find((o) => o.key === "job:invoicing")!.severity).toBe("CRITICAL");
    expect(await opsMessages("ops.alert")).toBeGreaterThan(before);

    const again = await checkAndAlert();
    expect(again.opened).toBe(0);
    expect(again.renotified).toBe(0);
    expect(await prisma.opsAlert.count({ where: { key: "job:invoicing" } })).toBe(1);
  });

  it("reminds again after 6 hours while the problem lasts", async () => {
    await prisma.opsAlert.updateMany({ where: { key: "job:invoicing", resolvedAt: null }, data: { notifiedAt: new Date(Date.now() - 7 * 3600_000) } });
    const before = await opsMessages("ops.alert");
    const r = await checkAndAlert();
    expect(r.renotified).toBe(1);
    expect(await opsMessages("ops.alert")).toBeGreaterThan(before);
  });

  it("resolves the alert when the job works again and says so", async () => {
    await runJob("invoicing", async () => ({ fiscal: 0 }));
    await runJob("allocation", async () => ({}));
    const before = await opsMessages("ops.resolved");
    const r = await checkAndAlert();
    expect(r.resolved).toBeGreaterThanOrEqual(2);
    const inv = await prisma.opsAlert.findFirstOrThrow({ where: { key: "job:invoicing" } });
    expect(inv.resolvedAt).not.toBeNull();
    expect(await opsMessages("ops.resolved")).toBeGreaterThan(before);
  });
});

describe("error log", () => {
  it("keeps one event per burst of the same error and groups them", async () => {
    const stack = "Error: boom\n    at handler (/app/route.js:10:5)";
    expect(await recordError({ source: "server", message: "boom", stack, path: "GET /x" })).toBe(true);
    expect(await recordError({ source: "server", message: "boom", stack, path: "GET /x" })).toBe(false); // same error within 5 s
    expect(await recordError({ source: "browser", message: "Script error in cart", path: "/buy/orders/cart", userAgent: "x" })).toBe(true);
    expect(await errorCount(15, "server")).toBe(1);
    expect(await errorCount(15)).toBe(2);
    const g = await errorGroups(1);
    expect(g.map((x) => x.message).sort()).toEqual(["Script error in cart", "boom"]);
  });
});

describe("endpoints", () => {
  it("/api/health answers for uptime monitors; the full report needs the secret", async () => {
    const live = await health(new Request("http://x/api/health"));
    expect(live.status).toBe(200);
    expect(await live.json()).toMatchObject({ status: "ok" });
    expect((await health(new Request("http://x/api/health?full=1"))).status).toBe(401);
    const full = await health(new Request("http://x/api/health?full=1", { headers: auth }));
    const body = await full.json();
    expect(body.checks.length).toBeGreaterThan(5);
    expect(body.jobs.map((j: { key: string }) => j.key)).toContain("backup");
  });

  it("the backup service reports through /api/ops/heartbeat (failures too)", async () => {
    const post = (b: unknown, h: Record<string, string> = auth) => heartbeat(new Request("http://x/api/ops/heartbeat", { method: "POST", headers: { ...h, "content-type": "application/json" }, body: JSON.stringify(b) }));
    expect((await post({ job: "backup", ok: true }, {})).status).toBe(401);
    expect((await post({ job: "invoicing", ok: true })).status).toBe(400);
    expect((await post({ job: "backup", ok: false, durationMs: 1200, summary: null, error: "pg_dump: connection refused" })).status).toBe(200);
    const last = await prisma.jobRun.findFirstOrThrow({ where: { job: "backup" }, orderBy: { startedAt: "desc" } });
    expect(last.ok).toBe(false);
    expect(last.error).toContain("pg_dump");
  });

  it("cron routes refuse without the secret and record their run", async () => {
    expect((await cronOps(new Request("http://x/api/cron/ops", { method: "POST" }))).status).toBe(401);
    expect((await cronOps(new Request("http://x/api/cron/ops", { method: "POST", headers: { authorization: "Bearer wrong-secret-0123456789abcdef" } }))).status).toBe(401);
    const r = await cronOps(new Request("http://x/api/cron/ops", { method: "POST", headers: auth }));
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ pruned: { jobs: 0, errors: 0 } });
    expect(await prisma.jobRun.count({ where: { job: "ops", ok: true } })).toBe(1);
  });
});
