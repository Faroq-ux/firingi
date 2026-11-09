import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatDate(d: Date | string | null | undefined, locale = "en", withTime = false) {
  if (!d) return "—";
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    ...(withTime ? { timeStyle: "short" } : {}),
    timeZone: "Europe/Lisbon",
  }).format(new Date(d));
}
