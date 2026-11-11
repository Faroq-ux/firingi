/**
 * Server start-up and server errors (Next.js instrumentation).
 * - Checks the environment (src/server/env.ts): with FIRINGI_ENV=production a missing or unsafe
 *   setting stops the start with a clear message; otherwise warnings are printed.
 * - Starts Sentry when SENTRY_DSN is set.
 * - Every server error is stored in FIRINGI's own error log (and sent to Sentry).
 */
import type { Instrumentation } from "next";

export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { checkEnv, strictEnv } = await import("./server/env");
  const findings = checkEnv(process.env);
  for (const f of findings) console[f.level === "error" ? "error" : "warn"](`[env] ${f.level.toUpperCase()} ${f.key}: ${f.message}`);
  if (strictEnv() && findings.some((f) => f.level === "error")) {
    // Next.js only logs errors thrown here and keeps serving — stop the process for real so the
    // container fails visibly (and the orchestrator doesn't route traffic to a misconfigured app).
    console.error(`[env] FIRINGI can't start: fix the settings above (${findings.filter((f) => f.level === "error").map((f) => f.key).join(", ")}).`);
    process.exit(1);
  }
  if (process.env.SENTRY_DSN) {
    const Sentry = await import("@sentry/nextjs");
    Sentry.init({
      dsn: process.env.SENTRY_DSN, environment: process.env.FIRINGI_ENV ?? "development", release: process.env.GIT_COMMIT,
      tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? 0),
    });
  }
}

export const onRequestError: Instrumentation.onRequestError = async (err, request, context) => {
  // Positive check (not an early return) so the edge bundle drops the Node-only imports.
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const e = err as Error & { digest?: string };
    const { recordError } = await import("./server/ops/errors");
    await recordError({ source: "server", message: e?.message ?? String(err), stack: e?.stack ?? null, path: `${request.method} ${request.path} (${context.routeType})`, digest: e?.digest ?? null });
    if (process.env.SENTRY_DSN) {
      const Sentry = await import("@sentry/nextjs");
      Sentry.captureRequestError(err, request, context);
    }
  }
};
