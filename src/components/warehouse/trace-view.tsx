/**
 * Lot trace and recall views (Phase 25) — server components shared by the supplier pages (in the
 * user's language) and FIRINGI's pages (English): the caller passes the translator.
 */
import { ArrowDown, Factory, MapPin, PackageCheck, ShieldAlert, Siren, Truck, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

type T = (key: string, values?: Record<string, string | number>) => string;
type Trace = Awaited<ReturnType<typeof import("@/server/warehouse/recalls").traceLot>>;
type Recall = Awaited<ReturnType<typeof import("@/server/warehouse/recalls").getRecall>>;

const fmt = (locale: string) => new Intl.DateTimeFormat(locale, { day: "2-digit", month: "short", year: "numeric" });

export function TraceView({ data, t, locale, orderHref }: { data: Trace; t: T; locale: string; orderHref?: (id: string, mine: boolean) => string | null }) {
  const date = fmt(locale);
  return (
    <div className="space-y-4" data-testid="trace-view">
      <Card>
        <CardContent className="flex flex-wrap items-center gap-x-6 gap-y-2 pt-6 text-sm">
          <div><p className="text-xs uppercase tracking-wider text-muted-foreground">{t("product")}</p><p className="font-semibold">{data.product.name} <span className="font-normal text-muted-foreground">· {data.product.packaging}{data.product.sku ? ` · ${data.product.sku}` : ""}</span></p></div>
          <div><p className="text-xs uppercase tracking-wider text-muted-foreground">{t("lot")}</p><p className="font-mono text-lg font-bold">{data.lotCode ?? "—"}</p></div>
          {data.expiresOn && <div><p className="text-xs uppercase tracking-wider text-muted-foreground">{t("bestBefore")}</p><p className="font-semibold">{date.format(data.expiresOn)}</p></div>}
          {data.recalls.map((r) => <Badge key={r.id} variant="destructive" className="gap-1"><Siren className="size-3.5" />{r.number} · {t(`class.${r.recallClass}`)}</Badge>)}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2 text-base"><Factory className="size-4" />{t("cameFrom")}</CardTitle></CardHeader>
        <CardContent>
          {data.upstream.length === 0 ? <p className="text-sm text-muted-foreground">{t("noUpstream")}</p> : (
            <ul className="space-y-2 text-sm" data-testid="trace-upstream">
              {data.upstream.map((u, i) => (
                <li key={i} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 rounded-lg border px-3 py-2">
                  <Badge variant="outline">{t(`origin.${u.kind}`)}</Badge>
                  {u.supplier && <span className="font-medium">{u.supplier}</span>}
                  {u.reference && <span className="font-mono text-xs">{u.reference}</span>}
                  {u.supplierLot && <span className="text-muted-foreground">{t("lot")} <span className="font-mono">{u.supplierLot}</span></span>}
                  <span className="ml-auto text-xs text-muted-foreground">{date.format(u.date)}</span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {data.levels.map((l, idx) => (
        <div key={l.level} className="space-y-4">
          {idx > 0 && <div className="flex justify-center text-muted-foreground"><ArrowDown className="size-5" /></div>}
          <Card data-testid={`trace-level-${l.level}`}>
            <CardHeader>
              <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                {l.level === 0 ? <PackageCheck className="size-4" /> : <Users className="size-4" />}
                {l.level === 0 ? t("levelOwn") : t("levelN", { n: l.level })}
                <span className="ml-auto flex flex-wrap gap-2 text-xs font-normal">
                  <Badge variant="secondary">{t("inStockN", { count: l.stockUnits })}</Badge>
                  <Badge variant="secondary">{t("shippedN", { count: l.shippedUnits })}</Badge>
                  <Badge variant="secondary">{t("buyersN", { count: l.buyers })}</Badge>
                  {l.openOrders > 0 && <Badge variant="outline">{t("openOrdersN", { count: l.openOrders })}</Badge>}
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {!l.visible ? <p className="flex items-center gap-2 text-sm text-muted-foreground"><ShieldAlert className="size-4" />{t("hiddenLevel", { count: l.buyers })}</p> : (
                <>
                  {l.stock.length > 0 && (
                    <div>
                      <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{t("stockNow")}</p>
                      <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                        {l.stock.map((s) => (
                          <li key={s.id} className={cn("rounded-lg border px-3 py-2 text-sm", s.blocked && "border-destructive/50 bg-destructive/5")}>
                            <p className="font-medium">{s.company}</p>
                            <p className="text-xs text-muted-foreground"><MapPin className="mr-1 inline size-3" />{s.warehouse}{s.bin ? ` · ${s.bin}` : ""}</p>
                            <p className="mt-1">{s.blocked ? <Badge variant="destructive">{t("blocked")}</Badge> : <>{t("unitsN", { count: s.onHand })}{s.reserved ? <span className="text-muted-foreground"> · {t("reservedN", { count: s.reserved })}</span> : null}</>}</p>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  <div>
                    <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{t("shippedTo")}</p>
                    {l.shipments.length === 0 ? <p className="text-sm text-muted-foreground">{t("notShipped")}</p> : (
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead><tr className="text-left text-xs text-muted-foreground"><th className="py-1 pr-3 font-medium">{t("order")}</th><th className="py-1 pr-3 font-medium">{t("buyer")}</th><th className="py-1 pr-3 font-medium">{t("shipped")}</th><th className="py-1 pr-3 text-right font-medium">{t("units")}</th><th className="py-1 font-medium">{t("statusLabel")}</th></tr></thead>
                          <tbody>
                            {l.shipments.map((s) => {
                              const href = orderHref?.(s.orderId, s.mine) ?? null;
                              return (
                                <tr key={s.orderId} className="border-t">
                                  <td className="py-1.5 pr-3 font-mono text-xs">{href ? <a href={href} className="hover:underline">{s.number}</a> : s.number}</td>
                                  <td className="py-1.5 pr-3">{s.buyer}</td>
                                  <td className="whitespace-nowrap py-1.5 pr-3 text-muted-foreground"><Truck className="mr-1 inline size-3" />{date.format(s.at)}</td>
                                  <td className="py-1.5 pr-3 text-right tabular-nums">{s.qty}</td>
                                  <td className="py-1.5"><Badge variant="outline">{s.status}</Badge></td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </div>
      ))}
    </div>
  );
}

const STATUS_TONE: Record<string, "default" | "secondary" | "outline" | "destructive"> = { NOTIFIED: "destructive", ACKNOWLEDGED: "secondary", DONE: "default" };

export function RecallView({ r, t, locale }: { r: Recall; t: T; locale: string }) {
  const date = fmt(locale);
  const p = r.progress;
  const pct = p.total ? Math.round((p.done / p.total) * 100) : 100;
  return (
    <div className="space-y-4" data-testid="recall-view">
      <Card className={cn(r.status === "OPEN" && "border-destructive/40")}>
        <CardContent className="grid gap-4 pt-6 text-sm md:grid-cols-[2fr_1fr]">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={r.status === "OPEN" ? "destructive" : "outline"} className="gap-1"><Siren className="size-3.5" />{t(`recallStatus.${r.status}`)}</Badge>
              <Badge variant="outline">{t(`class.${r.recallClass}`)}</Badge>
              {r.startedByFiringi && <Badge variant="secondary">{t("startedByFiringi")}</Badge>}
            </div>
            <p className="text-lg font-semibold">{r.product} <span className="font-normal text-muted-foreground">· {r.packaging}{r.sku ? ` · ${r.sku}` : ""}</span></p>
            <p>{t("lot")}: <span className="font-mono font-semibold">{r.lotCode ?? "—"}</span>{r.expiresOn ? ` · ${t("bestBefore")}: ${date.format(r.expiresOn)}` : ""}</p>
            <p><span className="text-muted-foreground">{t("reason")}:</span> {r.reason}</p>
            {r.instructions && <p><span className="text-muted-foreground">{t("instructions")}:</span> {r.instructions}</p>}
            <p className="text-xs text-muted-foreground">{r.supplier} · {date.format(r.createdAt)}{r.closedAt ? ` → ${date.format(r.closedAt)}` : ""}{r.closeNote ? ` · ${r.closeNote}` : ""}</p>
          </div>
          <div className="grid grid-cols-2 gap-2 self-start">
            <Stat label={t("blockedUnits")} value={r.blockedUnits} />
            <Stat label={t("reReserved")} value={r.reReserved} />
            <Stat label={t("notCovered")} value={r.notReReserved} warn={r.notReReserved > 0} />
            <Stat label={t("recipients")} value={p.total} />
            <div className="col-span-2">
              <div className="mb-1 flex justify-between text-xs text-muted-foreground"><span>{t("doneOf", { done: p.done, total: p.total })}</span><span>{pct}%</span></div>
              <div className="h-2 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-emerald-500" style={{ width: `${pct}%` }} /></div>
              <p className="mt-1 text-xs text-muted-foreground">{t("returnedDestroyed", { returned: p.returned, destroyed: p.destroyed, units: p.units })}</p>
            </div>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle className="text-base">{t("whoWasTold")}</CardTitle></CardHeader>
        <CardContent>
          {r.recipients.length === 0 ? <p className="text-sm text-muted-foreground">{t("noRecipients")}</p> : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm" data-testid="recall-recipients">
                <thead><tr className="text-left text-xs text-muted-foreground"><th className="py-1 pr-3 font-medium">{t("buyer")}</th><th className="py-1 pr-3 font-medium">{t("levelShort")}</th><th className="py-1 pr-3 text-right font-medium">{t("units")}</th><th className="py-1 pr-3 font-medium">{t("orders")}</th><th className="py-1 pr-3 font-medium">{t("statusLabel")}</th><th className="py-1 font-medium">{t("returnedShort")}</th></tr></thead>
                <tbody>
                  {r.recipients.map((x) => (
                    <tr key={x.id} className="border-t align-top">
                      <td className="py-1.5 pr-3">{x.company}</td>
                      <td className="py-1.5 pr-3">{x.level}</td>
                      <td className="py-1.5 pr-3 text-right tabular-nums">{x.qty}</td>
                      <td className="py-1.5 pr-3 font-mono text-xs">{x.orders.map((o) => o.number).join(", ")}</td>
                      <td className="py-1.5 pr-3"><Badge variant={STATUS_TONE[x.status]}>{t(`notice.${x.status}`)}</Badge></td>
                      <td className="py-1.5 text-xs">{x.status === "DONE" ? (x.noneLeft && !x.returnedQty && !x.destroyedQty ? t("noneLeft") : `${x.returnedQty} / ${x.destroyedQty}`) : "—"}{x.note ? <span className="block text-muted-foreground">{x.note}</span> : null}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {r.hiddenRecipients > 0 && <p className="mt-3 flex items-center gap-2 text-sm text-muted-foreground"><ShieldAlert className="size-4" />{t("hiddenRecipients", { count: r.hiddenRecipients })}</p>}
        </CardContent>
      </Card>
    </div>
  );
}

function Stat({ label, value, warn }: { label: string; value: number; warn?: boolean }) {
  return <div className={cn("rounded-lg border px-3 py-2", warn && "border-amber-500/50 bg-amber-500/10")}><p className="text-xs text-muted-foreground">{label}</p><p className="text-xl font-bold tabular-nums">{value}</p></div>;
}
