/**
 * Browser errors: reported to FIRINGI's own error log (/api/client-errors, at most a few per
 * page) and to Sentry when the server set a DSN (window.__FIRINGI__, see the root layout).
 */
import * as Sentry from "@sentry/nextjs";

type Cfg = { sentryDsn?: string | null; release?: string | null; env?: string | null };
const cfg: Cfg = (typeof window !== "undefined" && (window as unknown as { __FIRINGI__?: Cfg }).__FIRINGI__) || {};

if (cfg.sentryDsn) Sentry.init({ dsn: cfg.sentryDsn, release: cfg.release ?? undefined, environment: cfg.env ?? undefined, tracesSampleRate: 0 });

let sent = 0;
function report(message: string, stack?: string) {
  if (sent++ >= 5 || !message) return;
  const body = JSON.stringify({ message: message.slice(0, 1000), stack: stack?.slice(0, 6000), path: location.pathname });
  try { navigator.sendBeacon?.("/api/client-errors", new Blob([body], { type: "application/json" })) || fetch("/api/client-errors", { method: "POST", body, headers: { "content-type": "application/json" }, keepalive: true }); } catch { /* never break the page */ }
}
if (typeof window !== "undefined") {
  window.addEventListener("error", (e) => report(e.message || String(e.error), e.error?.stack));
  window.addEventListener("unhandledrejection", (e) => { const r = e.reason as Error | undefined; report(r?.message ?? String(e.reason), r?.stack); });
}

export const onRouterTransitionStart = cfg.sentryDsn ? Sentry.captureRouterTransitionStart : undefined;
