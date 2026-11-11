"use client";
/**
 * Light / dark / system theme. The choice is stored in a cookie (so the server renders
 * the right class) and applied instantly without reloading.
 */
import { useEffect, useState } from "react";
import { Monitor, Moon, Sun } from "lucide-react";

export type ThemeChoice = "light" | "dark" | "system";
export const THEME_COOKIE = "theme";

function apply(choice: ThemeChoice) {
  const dark = choice === "dark" || (choice === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
}

export function ThemeToggle({ initial, labels, labelClassName }: { initial: ThemeChoice; labels: Record<ThemeChoice, string>; labelClassName?: string }) {
  const [choice, setChoice] = useState<ThemeChoice>(initial);
  useEffect(() => {
    apply(choice);
    if (choice !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const on = () => apply("system");
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [choice]);
  const next: Record<ThemeChoice, ThemeChoice> = { system: "light", light: "dark", dark: "system" };
  const Icon = choice === "dark" ? Moon : choice === "light" ? Sun : Monitor;
  return (
    <button
      type="button"
      title={labels[choice]}
      aria-label={labels[choice]}
      className="flex items-center gap-2 rounded-md p-2 text-sm transition-colors hover:bg-accent"
      onClick={() => {
        const c = next[choice];
        document.cookie = `${THEME_COOKIE}=${c}; path=/; max-age=31536000; samesite=lax`;
        setChoice(c);
      }}
    >
      <Icon key={choice} className="size-5 animate-pop" />
      {labelClassName && <span className={labelClassName} aria-hidden>{labels[choice]}</span>}
    </button>
  );
}
