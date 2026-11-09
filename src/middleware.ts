import { NextResponse, type NextRequest } from "next/server";
import { getSessionCookie } from "better-auth/cookies";

/**
 * Fast edge check: protected portals require a session cookie. The real checks
 * (valid session, approval status, permissions) happen server-side in every
 * layout, page and action — this only avoids rendering for anonymous visitors.
 */
const PROTECTED = ["/admin", "/vendor", "/buy", "/driver", "/application-status"];

export function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  if (PROTECTED.some((p) => pathname === p || pathname.startsWith(`${p}/`)) && !getSessionCookie(req)) {
    const url = new URL("/login", req.url);
    url.searchParams.set("next", pathname + search);
    return NextResponse.redirect(url);
  }
  const res = NextResponse.next();
  // Basic security headers (CSP to be tightened once third-party scripts are known).
  res.headers.set("X-Frame-Options", "DENY");
  res.headers.set("X-Content-Type-Options", "nosniff");
  res.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  return res;
}

export const config = { matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"] };
