/**
 * The FIRINGI wordmark: "fırıngı" in Bebas Neue (shown as FIRINGI), each dotless ı topped with a yellow dot, a thin
 * yellow line joining the dots across the top. Always the same colours — red letters, yellow dots and line — on every
 * background (never on a red one). Size it with font-size.
 */
import { Bebas_Neue } from "next/font/google";

const bebas = Bebas_Neue({ weight: "400", subsets: ["latin", "latin-ext"], display: "swap" });

export const BRAND_RED = "#E10600";
export const BRAND_YELLOW = "#FFC800";

type Letter = { c: string; dot?: boolean; line?: "right" | "full" | "left" };
const LETTERS: Letter[] = [
  { c: "f" }, { c: "ı", dot: true, line: "right" }, { c: "r", line: "full" }, { c: "ı", dot: true, line: "full" },
  { c: "n", line: "full" }, { c: "g", line: "full" }, { c: "ı", dot: true, line: "left" },
];
const LINE = { right: { left: "50%", right: 0 }, full: { left: 0, right: 0 }, left: { left: 0, right: "50%" } } as const;

export function Wordmark({ className = "", label = "FIRINGI" }: { className?: string; label?: string }) {
  return (
    <span role="img" aria-label={label} data-testid="wordmark" className={`${bebas.className} ${className}`}
      style={{ display: "inline-flex", alignItems: "baseline", fontWeight: 700, lineHeight: 1, letterSpacing: 0, color: BRAND_RED, verticalAlign: "middle" }}>
      {LETTERS.map((l, i) => (
        <span key={i} aria-hidden="true" style={{ display: "block", position: "relative" }}>
          {l.c}
          {l.line && <span style={{ position: "absolute", top: "0.1375em", height: "0.035em", background: BRAND_YELLOW, ...LINE[l.line] }} />}
          {l.dot && <span style={{ position: "absolute", top: "0.07em", left: "50%", marginLeft: "-0.085em", width: "0.17em", height: "0.17em", borderRadius: "50%", background: BRAND_YELLOW }} />}
        </span>
      ))}
    </span>
  );
}
