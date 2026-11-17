/** Returnables & deposits (Phase 40) — server-rendered pieces shared by the buyer, supplier and FIRINGI pages. */
import Link from "next/link";
import { PackageOpen, Recycle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { fill } from "./labels";

type L = Record<string, string>;
const money = (n: number, locale: string) => new Intl.NumberFormat(locale, { style: "currency", currency: "EUR" }).format(n);
const day = (d: Date | string | null, locale: string) => (d ? new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(new Date(d)) : "—");

export const RET_TONE = { COLLECTED: "warning", CONFIRMED: "success", DISPUTED: "destructive", RESOLVED: "secondary" } as const;
export const PICKUP_TONE = { REQUESTED: "warning", PLANNED: "secondary", COLLECTED: "success", CANCELLED: "outline" } as const;

/** "Comes with: 1 × crate (deposit 3,00 €)" / "Refill: hand back an empty …" — product page, cards, cart. */
export function ProductReturnables({ l, locale, items, compact }: { l: L; locale: string; items: { code: string; name: string; kind: "DEPOSIT" | "EXCHANGE"; qtyPerUnit: number; depositNet: number }[]; compact?: boolean }) {
  if (!items.length) return null;
  if (compact) {
    const swap = items.some((i) => i.kind === "EXCHANGE");
    return <Badge variant="outline" className="gap-1" data-testid="returnable-badge"><Recycle className="size-3" /> {swap ? l.badgeRefill : l.badgeDeposit}</Badge>;
  }
  return (
    <div className="space-y-1.5 rounded-xl border border-dashed p-3 text-sm" data-testid="product-returnables">
      <p className="flex items-center gap-2 font-medium"><Recycle className="size-4" /> {l.returnableTitle}</p>
      <ul className="space-y-1">
        {items.map((i) => (
          <li key={i.code} className="break-words" data-testid="product-returnable" data-kind={i.kind}>
            {i.kind === "EXCHANGE"
              ? fill(l.refillText, { n: i.qtyPerUnit, name: i.name, deposit: money(i.depositNet, locale) })
              : fill(l.depositText, { n: i.qtyPerUnit, name: i.name, deposit: money(i.depositNet, locale) })}
          </li>
        ))}
      </ul>
      <p className="text-xs text-muted-foreground">{l.returnableHint}</p>
    </div>
  );
}

/** Deposits on an order: units out, swapped empties, deposit charged (estimate until delivered). */
export function OrderDeposits({ l, locale, rows, delivered }: { l: L; locale: string; delivered: boolean; rows: { code: string; name: string; kind: string; qtyOut: number; swapPlanned: number; swapDone: number | null; invoicedQty: number; estimatedQty: number; depositUnitNet: number; vatRate: number }[] }) {
  if (!rows.length) return null;
  const total = rows.reduce((a, r) => a + (delivered ? r.invoicedQty : r.estimatedQty) * r.depositUnitNet, 0);
  return (
    <div className="space-y-2" data-testid="order-deposits">
      <p className="flex items-center gap-2 text-sm font-medium"><PackageOpen className="size-4" /> {l.depositsTitle}</p>
      <ul className="divide-y text-sm">
        {rows.map((r) => {
          const n = delivered ? r.invoicedQty : r.estimatedQty;
          const swapped = r.kind === "EXCHANGE" ? (r.swapDone ?? r.swapPlanned) : 0;
          return (
            <li key={r.code} className="flex flex-wrap items-baseline justify-between gap-2 py-1.5" data-testid="order-deposit" data-type={r.code}>
              <span className="min-w-0 break-words">{r.qtyOut} × {r.name}{swapped ? ` · ${fill(l.swappedN, { n: swapped })}` : ""}</span>
              <span className="tabular-nums">{n > 0 ? fill(l.depositLine, { n, price: money(r.depositUnitNet, locale), total: money(n * r.depositUnitNet, locale) }) : l.noDeposit}</span>
            </li>
          );
        })}
      </ul>
      <div className="flex justify-between text-sm font-medium"><span>{delivered ? l.depositInvoiced : l.depositEstimated}</span><span className="tabular-nums">{money(total, locale)}</span></div>
    </div>
  );
}

type Bal = { customerId: string; supplierId: string; customer: string; supplier: string; typeId: string; code: string; name: string; kind: string; held: number; overdue: number; paid: number; depositValue: number; oldest: Date | null };

/** What is out: per item (and per customer or supplier). */
export function BalancesTable({ l, locale, rows, by }: { l: L; locale: string; rows: Bal[]; by: "customer" | "supplier" }) {
  if (!rows.length) return <p className="py-6 text-center text-sm text-muted-foreground">{l.noBalances}</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[34rem] text-sm" data-testid="balances">
        <thead><tr className="border-b text-left text-xs text-muted-foreground"><th className="py-2 pr-2">{by === "customer" ? l.customer : l.supplier}</th><th className="pr-2">{l.item}</th><th className="pr-2 text-right">{l.held}</th><th className="pr-2 text-right">{l.depositPaid}</th><th className="pr-2">{l.since}</th><th>{l.overdue}</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={`${r.customerId}${r.supplierId}${r.typeId}`} className="border-b last:border-0" data-testid="balance-row" data-type={r.code}>
              <td className="py-2 pr-2">{by === "customer" ? r.customer : r.supplier}</td>
              <td className="pr-2">{r.name} {r.kind === "EXCHANGE" && <Badge variant="outline" className="ml-1">{l["kind.EXCHANGE"]}</Badge>}</td>
              <td className="pr-2 text-right tabular-nums" data-testid="balance-held">{r.held}</td>
              <td className="pr-2 text-right tabular-nums">{money(r.depositValue, locale)}</td>
              <td className="pr-2">{day(r.oldest, locale)}</td>
              <td>{r.overdue > 0 ? <Badge variant="warning" data-testid="balance-overdue">{fill(l.overdueN, { n: r.overdue })}</Badge> : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

type Ret = { id: string; number: string; source: string; status: keyof typeof RET_TONE; collectedAt: Date; units: number; creditGross: number; customer: string; supplier: string; lines: { name: string; counted: number; accepted: number | null; damaged: number }[] };

export function ReturnsList({ l, locale, rows, href, show }: { l: L; locale: string; rows: Ret[]; href: (id: string) => string; show: "customer" | "supplier" | "both" }) {
  if (!rows.length) return <p className="py-6 text-center text-sm text-muted-foreground">{l.noReturns}</p>;
  return (
    <ul className="divide-y" data-testid="returns">
      {rows.map((r) => (
        <li key={r.id} className="flex flex-wrap items-center gap-2 py-2.5 text-sm" data-testid="return-row" data-status={r.status}>
          <Link href={href(r.id)} className="font-mono text-xs text-primary underline-offset-2 hover:underline">{r.number}</Link>
          <Badge variant={RET_TONE[r.status]}>{l[`status.${r.status}`]}</Badge>
          <span className="text-xs text-muted-foreground">{l[`source.${r.source}`]} · {day(r.collectedAt, locale)}</span>
          <span className="min-w-0 flex-1 break-words">{show !== "supplier" ? r.customer : ""}{show === "both" ? " → " : ""}{show !== "customer" ? r.supplier : ""}</span>
          <span className="text-xs">{r.lines.map((x) => `${x.counted} × ${x.name}`).join(", ")}</span>
          {r.creditGross > 0 && <span className="tabular-nums text-xs">{fill(l.refunded, { amount: money(r.creditGross, locale) })}</span>}
        </li>
      ))}
    </ul>
  );
}

/** One return: what was counted, accepted, damaged, refunded. */
export function ReturnLines({ l, lines }: { l: L; lines: { code: string; name: string; counted: number; accepted: number | null; damaged: number; credited: number }[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[28rem] text-sm" data-testid="return-lines">
        <thead><tr className="border-b text-left text-xs text-muted-foreground"><th className="py-2 pr-2">{l.item}</th><th className="pr-2 text-right">{l.counted}</th><th className="pr-2 text-right">{l.accepted}</th><th className="pr-2 text-right">{l.damaged}</th><th className="pr-2 text-right">{l.missing}</th><th className="text-right">{l.refundedUnits}</th></tr></thead>
        <tbody>
          {lines.map((x) => (
            <tr key={x.code} className="border-b last:border-0" data-testid="return-line" data-type={x.code}>
              <td className="py-2 pr-2">{x.name}</td><td className="pr-2 text-right tabular-nums">{x.counted}</td>
              <td className="pr-2 text-right tabular-nums">{x.accepted ?? "—"}</td><td className="pr-2 text-right tabular-nums">{x.accepted == null ? "—" : x.damaged}</td>
              <td className="pr-2 text-right tabular-nums">{x.accepted == null ? "—" : Math.max(0, x.counted - x.accepted - x.damaged)}</td>
              <td className="text-right tabular-nums" data-testid="return-credited">{x.credited}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Card on an order page (buyer, supplier, FIRINGI): the order's returnables and deposits. */
export async function OrderDepositsCard({ orderId, status, english }: { orderId: string; status: string; english?: boolean }) {
  const { orderReturnables } = await import("@/server/returnables/service");
  const { rtLabels, enLabels } = await import("./labels");
  const { Card, CardContent } = await import("@/components/ui/card");
  const { l, locale } = english ? { l: enLabels(), locale: "en" } : await rtLabels();
  const rows = await orderReturnables(orderId, locale);
  if (!rows.length) return null;
  return <Card className="mt-6"><CardContent className="pt-5"><OrderDeposits l={l} locale={locale} rows={rows} delivered={status === "DELIVERED"} /></CardContent></Card>;
}
