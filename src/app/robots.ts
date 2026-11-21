import type { MetadataRoute } from "next";

/** Phase 56: search engines may read the landing and legal pages; the portals stay out. */
export default function robots(): MetadataRoute.Robots {
  const base = (process.env.APP_URL ?? process.env.BETTER_AUTH_URL ?? "http://localhost:3000").replace(/\/$/, "");
  return {
    rules: [{ userAgent: "*", allow: ["/", "/legal/"], disallow: ["/admin", "/vendor", "/buy", "/driver", "/api", "/welcome", "/newsletter", "/pay"] }],
    sitemap: `${base}/sitemap.xml`,
  };
}
