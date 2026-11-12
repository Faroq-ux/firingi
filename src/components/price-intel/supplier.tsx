"use client";
/** Supplier side (Phase 29): withdraw a price change that hasn't applied yet. */
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { useRun } from "@/components/shared/run";
import { cancelPriceChangeAction } from "@/server/actions/price-intel";

export function CancelPriceChange({ id }: { id: string }) {
  const t = useTranslations("priceIntel");
  const { pending, error, run } = useRun();
  return (
    <span className="inline-flex items-center gap-2">
      <Button size="sm" variant="ghost" className="text-destructive" disabled={pending} data-testid="cancel-change" onClick={() => run(() => cancelPriceChangeAction({ id }))}>{t("cancel")}</Button>
      {error && <span className="text-xs text-destructive">{error}</span>}
    </span>
  );
}
