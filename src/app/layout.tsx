import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import { NextIntlClientProvider } from "next-intl";
import { getLocale } from "next-intl/server";
import { cookies } from "next/headers";
import { ThemeScript } from "@/components/theme/theme-script";
import { BgLayer, isBackground, DEFAULT_BG } from "@/components/theme/bg";
import "./globals.css";
import "./jogaru-look.css";

const inter = Inter({ subsets: ["latin", "latin-ext"], variable: "--font-inter" });

export const metadata: Metadata = {
  title: { default: "FIRINGI — Wholesale made simple", template: "%s · FIRINGI" },
  description: "FIRINGI — Wholesale made simple. B2B marketplace and ERP for distributors, wholesalers and businesses",
};

/** Phase 39: the browser / app bar colour follows the light or dark look; content may use the full screen on phones with a notch. */
export const viewport: Viewport = {
  themeColor: [{ media: "(prefers-color-scheme: light)", color: "#ffffff" }, { media: "(prefers-color-scheme: dark)", color: "#0b1315" }],
  viewportFit: "cover",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale();
  const theme = (await cookies()).get("theme")?.value;
  const bgCookie = (await cookies()).get("bg")?.value;
  const bg = isBackground(bgCookie) ? bgCookie : DEFAULT_BG;
  return (
    <html lang={locale} className={`${inter.variable}${theme === "dark" ? " dark" : ""}`} data-bg={bg} suppressHydrationWarning>
      <head>
        <ThemeScript />
        {/* Error reporting config for the browser (no secrets: a Sentry DSN is public by design). */}
        <script dangerouslySetInnerHTML={{ __html: `window.__FIRINGI__=${JSON.stringify({ sentryDsn: process.env.SENTRY_DSN ?? null, release: process.env.GIT_COMMIT ?? null, env: process.env.FIRINGI_ENV ?? "development" }).replace(/</g, "\\u003c")};` }} />
      </head>
      <body className="font-sans">
        <BgLayer />
        <NextIntlClientProvider>{children}</NextIntlClientProvider>
      </body>
    </html>
  );
}
