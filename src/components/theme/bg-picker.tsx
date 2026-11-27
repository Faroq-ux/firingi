"use client";
/**
 * Page background behind the cards (same choices as JOGARU): White / black (default: pure white
 * by day, pure black at night), Plain (soft grey with a moving grid), Red glow and Aurora.
 * The choice is stored in a cookie, so the server paints the right background on the next visit.
 */
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";

import { BACKGROUNDS, BG_COOKIE, DEFAULT_BG, isBackground, type Background } from "./bg";

const LABEL_KEY: Record<Background, "bgPure" | "bgPlain" | "bgGlow" | "bgAurora"> = { pure: "bgPure", plain: "bgPlain", glow: "bgGlow", aurora: "bgAurora" };

export function BgPicker({ className }: { className?: string }) {
  const t = useTranslations("common");
  const [bg, setBg] = useState<Background>(DEFAULT_BG);
  useEffect(() => {
    const cur = document.documentElement.dataset.bg;
    setBg(isBackground(cur) ? cur : DEFAULT_BG);
  }, []);
  const pick = (k: Background) => {
    document.documentElement.dataset.bg = k;
    document.cookie = `${BG_COOKIE}=${k}; path=/; max-age=31536000; samesite=lax`;
    setBg(k);
  };
  return (
    <div className={`bgpick${className ? ` ${className}` : ""}`} role="group" aria-label={t("background")} data-testid="bg-picker">
      <span className="bglab">{t("background")}</span>
      {BACKGROUNDS.map((k) => (
        <button key={k} type="button" aria-pressed={bg === k} title={t(LABEL_KEY[k])} aria-label={t(LABEL_KEY[k])} onClick={() => pick(k)} data-bg={k}>
          <i className={`bgsw bgsw-${k}`} aria-hidden /><span>{t(LABEL_KEY[k])}</span>
        </button>
      ))}
    </div>
  );
}
