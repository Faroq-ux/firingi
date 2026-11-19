import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const nextConfig: NextConfig = {
  // Prisma + better-auth must run on the Node runtime, never bundled for the edge.
  serverExternalPackages: ["@prisma/client", ".prisma/client", "@react-pdf/renderer"],
  typedRoutes: false,
  // A self-contained server (.next/standalone) for the Docker image — runs on any host with Node or Docker.
  output: "standalone",
  // Document uploads go through server actions (max file size is enforced again in the storage service).
  // webpackMemoryOptimizations: lower peak memory while building (the build box has ~10 GB)
  experimental: { serverActions: { bodySizeLimit: "12mb" }, webpackMemoryOptimizations: true },
  poweredByHeader: false,
  // API answers (the middleware covers pages): never sniffed, never framed, never cached by proxies.
  async headers() {
    return [{ source: "/api/:path*", headers: [
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "X-Frame-Options", value: "DENY" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      { key: "Cache-Control", value: "no-store" },
    ] }];
  },
};

export default withNextIntl(nextConfig);
