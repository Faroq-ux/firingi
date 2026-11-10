export function PageHeader({ title, description, actions }: { title: string; description?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="motion-rise">
        <span aria-hidden className="mb-2 block h-1 w-12 rounded-full bg-[linear-gradient(90deg,var(--vivid-blue),var(--vivid-violet),var(--vivid-pink))]" />
        <h1 className="text-gradient text-2xl font-bold tracking-tight">{title}</h1>
        {description && <div className="mt-1 text-sm text-muted-foreground">{description}</div>}
      </div>
      {actions && <div className="flex gap-2">{actions}</div>}
    </div>
  );
}
