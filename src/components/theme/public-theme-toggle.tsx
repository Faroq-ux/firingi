import { cookies } from "next/headers";
import { getTranslations } from "next-intl/server";
import { ThemeToggle, type ThemeChoice } from "./theme";

/** Theme toggle for pages outside the portals (login, registration, application). */
export async function PublicThemeToggle({ className = "" }: { className?: string }) {
  const [c, t] = await Promise.all([cookies(), getTranslations("common")]);
  const v = c.get("theme")?.value;
  const initial = (v === "light" || v === "dark" ? v : "system") as ThemeChoice;
  return <div className={className}><ThemeToggle initial={initial} labels={{ light: t("themeLight"), dark: t("themeDark"), system: t("themeSystem") }} /></div>;
}
