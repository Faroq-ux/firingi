#!/usr/bin/env node
/**
 * Simple load test (no extra tools): signs in as a demo/test user, then N concurrent virtual
 * users request a mix of pages for D seconds. Prints requests/s and latency percentiles per path.
 *   node scripts/load-test.mjs --url http://localhost:3000 --users 25 --seconds 30 \
 *     --email owner@kebabhouse.test --password '…' --paths /buy,/buy/shop,/buy/orders,/api/health
 * Run it against a staging copy, never against production with real customers.
 */
const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const BASE = arg("url", "http://localhost:3000").replace(/\/$/, "");
const USERS = Number(arg("users", 20)), SECONDS = Number(arg("seconds", 30));
const EMAIL = arg("email", process.env.LOAD_EMAIL), PASSWORD = arg("password", process.env.LOAD_PASSWORD);
const PATHS = arg("paths", "/api/health,/status").split(",");

async function signIn() {
  if (!EMAIL) return "";
  const r = await fetch(`${BASE}/api/auth/sign-in/email`, { method: "POST", headers: { "content-type": "application/json", origin: BASE }, body: JSON.stringify({ email: EMAIL, password: PASSWORD }) });
  if (!r.ok) throw new Error(`sign-in failed: HTTP ${r.status} ${await r.text()}`);
  return r.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
}
const pct = (a, p) => a.length ? a[Math.min(a.length - 1, Math.floor((p / 100) * a.length))] : 0;

const cookie = await signIn();
const stats = new Map(PATHS.map((p) => [p, { ms: [], errors: 0, codes: {} }]));
const end = Date.now() + SECONDS * 1000;
let i = 0;
async function vu() {
  while (Date.now() < end) {
    const path = PATHS[i++ % PATHS.length];
    const s = stats.get(path);
    const t0 = performance.now();
    try {
      const r = await fetch(BASE + path, { headers: cookie ? { cookie } : {}, redirect: "manual" });
      await r.arrayBuffer();
      s.codes[r.status] = (s.codes[r.status] ?? 0) + 1;
      if (r.status >= 400) s.errors++;
    } catch { s.errors++; s.codes.ERR = (s.codes.ERR ?? 0) + 1; }
    s.ms.push(performance.now() - t0);
  }
}
const t0 = Date.now();
await Promise.all(Array.from({ length: USERS }, vu));
const secs = (Date.now() - t0) / 1000;
let total = 0, errors = 0; const all = [];
console.log(`\n${USERS} users × ${SECONDS}s against ${BASE}${EMAIL ? ` (signed in as ${EMAIL})` : ""}\n`);
console.log("path".padEnd(34) + "req".padStart(7) + "req/s".padStart(8) + "p50".padStart(8) + "p95".padStart(8) + "p99".padStart(8) + "  codes");
for (const [p, s] of stats) {
  s.ms.sort((a, b) => a - b); total += s.ms.length; errors += s.errors; all.push(...s.ms);
  console.log(p.padEnd(34) + String(s.ms.length).padStart(7) + (s.ms.length / secs).toFixed(1).padStart(8) + `${pct(s.ms, 50).toFixed(0)}ms`.padStart(8) + `${pct(s.ms, 95).toFixed(0)}ms`.padStart(8) + `${pct(s.ms, 99).toFixed(0)}ms`.padStart(8) + "  " + JSON.stringify(s.codes));
}
all.sort((a, b) => a - b);
console.log("ALL".padEnd(34) + String(total).padStart(7) + (total / secs).toFixed(1).padStart(8) + `${pct(all, 50).toFixed(0)}ms`.padStart(8) + `${pct(all, 95).toFixed(0)}ms`.padStart(8) + `${pct(all, 99).toFixed(0)}ms`.padStart(8) + `  errors ${errors}`);
process.exitCode = errors ? 1 : 0;
