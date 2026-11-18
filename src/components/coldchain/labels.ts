/** Texts for the cold-chain pages (Phase 42): the "coldChain" messages in the viewer's language (English as fallback). */
import { getLocale, getMessages } from "next-intl/server";
import en from "@/messages/en.json";

const flat = (o: Record<string, unknown>, p = ""): Record<string, string> =>
  Object.fromEntries(Object.entries(o).flatMap(([k, v]) => (typeof v === "string" ? [[p + k, v]] : Object.entries(flat(v as Record<string, unknown>, `${p}${k}.`)))));
export const fill = (s: string | undefined, v: Record<string, string | number> = {}) => (s ?? "").replace(/\{(\w+)\}/g, (_, k: string) => String(v[k] ?? `{${k}}`));

export async function ccLabels() {
  const [m, locale] = await Promise.all([getMessages(), getLocale()]);
  const base = (en as unknown as { coldChain: Record<string, unknown> }).coldChain;
  return { l: { ...flat(base), ...flat(((m as { coldChain?: object }).coldChain ?? {}) as Record<string, unknown>) }, locale };
}

/** English texts (FIRINGI admin pages). */
export const enLabels = () => flat((en as unknown as { coldChain: Record<string, unknown> }).coldChain);
