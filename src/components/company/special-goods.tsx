"use client";
/** Phase 47e — the business says which special goods it sells, and sees what it may buy (and why not). */
import { useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Msg, useRun } from "@/components/shared/run";
import { setOwnSpecialGoodsAction } from "@/server/actions/onboarding";

export type SpecialRow = { target: string; open: boolean; warn: boolean; reason: string; label: string; category: string | null };

export function SpecialGoods({ sells, declared, rows, codes, canEdit }: { sells: string[]; declared: boolean; rows: SpecialRow[]; codes: string[]; canEdit: boolean }) {
  const t = useTranslations("specialAccess");
  const { pending, error, done, run } = useRun();
  const [x, setX] = useState<string[]>(sells);
  const name = (r: SpecialRow) => (r.target.startsWith("cat:") ? r.category ?? r.label : t(`kind${r.target}` as "kindTOBACCO"));
  return (
    <div className="space-y-3" data-testid="special-goods">
      <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); run(() => setOwnSpecialGoodsAction({ kinds: x as ("TOBACCO" | "ALCOHOL" | "VAPING")[] }), undefined, t("saved")); }}>
        <p className="text-sm font-medium">{t("question")}</p>
        <div className="flex flex-wrap gap-x-5 gap-y-1">
          {(["TOBACCO", "ALCOHOL", "VAPING"] as const).map((k) => <label key={k} className="flex items-center gap-2 text-sm"><input type="checkbox" disabled={!canEdit} checked={x.includes(k)} onChange={(e) => setX(e.target.checked ? [...x, k] : x.filter((y) => y !== k))} data-testid={`sg-${k}`} /> {t(`kind${k}`)}</label>)}
        </div>
        {!declared && <p className="text-xs text-amber-700 dark:text-amber-400">{t("notAnswered")}</p>}
        {canEdit && <div className="flex items-center gap-3"><Button type="submit" size="sm" disabled={pending} data-testid="sg-save">{t("save")}</Button><Msg error={error} done={done} /></div>}
      </form>
      <div>
        <p className="mb-1 text-sm font-medium">{t("statusTitle")}</p>
        <p className="mb-2 text-xs text-muted-foreground">{codes.length ? t("yourCodes", { codes: codes.join(", ") }) : t("noCodes")}</p>
        <ul className="divide-y rounded-lg border text-sm" data-testid="special-status">
          {rows.map((r) => (
            <li key={r.target} className="flex flex-wrap items-center justify-between gap-2 p-2" data-testid={`special-row-${r.target}`}>
              <span>{name(r)}</span>
              <span className="flex flex-wrap items-center gap-2 text-right">
                {r.open ? <Badge variant={r.warn ? "warning" : "success"}>{r.warn ? t("openWarn") : t("open")}</Badge> : <Badge variant="destructive">{t("closed")}</Badge>}
                {!r.open && <span className="text-xs text-muted-foreground">{t(`reason${r.reason}` as "reasonCODE")}</span>}
              </span>
            </li>
          ))}
        </ul>
        <p className="mt-2 text-xs text-muted-foreground">{t("licenceNote")}</p>
      </div>
    </div>
  );
}
