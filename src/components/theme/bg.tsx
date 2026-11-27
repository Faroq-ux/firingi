/**
 * Page background choices (shared by the server layout and the top-bar picker).
 * Same set as JOGARU: White / black (default), Plain, Red glow, Aurora.
 */
export const BACKGROUNDS = ["pure", "plain", "glow", "aurora"] as const;
export type Background = (typeof BACKGROUNDS)[number];
export const DEFAULT_BG: Background = "pure";
export const BG_COOKIE = "bg";

export function isBackground(v: string | undefined | null): v is Background {
  return !!v && (BACKGROUNDS as readonly string[]).includes(v);
}

/** Moving lights and grid floor used by the Red glow and Aurora backgrounds (hidden for the others). */
export function BgLayer() {
  return (
    <div className="bglayer" aria-hidden="true">
      <i className="l1" /><i className="l2" /><i className="l3" /><div className="floor" /><div className="scan" />
    </div>
  );
}
