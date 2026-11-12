/**
 * Verified badges (Phase 28): what customers see for a supplier's approved, in-date certificates
 * whose badge FIRINGI switched on. Built-in certificate names are translated; custom ones show the
 * name FIRINGI gave them.
 */
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { BadgeCheck, Download } from "lucide-react";
import { isBuiltinCert } from "@/lib/compliance";

type B = { key: string; name: string; certificateId?: string | null };

export async function certLabel() {
  const t = await getTranslations("compliance");
  return (key: string, name: string) => (isBuiltinCert(key) ? t(`types.${key}` as "types.HACCP") : name);
}

/** Compact chips (cards). */
export async function VerifiedBadges({ badges, max = 3, className = "" }: { badges: B[]; max?: number; className?: string }) {
  if (!badges.length) return null;
  const [label, t] = await Promise.all([certLabel(), getTranslations("compliance")]);
  const shown = badges.slice(0, max);
  return (
    <span className={`flex flex-wrap items-center gap-1 ${className}`} data-testid="verified-badges" aria-label={t("verifiedBy")}>
      {shown.map((b) => (
        <span key={b.key} title={t("verifiedBadgeTitle", { name: label(b.key, b.name) })} className="inline-flex items-center gap-1 rounded-full border border-[color:color-mix(in_oklch,var(--vivid-teal)_45%,transparent)] bg-[color:color-mix(in_oklch,var(--vivid-teal)_12%,transparent)] px-2 py-0.5 text-[11px] font-semibold text-[color:color-mix(in_oklch,var(--vivid-teal)_70%,var(--foreground))]">
          <BadgeCheck className="size-3" aria-hidden />{label(b.key, b.name)}
        </span>
      ))}
      {badges.length > max && <span className="text-[11px] text-muted-foreground">+{badges.length - max}</span>}
    </span>
  );
}

/** Larger list with download links where the certificate type allows it (supplier store / product page). */
export async function VerifiedPanel({ badges }: { badges: B[] }) {
  if (!badges.length) return null;
  const [label, t] = await Promise.all([certLabel(), getTranslations("compliance")]);
  return (
    <div className="glass-panel rounded-2xl border p-4" data-testid="verified-panel">
      <p className="mb-2 flex items-center gap-2 text-sm font-semibold"><BadgeCheck className="size-4 text-[var(--vivid-teal)]" aria-hidden />{t("verifiedBy")}</p>
      <ul className="flex flex-wrap gap-2">
        {badges.map((b) => (
          <li key={b.key} className="inline-flex items-center gap-2 rounded-xl border bg-card px-3 py-1.5 text-sm">
            <BadgeCheck className="size-4 text-[var(--vivid-teal)]" aria-hidden />
            <span className="font-medium">{label(b.key, b.name)}</span>
            {b.certificateId && <a href={`/api/compliance/certificates/${b.certificateId}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-primary hover:underline"><Download className="size-3" />{t("download")}</a>}
          </li>
        ))}
      </ul>
      <p className="mt-2 text-xs text-muted-foreground">{t("verifiedHint")}</p>
    </div>
  );
}

/** Filter chips: only suppliers holding a badge. */
export async function BadgeFilter({ types, active, base, params = {} }: { types: { key: string; name: string }[]; active?: string | null; base: string; params?: Record<string, string | undefined> }) {
  if (!types.length) return null;
  const [label, t] = await Promise.all([certLabel(), getTranslations("compliance")]);
  const href = (badge?: string) => {
    const q = new URLSearchParams(Object.entries({ ...params, badge }).filter(([, v]) => v) as [string, string][]);
    const s = q.toString();
    return s ? `${base}?${s}` : base;
  };
  const chip = "inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs font-medium transition-colors";
  return (
    <nav className="mb-5 flex flex-wrap items-center gap-2" aria-label={t("filterLabel")} data-testid="badge-filter">
      <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t("filterLabel")}</span>
      <Link href={href()} className={`${chip} ${!active ? "border-primary bg-primary text-primary-foreground" : "bg-card hover:border-primary"}`}>{t("filterAll")}</Link>
      {types.map((ty) => (
        <Link key={ty.key} href={href(ty.key)} aria-current={active === ty.key ? "true" : undefined} className={`${chip} ${active === ty.key ? "border-[var(--vivid-teal)] bg-[var(--vivid-teal)] text-white" : "bg-card hover:border-[var(--vivid-teal)]"}`}>
          <BadgeCheck className="size-3" aria-hidden />{label(ty.key, ty.name)}
        </Link>
      ))}
    </nav>
  );
}
