import { NextResponse, type NextRequest } from "next/server";
import { getSessionCookie } from "better-auth/cookies";

/**
 * Fast edge check: protected portals require a session cookie. The real checks
 * (valid session, approval status, permissions) happen server-side in every
 * layout, page and action — this only avoids rendering for anonymous visitors.
 */
const PROTECTED = ["/admin", "/vendor", "/buy", "/driver", "/application-status"];

const DEV = process.env.NODE_ENV !== "production";
/**
 * Content Security Policy: only FIRINGI's own scripts, styles, images and connections (plus
 * Sentry's ingest when error tracking is on). Inline scripts stay allowed because Next.js
 * hydration uses them; no third-party script can load and the app can't be framed.
 */
const CSP = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${DEV ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  `connect-src 'self' https://*.sentry.io https://*.ingest.sentry.io https://*.ingest.de.sentry.io${DEV ? " ws:" : ""}`,
  "worker-src 'self'",
  "manifest-src 'self'",
  "media-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

export function securityHeaders(req: NextRequest): Record<string, string> {
  const https = req.nextUrl.protocol === "https:" || req.headers.get("x-forwarded-proto") === "https";
  return {
    "Content-Security-Policy": CSP + (https ? "; upgrade-insecure-requests" : ""),
    "X-Frame-Options": "DENY",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy": "camera=(self), geolocation=(self), microphone=(), payment=(), usb=(), interest-cohort=()",
    "Cross-Origin-Opener-Policy": "same-origin",
    ...(https ? { "Strict-Transport-Security": "max-age=63072000; includeSubDomains" } : {}),
  };
}

export function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  if (PROTECTED.some((p) => pathname === p || pathname.startsWith(`${p}/`)) && !getSessionCookie(req)) {
    const url = new URL("/login", req.url);
    url.searchParams.set("next", pathname + search);
    return NextResponse.redirect(url);
  }
  const res = NextResponse.next();
  for (const [k, v] of Object.entries(securityHeaders(req))) res.headers.set(k, v);
  return res;
}

export const config = { matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"] };
