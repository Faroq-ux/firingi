"use client";
/** The portal's (permission-filtered, translated) menu, shared with page headers: each page shows its section's icon and name. */
import { createContext, useContext } from "react";
import { usePathname } from "next/navigation";
import { LayoutDashboard } from "lucide-react";
import type { ResolvedSection } from "@/config/nav/resolve";
import { ICONS } from "./sidebar";

export const NavContext = createContext<ResolvedSection[]>([]);

function useSection() {
  const nav = useContext(NavContext);
  const path = usePathname();
  let best: { s: ResolvedSection; len: number } | null = null;
  for (const s of nav)
    for (const i of [...s.items, ...s.groups.flatMap((g) => g.items)]) {
      const href = i.href.split("?")[0];
      // The longest menu entry the current page starts with (detail pages belong to their list's section).
      const parent = href.replace(/\/[^/]+$/, "");
      const len = path === href || path.startsWith(`${href}/`) ? href.length : path.startsWith(`${parent}/`) ? parent.length - 1 : -1;
      if (len > 0 && (!best || len > best.len)) best = { s, len };
    }
  return best?.s ?? null;
}

export function SectionChip() {
  const s = useSection();
  if (!s) return null;
  const Icon = ICONS[s.icon] ?? LayoutDashboard;
  return <span className="tile-chip gloss mt-0.5 hidden size-11 shrink-0 place-items-center rounded-2xl bg-[linear-gradient(135deg,var(--vivid-blue),var(--vivid-violet))] text-white shadow-[0_10px_24px_-10px_var(--vivid-violet)] sm:grid" data-testid="section-chip"><Icon className="size-5" aria-hidden /></span>;
}

export function SectionEyebrow() {
  const s = useSection();
  if (!s) return <span aria-hidden className="mb-2 block h-1 w-12 rounded-full bg-[linear-gradient(90deg,var(--vivid-blue),var(--vivid-violet),var(--vivid-teal))] shadow-[0_0_12px_var(--vivid-violet)]" />;
  return <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-[color:color-mix(in_oklch,var(--vivid-violet)_70%,var(--foreground))]">{s.label}</p>;
}
