/** Integrations hero: aurora band, live dot and glass counters (server-rendered, motion-safe). */
import type { ReactNode } from "react";
import { Aurora, LiveDot } from "@/components/motion/shapes";
import { HeroStat } from "@/components/motion/dashboard-kit";

export function IntegrationsHero({ title, subtitle, live, stats, locale, children }: {
  title: string; subtitle: string; live?: string; stats: { label: string; value: number; href?: string }[]; locale: string; children?: ReactNode;
}) {
  return (
    <Aurora className="mb-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-2xl">
          {live && <p className="mb-2 inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-xs font-semibold uppercase tracking-widest text-white/85"><LiveDot />{live}</p>}
          <h1 className="text-2xl font-bold tracking-tight text-white sm:text-3xl">{title}</h1>
          <p className="mt-1 text-sm text-white/80 sm:text-base">{subtitle}</p>
        </div>
        {children}
      </div>
      {stats.length > 0 && (
        <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {stats.map((s, i) => <HeroStat key={s.label} label={s.label} value={s.value} locale={locale} href={s.href} i={i} />)}
        </div>
      )}
    </Aurora>
  );
}

/** A numbered step chip row (Upload → Match → Check → Apply). */
export function Steps({ steps, current }: { steps: string[]; current: number }) {
  return (
    <ol className="mb-5 flex flex-wrap items-center gap-2 text-sm" aria-label="Steps">
      {steps.map((s, i) => (
        <li key={s} className="flex items-center gap-2" aria-current={i === current ? "step" : undefined}>
          <span className={`grid size-7 place-items-center rounded-full text-xs font-bold transition-all ${i < current ? "bg-[var(--vivid-teal)] text-white" : i === current ? "gloss bg-primary text-primary-foreground shadow-[0_0_0_4px_color-mix(in_oklch,var(--primary)_22%,transparent)]" : "bg-muted text-muted-foreground"}`}>{i < current ? "✓" : i + 1}</span>
          <span className={i === current ? "font-semibold" : "text-muted-foreground"}>{s}</span>
          {i < steps.length - 1 && <span className="mx-1 h-px w-6 bg-border sm:w-10" aria-hidden />}
        </li>
      ))}
    </ol>
  );
}
