/** Page title band: gradient title, optional eyebrow / icon, actions on the right (glass, aurora edge). */
import type { LucideIcon } from "lucide-react";
import { SectionChip, SectionEyebrow } from "./nav-context";

export function PageHeader({ title, description, actions, eyebrow, icon: Icon }: { title: string; description?: React.ReactNode; actions?: React.ReactNode; eyebrow?: string; icon?: LucideIcon }) {
  return (
    <div className="motion-rise mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="flex min-w-0 items-start gap-3">
        {Icon ? <span className="tile-chip gloss mt-0.5 grid size-11 shrink-0 place-items-center rounded-2xl bg-[linear-gradient(135deg,var(--vivid-blue),var(--vivid-violet))] text-white shadow-[0_10px_24px_-10px_var(--vivid-violet)]"><Icon className="size-5" aria-hidden /></span> : <SectionChip />}
        <div className="min-w-0">
          {eyebrow ? <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-[color:color-mix(in_oklch,var(--vivid-violet)_70%,var(--foreground))]">{eyebrow}</p> : <SectionEyebrow />}
          <h1 className="text-gradient text-2xl font-bold tracking-tight sm:text-[1.75rem]">{title}</h1>
          {description && <div className="mt-1 max-w-3xl text-sm text-muted-foreground">{description}</div>}
        </div>
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}
