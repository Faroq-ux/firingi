"use client";
import { useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { CheckCircle2, Copy, CreditCard, Landmark, Loader2, Smartphone, XCircle, Receipt } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { refreshLinkPaymentAction, refreshPaymentAction, renewLinkAction, startLinkPaymentAction, startPaymentAction } from "@/server/actions/payments";

export type PayMethod = "CARD" | "MB_WAY" | "MULTIBANCO" | "DIRECT_DEBIT";
type Action = { type: "redirect"; url: string } | { type: "multibanco"; entity: string; reference: string; amount: string; expiresAt: string } | { type: "mbway"; phone: string; expiresAt: string } | { type: "none" };
export type PayRequestView = {
  id: string; token: string; amount: string; status: "OPEN" | "PROCESSING" | "PAID" | "FAILED" | "EXPIRED" | "CANCELLED";
  method: PayMethod | null; action: Action | null; failureReason: string | null; paidAmount: string | null;
  docs: { number: string; amount: string }[]; orderNumber: string | null; company: string;
};

const ICON = { CARD: CreditCard, MB_WAY: Smartphone, MULTIBANCO: Receipt, DIRECT_DEBIT: Landmark } as const;

export function PayPanel({ request, methods, mandateLast4, providerLabel, via, bankTransfer, returning }: {
  request: PayRequestView; methods: PayMethod[]; mandateLast4: string | null; providerLabel: string | null; via: "portal" | "link";
  bankTransfer: { holder: string; iban: string } | null; returning: boolean;
}) {
  const t = useTranslations("pay");
  const locale = useLocale();
  const router = useRouter();
  const money = (v: string | number) => new Intl.NumberFormat(locale, { style: "currency", currency: "EUR" }).format(Number(v));
  const usable = methods.filter((m) => via === "portal" || m !== "DIRECT_DEBIT");
  const [method, setMethod] = useState<PayMethod | null>(usable[0] ?? null);
  const [phone, setPhone] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [copied, setCopied] = useState<string | null>(null);
  // The countdown starts in the browser (server and browser clocks would render different minutes).
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => { const id = setTimeout(() => setNow(Date.now()), 0); return () => clearTimeout(id); }, []);

  // Waiting for the provider (MB WAY approval, Multibanco payment, back from the card page): check again regularly.
  const waiting = request.status === "PROCESSING" || (returning && request.status === "OPEN");
  useEffect(() => {
    if (!waiting) return;
    const every = request.method === "MULTIBANCO" ? 8000 : request.method === "DIRECT_DEBIT" ? 15000 : 3000;
    const id = setInterval(async () => {
      const r = via === "portal" ? await refreshPaymentAction({ id: request.id }) : await refreshLinkPaymentAction({ token: request.token });
      if (r.ok && r.data.status !== request.status) router.refresh();
      setNow(Date.now());
    }, every);
    return () => clearInterval(id);
  }, [waiting, request.id, request.token, request.method, request.status, via, router]);

  const errorText = (code: string, message: string) =>
    code === "PAYMENT_IN_PROGRESS" || code === "PAYMENT_EXPIRED" || code === "PROVIDER_UNAVAILABLE" ? t(`errors.${code}`) : code === "INTERNAL" ? t("errors.generic") : message;

  function pay() {
    if (!method) return;
    setError(null);
    if (method === "MB_WAY" && !/^(\+?351)?\s*9\d{2}\s*\d{3}\s*\d{3}$/.test(phone.trim())) return setError(t("badPhone"));
    start(async () => {
      const r = via === "portal" ? await startPaymentAction({ id: request.id, method, phone: phone || undefined }) : await startLinkPaymentAction({ token: request.token, method, phone: phone || undefined });
      if (!r.ok) return setError(errorText(r.code, r.error));
      if (r.data.action.type === "redirect") window.location.assign(r.data.action.url);
      else router.refresh();
    });
  }
  function renew() {
    start(async () => {
      const r = await renewLinkAction({ token: request.token });
      if (!r.ok) return setError(errorText(r.code, r.error));
      router.push(`/pay/${r.data.token}`);
    });
  }
  const copy = (key: string, text: string) => { void navigator.clipboard?.writeText(text.replace(/\s/g, "")); setCopied(key); setTimeout(() => setCopied(null), 1500); };

  const summary = useMemo(() => (
    <div className="rounded-xl border bg-muted/30 p-4" data-testid="pay-summary">
      <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t(request.status === "PAID" ? "amount" : "amountDue")}</div>
      <div className="mt-1 text-3xl font-bold tabular-nums" data-testid="pay-amount">{money(request.status === "PAID" && request.paidAmount ? request.paidAmount : request.amount)}</div>
      <div className="mt-2 text-sm text-muted-foreground">
        {request.orderNumber ? t("order", { number: request.orderNumber }) : (
          <ul className="space-y-0.5">{request.docs.map((d) => <li key={d.number} className="flex justify-between gap-3"><span className="font-mono text-xs">{d.number}</span><span className="tabular-nums">{money(d.amount)}</span></li>)}</ul>
        )}
      </div>
    </div>
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ), [request, locale]);

  if (request.status === "PAID")
    return (
      <div className="space-y-4" data-testid="pay-state" data-state="PAID">
        <div className="flex flex-col items-center gap-2 py-4 text-center">
          <CheckCircle2 className="size-12 text-success animate-pop" aria-hidden />
          <h2 className="text-xl font-semibold">{t("paid")}</h2>
          <p className="text-sm text-muted-foreground">{t("paidDetail", { amount: money(request.paidAmount ?? request.amount) })}</p>
          {request.orderNumber && <p className="text-sm">{t("paidOrder")}</p>}
        </div>
        {summary}
      </div>
    );

  if (request.status === "EXPIRED" || request.status === "CANCELLED")
    return (
      <div className="space-y-4 text-center" data-testid="pay-state" data-state={request.status}>
        <p className="py-2 text-sm">{t(request.status === "EXPIRED" ? "expired" : "cancelled")}</p>
        {via === "link" && !request.orderNumber && <Button onClick={renew} disabled={pending} data-testid="pay-renew">{pending && <Loader2 className="size-4 animate-spin" aria-hidden />}{t("payWhatsOpen")}</Button>}
        {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
      </div>
    );

  if (request.status === "PROCESSING") {
    const a = request.action;
    return (
      <div className="space-y-4" data-testid="pay-state" data-state="PROCESSING">
        {summary}
        {a?.type === "mbway" && (
          <div className="flex items-start gap-3 rounded-xl border p-4" data-testid="mbway-waiting">
            <Smartphone className="mt-0.5 size-6 shrink-0 text-primary" aria-hidden />
            <div className="space-y-1 text-sm">
              <p>{t("mbwayWaiting", { phone: `••• ${a.phone.slice(-3)}`, amount: money(request.amount) })}</p>
              {now !== null && <p className="text-muted-foreground">{t("mbwayExpires", { minutes: Math.max(0, Math.ceil((new Date(a.expiresAt).getTime() - now) / 60_000)) })}</p>}
            </div>
          </div>
        )}
        {a?.type === "multibanco" && (
          <div className="rounded-xl border p-4" data-testid="multibanco-ref">
            <h3 className="mb-3 font-semibold">{t("multibancoTitle")}</h3>
            <dl className="grid grid-cols-[auto_1fr_auto] items-center gap-x-3 gap-y-2 text-sm">
              {([["entity", a.entity], ["reference", a.reference], ["amount", money(a.amount)]] as const).map(([k, v]) => (
                <div key={k} className="contents">
                  <dt className="text-muted-foreground">{t(k)}</dt>
                  <dd className="font-mono text-lg font-semibold tabular-nums" data-testid={`mb-${k}`}>{v}</dd>
                  <dd>{k !== "amount" && <button type="button" className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs hover:bg-accent" onClick={() => copy(k, v)}><Copy className="size-3.5" aria-hidden />{copied === k ? t("copied") : t("copy")}</button>}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-3 text-xs text-muted-foreground">{t("validUntil", { date: new Date(a.expiresAt).toLocaleString(locale, { dateStyle: "medium", timeStyle: "short" }) })} · {t("multibancoHint")}</p>
          </div>
        )}
        {request.method === "DIRECT_DEBIT" && <p className="rounded-xl border p-4 text-sm" data-testid="debit-submitted">{t("debitSubmitted")}</p>}
        {request.method === "CARD" && <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" aria-hidden />{t("waiting")}</p>}
      </div>
    );
  }

  // OPEN or FAILED: choose how to pay.
  return (
    <div className="space-y-4" data-testid="pay-state" data-state={request.status}>
      {summary}
      {request.status === "FAILED" && (
        <p className="flex items-start gap-2 rounded-md bg-destructive/10 p-3 text-sm text-destructive" role="alert" data-testid="pay-failed">
          <XCircle className="mt-0.5 size-4 shrink-0" aria-hidden /><span>{t("failed", { reason: request.failureReason ?? "" })} {t("tryAgain")}</span>
        </p>
      )}
      {returning && request.status === "OPEN" && <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" aria-hidden />{t("waiting")}</p>}
      {usable.length ? (
        <>
          <fieldset className="space-y-2">
            <legend className="mb-2 text-sm font-medium">{t("chooseMethod")}</legend>
            {usable.map((m) => {
              const Icon = ICON[m];
              const disabled = m === "DIRECT_DEBIT" && !mandateLast4;
              return (
                <label key={m} className={cn("flex cursor-pointer items-center gap-3 rounded-xl border p-3 transition-colors", method === m ? "border-primary bg-primary/5 ring-1 ring-primary" : "hover:bg-accent/50", disabled && "cursor-not-allowed opacity-60")} data-method={m}>
                  <input type="radio" name="method" className="sr-only" checked={method === m} disabled={disabled} onChange={() => setMethod(m)} />
                  <Icon className="size-5 shrink-0 text-primary" aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium">{t(`methods.${m}`)}</span>
                    <span className="block text-xs text-muted-foreground">{m === "DIRECT_DEBIT" ? (mandateLast4 ? t("methodHints.DIRECT_DEBIT", { last4: mandateLast4 }) : t("dd.none")) : t(`methodHints.${m}`)}</span>
                  </span>
                  {disabled && via === "portal" && <Link href="/buy/finance/direct-debit" className="shrink-0 text-xs text-primary underline">{t("setUpDebit")}</Link>}
                </label>
              );
            })}
          </fieldset>
          {method === "MB_WAY" && (
            <div className="space-y-1">
              <label htmlFor="mbway-phone" className="text-sm font-medium">{t("phone")}</label>
              <Input id="mbway-phone" inputMode="tel" autoComplete="tel" placeholder="912 345 678" value={phone} onChange={(e) => setPhone(e.target.value)} data-testid="mbway-phone" />
            </div>
          )}
          {error && <p className="text-sm text-destructive" role="alert" data-testid="pay-error">{error}</p>}
          <Button className="w-full" size="lg" onClick={pay} disabled={pending || !method} data-testid="pay-button">
            {pending && <Loader2 className="size-4 animate-spin" aria-hidden />}{t("payNow", { amount: money(request.amount) })}
          </Button>
          {providerLabel && <p className="text-center text-xs text-muted-foreground">{t("secure", { provider: providerLabel })}</p>}
        </>
      ) : (
        <p className="text-sm">{t("noMethods")}</p>
      )}
      {bankTransfer && (
        <p className="rounded-md border p-3 text-xs text-muted-foreground" data-testid="pay-transfer">{t("bankTransfer", { holder: bankTransfer.holder })} <span className="font-mono">{bankTransfer.iban}</span></p>
      )}
    </div>
  );
}
