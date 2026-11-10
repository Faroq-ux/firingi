/** From / to filter for the fleet reports (plain GET form, works without JavaScript). */
export function PeriodForm({ from, to, labels = { from: "From", to: "To", apply: "Apply" }, extra }: { from: string; to: string; labels?: { from: string; to: string; apply: string }; extra?: Record<string, string> }) {
  return (
    <form className="mb-4 flex flex-wrap items-end gap-2 text-sm" method="get">
      {Object.entries(extra ?? {}).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      <label className="space-y-1"><span className="block text-xs text-muted-foreground">{labels.from}</span><input type="date" name="from" defaultValue={from} className="h-9 rounded-md border bg-card px-2" /></label>
      <label className="space-y-1"><span className="block text-xs text-muted-foreground">{labels.to}</span><input type="date" name="to" defaultValue={to} className="h-9 rounded-md border bg-card px-2" /></label>
      <button type="submit" className="h-9 rounded-md border px-3">{labels.apply}</button>
    </form>
  );
}
