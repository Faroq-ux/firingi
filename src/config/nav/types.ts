import type { PermissionCode } from "@/server/rbac/permissions";

/** Localized label; missing languages fall back to English. */
export type L = { en: string; pt?: string; es?: string };

export type Phase = "P1" | "P2" | "P3" | "P4" | "P5" | "P6" | "P7" | "LATER";

export const PHASE_LABEL: Record<Phase, L> = {
  P1: { en: "Phase 1 — Foundation", pt: "Fase 1 — Fundação" },
  P2: { en: "Phase 2 — Onboarding", pt: "Fase 2 — Integração" },
  P3: { en: "Phase 3 — Catalogue", pt: "Fase 3 — Catálogo" },
  P4: { en: "Phase 4 — Orders", pt: "Fase 4 — Encomendas" },
  P5: { en: "Phase 5 — Commercial & Finance", pt: "Fase 5 — Comercial e Finanças" },
  P6: { en: "Phase 6 — Delivery & Fleet", pt: "Fase 6 — Entregas e Frota" },
  P7: { en: "Phase 7 — Notifications & WhatsApp", pt: "Fase 7 — Notificações e WhatsApp" },
  LATER: { en: "Later phases", pt: "Fases posteriores" },
};

export type NavItem = {
  key: string;
  label: L;
  href: string;
  /** Visible when the user holds ANY of these permissions. */
  permission: PermissionCode[];
  /** "live" pages are implemented; others render the Coming-soon placeholder. */
  phase: Phase;
  live: boolean;
};

export type NavGroup = { key: string; label: L; items: NavItem[] };

export type NavSection = {
  key: string;
  label: L;
  icon: string; // lucide icon name, mapped in the client sidebar
  items?: NavItem[];
  groups?: NavGroup[];
};

/** Helper that builds items for a section with a common base path & default permission. */
export function section(base: string, perm: PermissionCode | PermissionCode[]) {
  const defaultPerm = Array.isArray(perm) ? perm : [perm];
  return (
    slug: string,
    en: string,
    pt: string,
    phase: Phase,
    opts: { live?: boolean; perm?: PermissionCode | PermissionCode[]; href?: string; es?: string } = {},
  ): NavItem => ({
    key: `${base}/${slug}`,
    label: { en, pt, ...(opts.es ? { es: opts.es } : {}) },
    href: opts.href ?? `${base}/${slug}`,
    permission: opts.perm ? (Array.isArray(opts.perm) ? opts.perm : [opts.perm]) : defaultPerm,
    phase,
    live: opts.live ?? false,
  });
}
