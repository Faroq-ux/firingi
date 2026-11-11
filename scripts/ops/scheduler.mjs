#!/usr/bin/env node
/**
 * FIRINGI scheduler: calls the app's job endpoints on time (UTC) with the CRON_SECRET. The app
 * records every run (System Health › Scheduled jobs) and alerts when a job stops or keeps failing.
 *   notifications every 2 min · invoicing every 5 · ops every 5 (+1) · allocation every 10 (+3) · ai hourly (:07)
 * Runs anywhere Node 18+ runs:  APP_INTERNAL_URL=http://app:3000 CRON_SECRET=… node scheduler.mjs
 */
const BASE = (process.env.APP_INTERNAL_URL ?? "http://app:3000").replace(/\/$/, "");
const SECRET = process.env.CRON_SECRET;
if (!SECRET) { console.error("CRON_SECRET is not set"); process.exit(1); }
const SCHEDULE = [
  { job: "notifications", due: (m) => m % 2 === 0 },
  { job: "invoicing", due: (m) => m % 5 === 0 },
  { job: "ops", due: (m) => m % 5 === 1 },
  { job: "allocation", due: (m) => m % 10 === 3 },
  { job: "ai", due: (m) => m % 60 === 7 },
];
const running = new Set();
const log = (...a) => console.log(new Date().toISOString(), ...a);

async function call(job) {
  if (running.has(job)) return log("skip", job, "(previous run still going)");
  running.add(job);
  const t0 = Date.now();
  try {
    const r = await fetch(`${BASE}/api/cron/${job}`, { method: "POST", headers: { authorization: `Bearer ${SECRET}` }, signal: AbortSignal.timeout(600_000) });
    const text = (await r.text()).slice(0, 300);
    log(r.ok ? "ok  " : "FAIL", job, `HTTP ${r.status}`, `${Date.now() - t0}ms`, text);
  } catch (e) {
    log("FAIL", job, e instanceof Error ? e.message : String(e));
  } finally {
    running.delete(job);
  }
}

function tick() {
  const now = new Date();
  const m = now.getUTCHours() * 60 + now.getUTCMinutes();
  for (const s of SCHEDULE) if (s.due(m)) void call(s.job);
}

log(`scheduler started → ${BASE}`);
if (process.argv.includes("--once")) {
  // Run every job once now (deploy check), then exit.
  await Promise.all(SCHEDULE.map((s) => call(s.job)));
} else {
  const next = () => setTimeout(() => { tick(); next(); }, 60_000 - (Date.now() % 60_000) + 50);
  next();
  process.on("SIGTERM", () => { log("stopping"); process.exit(0); });
}
