import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const nextConfig: NextConfig = {
  // Prisma + better-auth must run on the Node runtime, never bundled for the edge.
  serverExternalPackages: ["@prisma/client", ".prisma/client"],
  typedRoutes: false,
};

export default withNextIntl(nextConfig);
