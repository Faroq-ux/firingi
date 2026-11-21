import type { MetadataRoute } from "next";

/** Phase 56: the public pages. */
export default function sitemap(): MetadataRoute.Sitemap {
  const base = (process.env.APP_URL ?? process.env.BETTER_AUTH_URL ?? "http://localhost:3000").replace(/\/$/, "");
  return ["", "/sell", "/register", "/login", "/legal/terms", "/legal/privacy", "/legal/cookies", "/legal/company"].map((p) => ({ url: `${base}${p}`, changeFrequency: p ? "monthly" : "weekly", priority: p ? 0.5 : 1 }));
}
