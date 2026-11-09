import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { NextIntlClientProvider } from "next-intl";
import { getLocale } from "next-intl/server";
import { cookies } from "next/headers";
import { ThemeScript } from "@/components/theme/theme-script";
import "./globals.css";

const inter = Inter({ subsets: ["latin", "latin-ext"], variable: "--font-inter" });

export const metadata: Metadata = {
  title: { default: "FIRINGI", template: "%s · FIRINGI" },
  description: "FIRINGI — B2B marketplace and ERP for distributors, wholesalers and businesses",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale();
  const theme = (await cookies()).get("theme")?.value;
  return (
    <html lang={locale} className={`${inter.variable}${theme === "dark" ? " dark" : ""}`} suppressHydrationWarning>
      <head><ThemeScript /></head>
      <body className="font-sans">
        <NextIntlClientProvider>{children}</NextIntlClientProvider>
      </body>
    </html>
  );
}
