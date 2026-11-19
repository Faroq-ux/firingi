/**
 * Phase 47 — the receipt behind the QR code on a till receipt: no login, the long random token is the key.
 * It shows the legal number once the business's certified provider gave it.
 */
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { publicReceipt } from "@/server/pos/sales";
import { formatMoney } from "@/lib/utils";

export const metadata: Metadata = { title: "Receipt", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function ReceiptPage({ params }: { params: Promise<{ token: string }> }) {
  const r = await publicReceipt((await params).token);
  if (!r) notFound();
  const [t, locale] = await Promise.all([getTranslations("pos"), getLocale()]);
  const { sale: s, company: c } = r;
  const m = (v: unknown) => formatMoney(Number(v), locale, s.currency);
  const rates = new Map<string, { net: number; vat: number }>();
  for (const l of s.lines) { const k = l.vatRate.toString(); const x = rates.get(k) ?? { net: 0, vat: 0 }; rates.set(k, { net: x.net + Number(l.net), vat: x.vat + Number(l.vat) }); }
  return (
    <main className="mx-auto min-h-dvh max-w-md bg-background px-4 py-8 text-foreground" data-testid="public-receipt">
      <div className="space-y-2 rounded-xl border bg-card p-5 font-mono text-sm">
        <div className="text-center">
          <div className="text-base font-bold">{c.tradeName ?? c.legalName}</div>
          <div>{c.legalName}</div><div>{t("taxIdShort")}: {c.taxId}{c.vatNumber ? ` · ${c.vatNumber}` : ""}</div>
          {c.posCompany?.receiptHeader && <div className="whitespace-pre-wrap">{c.posCompany.receiptHeader}</div>}
        </div>
        <hr className="border-dashed" />
        <div className="font-semibold" data-testid="public-receipt-number">{s.kind === "REFUND" ? `${t("refund")} · ` : ""}{s.fiscalNumber ?? s.number}</div>
        <div>{new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(s.soldAt)} · {s.register.code}</div>
        {s.refundOf && <div>{t("refundOf", { n: s.refundOf.fiscalNumber ?? s.refundOf.number })}</div>}
        {s.customerTaxId && <div>{t("customerTaxId")}: {s.customerTaxId}</div>}
        <hr className="border-dashed" />
        {s.lines.map((l) => (
          <div key={l.id}><div className="break-words">{l.name}</div><div className="flex justify-between"><span>{l.byWeight ? `${Number(l.qty).toFixed(3)} kg` : l.qty.toString()} × {m(l.unitPrice)}{Number(l.discountPct) ? ` −${Number(l.discountPct)}%` : ""}</span><span>{m(l.gross)}</span></div></div>
        ))}
        <hr className="border-dashed" />
        {[...rates].map(([rate, v]) => <div key={rate} className="flex justify-between"><span>{t("vatAt", { rate })} ({m(v.net)})</span><span>{m(v.vat)}</span></div>)}
        <div className="flex justify-between text-base font-bold"><span>{t("total")}</span><span data-testid="public-receipt-total">{m(s.gross)}</span></div>
        {s.payments.map((p) => <div key={p.id} className="flex justify-between"><span>{p.method}</span><span>{m(p.tendered ?? p.amount)}</span></div>)}
        {s.payments.some((p) => p.change && Number(p.change)) && <div className="flex justify-between"><span>{t("change")}</span><span>{m(s.payments.find((p) => p.change)?.change)}</span></div>}
        <hr className="border-dashed" />
        <p data-testid="public-receipt-legal">{s.fiscalStatus === "NOT_REQUIRED" ? t("nonFiscalNote") : s.fiscalStatus === "DONE" ? t("fiscalDone") : t("fiscalPending")}</p>
        {s.fiscalQr && <p className="break-all text-[10px] text-muted-foreground">{s.fiscalQr}</p>}
        {c.posCompany?.receiptFooter && <p className="whitespace-pre-wrap text-center">{c.posCompany.receiptFooter}</p>}
      </div>
      <p className="mt-4 text-center text-xs text-muted-foreground">{t("poweredBy")}</p>
    </main>
  );
}
