"use client";
/** The wholesaler the buyer chose can't deliver: let FIRINGI find another one, or cancel. */
import Link from "next/link";
import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { buyerDecisionAction } from "@/server/actions/allocation";

export function DecisionPanel({ eventId, shortfall, supplier, deadline }: { eventId: string; shortfall: boolean; supplier: string; deadline: string }) {
  const t = useTranslations("orders.decision");
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ status: string; newOrders: { orderId: string; number: string }[] } | null>(null);
  const run = (choice: "FIRINGI" | "CANCEL") =>
    start(async () => {
      setError(null);
      const r = await buyerDecisionAction({ eventId, choice });
      // Keep the result on screen (a refresh would remove the panel); the links lead on.
      if (r.ok) setDone(r.data); else setError(r.error);
    });
  if (done)
    return (
      <div className="mb-4 rounded-md border bg-card p-4 text-sm" role="status" data-testid="decision-done">
        {done.status === "CANCELLED" ? t("cancelled") : done.newOrders.length ? (
          <>{t("moved")} {done.newOrders.map((o) => <Link key={o.orderId} className="ml-1 font-medium text-primary hover:underline" href={`/buy/orders/${o.orderId}`}>{o.number}</Link>)}</>
        ) : t("none")}
      </div>
    );
  return (
    <div className="mb-4 rounded-md border border-warning/60 bg-warning/10 p-4" data-testid="decision-panel">
      <h2 className="font-semibold">{shortfall ? t("titleShort", { supplier }) : t("title", { supplier })}</h2>
      <p className="mt-1 text-sm">{t("body")}</p>
      <p className="mt-1 text-xs text-muted-foreground">{t("deadline", { date: deadline })}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button disabled={pending} onClick={() => run("FIRINGI")}>{t("letFiringi")}</Button>
        <Button variant="outline" disabled={pending} onClick={() => run("CANCEL")}>{shortfall ? t("cancelItems") : t("cancelOrder")}</Button>
      </div>
      {error && <p className="mt-2 text-sm text-destructive" role="alert">{error}</p>}
    </div>
  );
}
