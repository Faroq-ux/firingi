import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const nextConfig: NextConfig = {
  // Prisma + better-auth must run on the Node runtime, never bundled for the edge.
  serverExternalPackages: ["@prisma/client", ".prisma/client", "@react-pdf/renderer"],
  typedRoutes: false,
  // Document uploads go through server actions (max file size is enforced again in the storage service).
  experimental: { serverActions: { bodySizeLimit: "12mb" } },
};

export default withNextIntl(nextConfig);
