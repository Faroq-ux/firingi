"use client";
/** Supplier: what an import would change (filter rows), then apply or discard. */
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { AlertTriangle, CheckCircle2, Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { applyImportAction, cancelImportAction } from "@/server/actions/integrations";

export type RunRow = { line: number; status: "NEW_OFFER" | "UPDATE" | "UNCHANGED" | "NOT_FOUND" | "ERROR"; product: string | null; vendorSku: string | null; gtin: string | null; changes: string[]; errors: string[]; big: boolean };
const TONE: Record<RunRow["status"], "success" | "secondary" | "outline" | "warning" | "destructive"> = { NEW_OFFER: "success", UPDATE: "secondary", UNCHANGED: "outline", NOT_FOUND: "warning", ERROR: "destructive" };
const LIMIT = 300;

export function ImportRunView({ runId, status, rows, bigChanges, result }: { runId: string; status: string; rows: RunRow[]; bigChanges: number; result?: { applied?: number; failed?: number; failures?: { line: number; error: string }[] } }) {
  const t = useTranslations("integrations");
  const router = useRouter();
  const [filter, setFilter] = useState<"changes" | "problems" | "all">(rows.some((r) => r.status === "UPDATE" || r.status === "NEW_OFFER") ? "changes" : "all");
  const [confirmBig, setConfirmBig] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const changes = rows.filter((r) => r.status === "UPDATE" || r.status === "NEW_OFFER").length;
  const shown = useMemo(() => rows.filter((r) => filter === "all" || (filter === "changes" ? r.status === "UPDATE" || r.status === "NEW_OFFER" : r.status === "ERROR" || r.status === "NOT_FOUND")), [rows, filter]);
  const failures = new Map((result?.failures ?? []).map((f) => [f.line, f.error]));
  const open = status === "PREVIEW";

  return (
    <div className="space-y-4" data-testid="import-run">
      {open && bigChanges > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-[color:color-mix(in_oklch,var(--vivid-orange)_50%,var(--border))] bg-[color:color-mix(in_oklch,var(--vivid-orange)_10%,var(--card))] p-3 text-sm" role="alert">
          <AlertTriangle className="size-5 text-[var(--vivid-orange)]" aria-hidden />
          <span className="flex-1">{t("run.bigWarn", { count: bigChanges })}</span>
          <label className="flex items-center gap-2 font-medium"><input type="checkbox" className="size-4" checked={confirmBig} onChange={(e) => setConfirmBig(e.target.checked)} data-testid="confirm-big" />{t("run.confirmBig")}</label>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-lg border bg-muted/50 p-1" role="tablist">
          {(["changes", "problems", "all"] as const).map((f) => (
            <button key={f} role="tab" aria-selected={filter === f} onClick={() => setFilter(f)} className={`rounded-md px-3 py-1 text-sm transition-all ${filter === f ? "bg-card font-semibold shadow-sm" : "text-muted-foreground hover:text-foreground"}`} data-testid={`filter-${f}`}>{t(`run.filter.${f}`)}</button>
          ))}
        </div>
        {open && (
          <div className="ml-auto flex gap-2">
            <Button variant="outline" disabled={pending} data-testid="import-discard" onClick={() => start(async () => { const r = await cancelImportAction({ runId }); if (!r.ok) return setError(r.error); setMsg(t("run.discarded")); router.refresh(); })}>{t("run.discard")}</Button>
            <Button disabled={pending || !changes || (bigChanges > 0 && !confirmBig)} data-testid="import-apply" onClick={() => start(async () => {
              const r = await applyImportAction({ runId, confirmBig });
              if (!r.ok) return setError(r.error);
              setMsg(t("run.applied", { applied: r.data.applied, failed: r.data.failed })); router.refresh();
            })}>{pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Sparkles className="size-4" aria-hidden />}{t("run.apply", { count: changes })}</Button>
          </div>
        )}
      </div>
      {msg && <p className="flex items-center gap-2 rounded-xl border border-[color:color-mix(in_oklch,var(--vivid-teal)_50%,var(--border))] bg-[color:color-mix(in_oklch,var(--vivid-teal)_10%,var(--card))] p-3 text-sm font-medium" role="status" data-testid="import-result"><CheckCircle2 className="size-5 text-[var(--vivid-teal)]" aria-hidden />{msg}</p>}
      {error && <p className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive" role="alert">{error}</p>}
      {open && !changes && <p className="text-sm text-muted-foreground">{t("run.nothing")}</p>}
      <div className="overflow-hidden rounded-xl border bg-card">
        <table className="w-full text-sm" data-testid="run-rows">
          <thead className="bg-muted/60 text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr><th className="px-3 py-2">{t("run.col.line")}</th><th className="px-3 py-2">{t("run.col.product")}</th><th className="px-3 py-2">{t("run.col.changes")}</th><th className="px-3 py-2">{t("run.col.status")}</th></tr>
          </thead>
          <tbody>
            {shown.slice(0, LIMIT).map((r) => (
              <tr key={r.line} className={`border-t ${r.big ? "bg-[color:color-mix(in_oklch,var(--vivid-orange)_8%,transparent)]" : ""}`}>
                <td className="px-3 py-2 tabular-nums text-muted-foreground">{r.line}</td>
                <td className="px-3 py-2"><div className="font-medium">{r.product ?? "—"}</div><div className="font-mono text-xs text-muted-foreground">{[r.vendorSku, r.gtin].filter(Boolean).join(" · ")}</div></td>
                <td className="px-3 py-2">
                  {r.changes.length > 0 && <ul className="flex flex-wrap gap-1">{r.changes.map((c) => <li key={c} className={`rounded-md px-2 py-0.5 text-xs ${r.big && c.startsWith("price") ? "bg-[var(--vivid-orange)] text-white" : "bg-muted"}`}>{c}</li>)}</ul>}
                  {r.errors.map((e) => <p key={e} className="text-xs text-destructive">{e}</p>)}
                  {failures.get(r.line) && <p className="text-xs text-destructive">{failures.get(r.line)}</p>}
                </td>
                <td className="px-3 py-2"><Badge variant={TONE[r.status]}>{t(`run.status.${r.status}`)}</Badge></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {shown.length > LIMIT && <p className="text-xs text-muted-foreground">{t("run.more", { shown: LIMIT, total: shown.length })}</p>}
      {rows.some((r) => r.status === "NOT_FOUND") && <p className="text-xs text-muted-foreground">{t("run.notFoundHint")}</p>}
    </div>
  );
}
