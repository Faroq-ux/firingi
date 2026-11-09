import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { UI_LOCALES, toUiLocale } from "@/i18n/config";
import { localeFromAcceptLanguage } from "@/i18n/request";

type Tree = { [k: string]: string | Tree };
const load = (l: string): Tree => JSON.parse(readFileSync(path.join(process.cwd(), "src/messages", `${l}.json`), "utf8"));
const flat = (t: Tree, p = ""): Record<string, string> =>
  Object.entries(t).reduce<Record<string, string>>((o, [k, v]) => Object.assign(o, typeof v === "string" ? { [p + k]: v } : flat(v, `${p}${k}.`)), {});
const vars = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join(",");
const en = flat(load("en"));

describe("UI translations", () => {
  for (const locale of UI_LOCALES.filter((l) => l !== "en")) {
    it(`${locale}: same keys and placeholders as English`, () => {
      expect(existsSync(path.join(process.cwd(), "src/messages", `${locale}.json`))).toBe(true);
      const m = flat(load(locale));
      const missing = Object.keys(en).filter((k) => !(k in m));
      const extra = Object.keys(m).filter((k) => !(k in en) && !k.startsWith("navLabels."));
      const badVars = Object.keys(en).filter((k) => k in m && vars(en[k]) !== vars(m[k]));
      expect({ missing, extra, badVars }).toEqual({ missing: [], extra: [], badVars: [] });
    });
  }
});

describe("browser language before sign-in", () => {
  it("maps browser languages to UI locales", () => {
    expect(toUiLocale("pt-BR")).toBe("pt-PT");
    expect(toUiLocale("de-AT")).toBe("de");
    expect(toUiLocale("nn")).toBe("nb");
    expect(localeFromAcceptLanguage("fr-FR,fr;q=0.9,en;q=0.8")).toBe("fr");
    expect(localeFromAcceptLanguage("ja,en;q=0.5")).toBe("en");
    expect(localeFromAcceptLanguage("ja")).toBe("en");
    expect(localeFromAcceptLanguage(null)).toBe("en");
  });
});
