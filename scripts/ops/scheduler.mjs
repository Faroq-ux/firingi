#!/usr/bin/env node
/**
 * FIRINGI scheduler: calls the app's job endpoints on time (UTC) with the CRON_SECRET. The app
 * records every run (System Health › Scheduled jobs) and alerts when a job stops or keeps failing.
 *   notifications every 2 min · invoicing every 5 · payments every 5 (+2) · ops every 5 (+1) · integrations every 5 (+4) · allocation every 10 (+3) · ai hourly (:07) · pricing hourly (:23) · inventory daily (06:13) · compliance daily (05:47) · planning daily (04:37) · buying every 15 (+11)
 * Runs anywhere Node 18+ runs:  APP_INTERNAL_URL=http://app:3000 CRON_SECRET=… node scheduler.mjs
 */
const BASE = (process.env.APP_INTERNAL_URL ?? "http://app:3000").replace(/\/$/, "");
const SECRET = process.env.CRON_SECRET;
if (!SECRET) { console.error("CRON_SECRET is not set"); process.exit(1); }
const SCHEDULE = [
  { job: "notifications", due: (m) => m % 2 === 0 },
  { job: "invoicing", due: (m) => m % 5 === 0 },
  { job: "payments", due: (m) => m % 5 === 2 },
  { job: "ops", due: (m) => m % 5 === 1 },
  { job: "integrations", due: (m) => m % 5 === 4 },
  { job: "allocation", due: (m) => m % 10 === 3 },
  { job: "ai", due: (m) => m % 60 === 7 },
  { job: "pricing", due: (m) => m % 60 === 23 },
  { job: "inventory", due: (m) => m % 1440 === 6 * 60 + 13 }, // daily 06:13 UTC
  { job: "compliance", due: (m) => m % 1440 === 5 * 60 + 47 }, // daily 05:47 UTC
  { job: "planning", due: (m) => m % 1440 === 4 * 60 + 37 }, // daily 04:37 UTC — forecasts & restock suggestions
  { job: "claims", due: (m) => m % 1440 === 7 * 60 + 19 }, // daily 07:19 UTC — claim SLA, supplier reminders, charge-backs, quality alerts
  { job: "buying", due: (m) => m % 15 === 11 }, // recurring orders & quotes, every 15 min (+11)
  { job: "groups", due: (m) => m % 15 === 7 }, // every 15 min (+7) — buying groups' group orders placed at their close
  { job: "paylater", due: (m) => m % 15 === 9 }, // every 15 min (+9) — pay later: partner capture, instalments, reminders
  { job: "tenders", due: (m) => m % 15 === 11 }, // every 15 min (+11) — tenders closing at their deadline
  { job: "reviews", due: (m) => m % 1440 === 10 * 60 + 17 }, // daily 10:17 UTC — "How was …?" review reminders after delivery
  { job: "staff", due: (m) => m % 15 === 13 }, // every 15 min (+13) — staff shift reminders, forgotten clock-outs, no-shows
  { job: "rebates", due: (m) => m % 1440 === 3 * 60 + 29 }, // daily 03:29 UTC — rebates & bonuses settled
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
