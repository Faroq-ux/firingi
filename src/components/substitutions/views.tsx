/** Replacements (Phase 60) — order card for the customer, the supplier and FIRINGI (English). */
import { ArrowRight, Repeat } from "lucide-react";
import type { Ctx } from "@/server/context";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { fill, subLabels } from "./labels";

const TONE: Record<string, "success" | "warning" | "secondary" | "outline" | "destructive"> = { PENDING: "warning", ACCEPTED: "success", REJECTED: "secondary", EXPIRED: "outline", CANCELLED: "outline" };
const eur = (n: number, locale: string) => new Intl.NumberFormat(locale, { style: "currency", currency: "EUR" }).format(n);
const pct = (n: number, locale: string) => `${n > 0 ? "+" : ""}${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(n)} %`;

export async function OrderSubstitutionsCard({ ctx, orderId, as }: { ctx: Ctx; orderId: string; as: "BUYER" | "SUPPLIER" | "ADMIN" }) {
  const { forOrder, proposableLines } = await import("@/server/substitutions/service");
  const { DecideButtons, ProposeForm, WithdrawButton } = await import("./client");
  const { l, locale } = await subLabels(as === "ADMIN");
  const v = await forOrder(ctx, orderId).catch(() => null);
  if (!v) return null;
  const lines = as === "BUYER" ? [] : await proposableLines(ctx, orderId).catch(() => []);
  if (!v.items.length && !lines.length) return null;
  const mayDecide = as === "BUYER" && ctx.permissions.has("buyer.orders.place");
  const time = (iso: string) => new Intl.DateTimeFormat(locale, { dateStyle: "short", timeStyle: "short" }).format(new Date(iso));
  return (
    <Card className="mt-6" id="replacements" data-testid="order-substitutions">
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Repeat className="size-5" /> {l.title}</CardTitle>
        <CardDescription>{as === "BUYER" ? l.orderIntroBuyer : l.orderIntroSupplier}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {v.items.length > 0 && (
          <ul className="divide-y">
            {v.items.map((x) => (
              <li key={x.id} className="space-y-2 py-3" data-testid="substitution" data-status={x.status}>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={TONE[x.status]} data-testid="substitution-status">{l[`status.${x.status}`]}</Badge>
                  {x.auto && x.status === "ACCEPTED" && <Badge variant="outline">{as === "BUYER" ? l.autoBadge : l.autoBadgeSupplier}</Badge>}
                  <span className="text-xs text-muted-foreground">{time(x.createdAt)}</span>
                  {x.status === "PENDING" && <span className="text-xs text-muted-foreground">· {fill(l.answerBy, { time: time(x.expiresAt) })}</span>}
                </div>
                <div className="grid gap-2 text-sm sm:grid-cols-[1fr_auto_1fr] sm:items-center">
                  <div className="min-w-0 rounded-md bg-muted/50 p-2">
                    <p className="text-xs text-muted-foreground">{l.missing}</p>
                    <p className="break-words font-medium">{x.original.qty} × {x.original.name}</p>
                    <p className="text-xs tabular-nums text-muted-foreground">{eur(x.original.unitNet, locale)} · {eur(x.original.unitNet * x.original.qty, locale)}</p>
                  </div>
                  <ArrowRight className="mx-auto hidden size-4 text-muted-foreground sm:block" />
                  <div className="min-w-0 rounded-md border p-2">
                    <p className="text-xs text-muted-foreground">{l.instead}</p>
                    <p className="break-words font-medium" data-testid="substitute-name">{x.substitute.qty} × {x.substitute.name} <span className="text-xs font-normal text-muted-foreground">· {x.substitute.packaging}{x.substitute.brand ? ` · ${x.substitute.brand}` : ""}</span></p>
                    <p className="text-xs tabular-nums text-muted-foreground">{eur(x.substitute.unitNet, locale)} · {eur(x.substitute.unitNet * x.substitute.qty, locale)}</p>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className={x.diffPct > 0 ? "delta-neg" : x.diffPct < 0 ? "delta-pos" : "text-muted-foreground"} data-testid="substitution-diff">{l.priceChange}: {pct(x.diffPct, locale)}</span>
                  {x.priceMatch && <Badge variant="secondary">{l.samePrice}</Badge>}
                  <Badge variant="outline">{x.sameBrand ? l.sameBrand : l.otherBrand}</Badge>
                </div>
                {x.note && <p className="text-sm text-muted-foreground">{fill(l.noteFromSupplier, { note: x.note })}</p>}
                {x.status === "PENDING" && mayDecide && <DecideButtons l={l} id={x.id} />}
                {x.status === "PENDING" && as !== "BUYER" && <WithdrawButton l={l} id={x.id} />}
              </li>
            ))}
          </ul>
        )}
        {lines.length > 0 && <ProposeForm l={l} locale={locale} lines={lines} />}
      </CardContent>
    </Card>
  );
}

/** The latest replacements on a customer's / supplier's orders (Replacements page). */
export async function RecentSubstitutions({ ctx, portal }: { ctx: Ctx; portal: "buy" | "vendor" }) {
  const { recentFor } = await import("@/server/substitutions/service");
  const Link = (await import("next/link")).default;
  const { l, locale } = await subLabels();
  const rows = await recentFor(ctx, portal);
  const date = new Intl.DateTimeFormat(locale, { dateStyle: "short", timeStyle: "short" });
  return (
    <Card className="mt-6" data-testid="sub-recent">
      <CardHeader><CardTitle>{l.recentTitle}</CardTitle></CardHeader>
      <CardContent>
        {!rows.length ? <p className="py-2 text-sm text-muted-foreground">{l.noRecent}</p> : (
          <ul className="divide-y">
            {rows.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-2 py-2 text-sm" data-testid="sub-recent-row" data-status={r.status}>
                <Link href={`/${portal}/orders/${r.orderId}#replacements`} className="font-mono text-xs text-primary hover:underline">{r.number}</Link>
                <span className="min-w-0 flex-1 basis-56 break-words">{r.shortQty} × {r.original} <ArrowRight className="inline size-3.5 text-muted-foreground" /> {r.qty} × {r.substitute} <span className="text-xs text-muted-foreground">· {r.other}</span></span>
                <span className={`text-xs tabular-nums ${r.diffPct > 0 ? "delta-neg" : r.diffPct < 0 ? "delta-pos" : "text-muted-foreground"}`}>{pct(r.diffPct, locale)}</span>
                <Badge variant={TONE[r.status]}>{l[`status.${r.status}`]}</Badge>
                <span className="text-xs text-muted-foreground">{date.format(new Date(r.createdAt))}</span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
