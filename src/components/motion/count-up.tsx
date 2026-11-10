"use client";
/**
 * A number that counts up to its value (and animates from the old value when it changes,
 * with a short highlight). Server HTML already shows the final value, so there is no
 * hydration mismatch; people who prefer reduced motion just see the value.
 */
import { useEffect, useRef } from "react";
import { fmtValue, type Fmt } from "@/lib/analytics-format";

export function CountUp({ value, fmt = "number", locale = "en", duration = 1300, className }: { value: number; fmt?: Fmt | "int"; locale?: string; duration?: number; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const shown = useRef<number | null>(null);
  const format = (v: number) => (fmt === "int" ? new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(Math.round(v)) : fmtValue(v, fmt, locale));
  useEffect(() => {
    const el = ref.current;
    if (!el || !Number.isFinite(value)) return;
    const from = shown.current ?? 0;
    const changed = shown.current !== null && shown.current !== value;
    shown.current = value;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches || from === value) { el.textContent = format(value); return; }
    if (changed) { el.classList.remove("motion-flash"); void el.offsetWidth; el.classList.add("motion-flash"); }
    const start = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 4); // ease-out quart
      el.textContent = format(from + (value - from) * eased);
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, fmt, locale, duration]);
  return <span ref={ref} className={`rounded tabular-nums ${className ?? ""}`} suppressHydrationWarning>{Number.isFinite(value) ? format(value) : "—"}</span>;
}
