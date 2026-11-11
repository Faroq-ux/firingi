/** FIRINGI's pages are in English: the warehouse texts they share with the supplier pages come from en.json. */
import { NextIntlClientProvider, createTranslator } from "next-intl";
import en from "@/messages/en.json";

const messages = { warehouse: (en as Record<string, unknown>).warehouse } as never;

/** Client widgets (forms, buttons) inside get the English texts. */
export function English({ children }: { children: React.ReactNode }) {
  return <NextIntlClientProvider locale="en" messages={messages}>{children}</NextIntlClientProvider>;
}

/** Server-side English translator for the shared views. */
export const englishT = createTranslator({ locale: "en", messages, namespace: "warehouse" as never }) as unknown as (key: string, values?: Record<string, string | number>) => string;
