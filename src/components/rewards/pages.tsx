/** Rewards shop (Phase 55) — the buyer's shop and rewards, the supplier's reward products and hand-overs (server-rendered). */
import Link from "next/link";
import { notFound } from "next/navigation";
import { Gift, HandCoins, Heart, PackageCheck, Percent, ShoppingBag, Sparkles, Store, Ticket, Truck } from "lucide-react";
import type { Ctx } from "@/server/context";
import { AppError, NotFoundError } from "@/server/errors";
import * as R from "@/server/rewards/service";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { day, eur, fill, num, rewardsLabels } from "./labels";
import { CancelMine, CantGive, CopyCode, GoalButton, RedeemPanel, SupplierRewardEditor, SupplierRewardForm, SupplierStatus, UseButton } from "./client";

type L = Record<string, string>;
const B = "/buy/rewards";
export const KIND_ICON = { VOUCHER: Percent, FREE_DELIVERY: Truck, SUPPLIER_PRODUCT: Store, GIFT: Gift, PARTNER: Ticket } as const;
const KIND_TONE: Record<string, string> = {
  VOUCHER: "from-[var(--vivid-blue)] to-[var(--vivid-violet)]", FREE_DELIVERY: "from-sky-500 to-cyan-400", SUPPLIER_PRODUCT: "from-emerald-500 to-lime-400",
  GIFT: "from-rose-500 to-amber-400", PARTNER: "from-fuchsia-500 to-indigo-400",
};

function Closed({ l, title, text }: { l: L; title: string; text?: string }) {
  return (<><PageHeader title={title} icon={Gift} /><p className="py-10 text-center text-muted-foreground" data-testid="rewards-closed">{text ?? l.closed}</p></>);
}

async function load<T>(fn: () => Promise<T>): Promise<T | null> {
  try { return await fn(); } catch (e) {
    if (e instanceof NotFoundError) notFound();
    if (e instanceof AppError && (e.code === "REWARDS_OFF" || e.code === "FORBIDDEN")) return null;
    throw e;
  }
}

function Art({ kind, image, className = "" }: { kind: string; image: string | null; className?: string }) {
  const Icon = KIND_ICON[kind as keyof typeof KIND_ICON] ?? Gift;
  if (image) return (
    <div className={`grid place-items-center overflow-hidden bg-white dark:bg-muted ${className}`}>
      {/* eslint-disable-next-line @next/next/no-img-element -- private, signed-in pictures from our own route */}
      <img src={image} alt="" className="max-h-full max-w-full object-contain" />
    </div>
  );
  return <div className={`grid place-items-center bg-gradient-to-br ${KIND_TONE[kind] ?? KIND_TONE.VOUCHER} text-white ${className}`}><Icon className="size-10 drop-shadow" aria-hidden /></div>;
}

type Item = Awaited<ReturnType<typeof R.rewardsShop>>["items"][number];

function blockedText(it: Item, l: L, locale: string) {
  if (!it.blocked) return null;
  if (it.blocked === "POINTS") return fill(l["blocked.POINTS"], { missing: num(it.progress.missing, locale) });
  if (it.blocked === "TIER") return fill(l["blocked.TIER"], { tier: l[`tiers.${it.minTier}`] ?? it.minTier ?? "" });
  return l[`blocked.${it.blocked}`];
}

function whatYouGet(it: Item, l: L, locale: string) {
  if (it.kind === "VOUCHER") return fill(l.voucherWorth, { amount: eur(it.voucherAmount, locale) });
  if (it.kind === "FREE_DELIVERY") return l.freeDeliveryText;
  if (it.kind === "SUPPLIER_PRODUCT") return fill(l.freeUnits, { qty: it.qty ?? 1, product: it.offer?.name ?? "", supplier: it.supplier ?? "" });
  if (it.kind === "PARTNER") return it.partnerName ?? "";
  return null;
}

// ── buyer: the shop ─────────────────────────────────────────────────────────

export async function ShopView({ ctx, kind }: { ctx: Ctx; kind?: string }) {
  const { l, locale } = await rewardsLabels();
  const d = await load(() => R.rewardsShop(ctx, locale, { kind }));
  if (!d) return <Closed l={l} title={l.title} />;
  const tabs = ["", ...d.kinds];
  return (
    <>
      <PageHeader title={l.title} icon={ShoppingBag} description={l.description} actions={<Link href={`${B}/mine`} className="text-sm text-primary hover:underline" data-testid="to-mine">{l.toMine} →</Link>} />
      <div className="mb-4 grid gap-4 lg:grid-cols-3">
        <Card className="relative overflow-hidden lg:col-span-1" data-testid="shop-balance">
          <div aria-hidden className="pointer-events-none absolute -right-12 -top-12 size-40 rounded-full bg-[radial-gradient(circle,color-mix(in_oklch,var(--vivid-violet)_35%,transparent),transparent_70%)]" />
          <CardContent className="relative pt-6">
            <p className="text-sm text-muted-foreground">{l.balance}</p>
            <p className="text-gradient text-4xl font-bold tabular-nums" data-testid="shop-points">{num(d.balance, locale)}</p>
            <p className="text-sm text-muted-foreground">{fill(l.worth, { value: eur(d.value, locale) })} · {l[`tiers.${d.tier}`]}</p>
            {d.monthlyLeft != null && <p className="mt-2 text-xs text-muted-foreground">{fill(l.monthlyLeft, { points: num(d.monthlyLeft, locale) })}</p>}
          </CardContent>
        </Card>
        <Card className="lg:col-span-2" data-testid="shop-goal">
          <CardContent className="flex h-full flex-col justify-center gap-2 pt-6">
            <p className="flex items-center gap-2 text-sm font-medium"><Heart className="size-4 text-rose-500" aria-hidden /> {l.goalTitle}</p>
            {d.goal ? (
              <>
                <Link href={`${B}/shop/${d.goal.id}`} className="break-words font-semibold hover:underline">{d.goal.title}</Link>
                <div className="h-2.5 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={d.goal.progress.pct} aria-label={l.goalTitle}>
                  <div className="h-full rounded-full bg-[linear-gradient(90deg,var(--vivid-blue),var(--vivid-violet))]" style={{ width: `${d.goal.progress.pct}%` }} />
                </div>
                <p className="text-sm text-muted-foreground">{d.goal.progress.missing > 0 ? fill(l.goalMissing, { missing: num(d.goal.progress.missing, locale) }) : l.goalReady}</p>
              </>
            ) : <p className="text-sm text-muted-foreground">{l.noGoal}</p>}
          </CardContent>
        </Card>
      </div>
      <nav className="mb-4 flex flex-wrap gap-2" aria-label={l.title}>
        {tabs.map((k) => {
          const on = (kind ?? "") === k;
          return <Link key={k || "all"} href={k ? `${B}/shop?kind=${k}` : `${B}/shop`} aria-current={on ? "page" : undefined} className={`rounded-full border px-3 py-1 text-sm ${on ? "border-primary bg-primary/10 text-primary" : "hover:bg-accent"}`} data-testid={`shop-tab-${k || "ALL"}`}>{k ? l[`kind.${k}`] : l.all}</Link>;
        })}
      </nav>
      {!d.items.length ? <p className="py-10 text-center text-muted-foreground" data-testid="shop-empty">{l.empty}</p> : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4" data-testid="shop-items">
          {d.items.map((it) => {
            const blocked = blockedText(it, l, locale);
            const get = whatYouGet(it, l, locale);
            return (
              <li key={it.id}>
                <Link href={`${B}/shop/${it.id}`} className="group flex h-full flex-col overflow-hidden rounded-2xl border bg-card shadow-sm transition hover:-translate-y-0.5 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" data-testid="shop-item">
                  <div className="relative">
                    <Art kind={it.kind} image={it.image} className="h-32 w-full" />
                    <Badge variant="secondary" className="absolute left-2 top-2 bg-background/90 backdrop-blur">{l[`kindOne.${it.kind}`]}</Badge>
                    {it.featured && <Sparkles className="absolute right-2 top-2 size-5 text-amber-300 drop-shadow" aria-hidden />}
                  </div>
                  <div className="flex flex-1 flex-col gap-1.5 p-4">
                    <p className="break-words font-semibold leading-snug">{it.title}</p>
                    {get && <p className="break-words text-sm text-muted-foreground">{get}</p>}
                    <div className="mt-auto flex flex-wrap items-center justify-between gap-2 pt-2">
                      <span className="rounded-full bg-primary/10 px-2.5 py-0.5 text-sm font-semibold tabular-nums text-primary" data-testid="item-points">{fill(l.pts, { points: num(it.points, locale) })}</span>
                      {it.stock != null && <span className={`text-xs ${it.stock <= 0 ? "text-destructive" : "text-muted-foreground"}`}>{it.stock <= 0 ? l.soldOut : fill(l.left, { n: num(it.stock, locale) })}</span>}
                    </div>
                    {blocked && <p className="text-xs text-muted-foreground" data-testid="item-blocked">{blocked}</p>}
                    {it.blocked === "POINTS" && <div className="h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden><div className="h-full bg-primary/60" style={{ width: `${it.progress.pct}%` }} /></div>}
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}

export async function RewardDetailView({ ctx, id }: { ctx: Ctx; id: string }) {
  const { l, locale } = await rewardsLabels();
  const d = await load(() => R.rewardForBuyer(ctx, id, locale));
  if (!d) return <Closed l={l} title={l.title} />;
  const it = d.item;
  const get = whatYouGet(it, l, locale);
  const facts = [
    it.kind === "VOUCHER" || it.kind === "FREE_DELIVERY" ? (it.voucherMinOrder ? fill(l.minOrder, { amount: eur(it.voucherMinOrder, locale) }) : null) : null,
    it.voucherDays ? fill(l.validDays, { days: it.voucherDays }) : null,
    it.minTier ? fill(l.minTier, { tier: l[`tiers.${it.minTier}`] }) : null,
    it.stock != null ? (it.stock <= 0 ? l.soldOut : fill(l.left, { n: num(it.stock, locale) })) : null,
    it.validTo ? fill(l.useBy, { date: day(it.validTo, locale) }) : null,
  ].filter(Boolean) as string[];
  return (
    <>
      <PageHeader title={it.title} icon={KIND_ICON[it.kind]} eyebrow={l[`kindOne.${it.kind}`]} actions={<Link href={`${B}/shop`} className="text-sm text-primary hover:underline">← {l.back}</Link>} />
      <div className="grid gap-4 lg:grid-cols-5">
        <Card className="overflow-hidden lg:col-span-2"><Art kind={it.kind} image={it.image} className="h-56 w-full" /></Card>
        <Card className="lg:col-span-3" data-testid="reward-detail">
          <CardContent className="space-y-4 pt-6">
            <div className="flex flex-wrap items-baseline gap-3">
              <span className="text-gradient text-3xl font-bold tabular-nums">{fill(l.pts, { points: num(it.points, locale) })}</span>
            </div>
            {get && <p className="break-words font-medium">{get}</p>}
            {it.description && <p className="whitespace-pre-line break-words text-sm">{it.description}</p>}
            {facts.length > 0 && <ul className="flex flex-wrap gap-2">{facts.map((f) => <li key={f}><Badge variant="outline">{f}</Badge></li>)}</ul>}
            {it.terms && <details className="text-sm"><summary className="cursor-pointer text-muted-foreground">{l.terms}</summary><p className="mt-2 whitespace-pre-line break-words">{it.terms}</p></details>}
            <p className="text-sm text-muted-foreground">{l.balance}: <span className="font-semibold tabular-nums text-foreground">{num(d.balance, locale)}</span></p>
            <RedeemPanel l={l} id={it.id} kind={it.kind} points={num(it.points, locale)} blocked={blockedText(it, l, locale)} supplier={it.supplier} useByDays={it.voucherDays}
              addresses={d.addresses.map((a) => ({ id: a.id, text: `${a.label} — ${a.line1}, ${a.postalCode} ${a.cityName}` }))} />
            <GoalButton l={l} id={it.id} saving={d.goal?.id === it.id} />
          </CardContent>
        </Card>
      </div>
    </>
  );
}

// ── buyer: my rewards ───────────────────────────────────────────────────────

const STATUS_TONE: Record<string, "success" | "warning" | "secondary" | "destructive" | "default"> = {
  ISSUED: "success", PENDING: "warning", SHIPPED: "default", DELIVERED: "success", USED: "secondary", CANCELLED: "secondary", EXPIRED: "destructive",
};

export async function MyRewardsView({ ctx }: { ctx: Ctx }) {
  const { l, locale } = await rewardsLabels();
  const d = await load(() => R.myRedemptions(ctx, locale));
  if (!d) return <Closed l={l} title={l.mineTitle} />;
  return (
    <>
      <PageHeader title={l.mineTitle} icon={Gift} description={l.mineDescription} actions={<Link href={`${B}/shop`} className="text-sm text-primary hover:underline">{l.toShop} →</Link>} />
      {!d.rows.length ? (
        <div className="py-10 text-center text-muted-foreground" data-testid="mine-empty"><p>{l.noRedemptions}</p><Link href={`${B}/shop`} className="mt-2 inline-block text-primary hover:underline">{l.toShop}</Link></div>
      ) : (
        <ul className="space-y-3" data-testid="mine-list">
          {d.rows.map((r) => {
            const Icon = KIND_ICON[r.kind];
            const product = r.kind === "SUPPLIER_PRODUCT";
            const status = product && r.status === "PENDING" ? l.productWaiting : product && r.status === "SHIPPED" && r.order?.number ? fill(l.onOrder, { number: r.order.number }) : l[`status.${r.status}`];
            const open = r.status === "ISSUED" || r.status === "PENDING" || r.status === "SHIPPED";
            return (
              <li key={r.id}>
                <Card data-testid="mine-row" data-kind={r.kind} data-status={r.status}>
                  <CardContent className="flex flex-col gap-3 pt-5 sm:flex-row sm:items-start">
                    <span className={`grid size-11 shrink-0 place-items-center rounded-xl bg-gradient-to-br ${KIND_TONE[r.kind]} text-white`}><Icon className="size-5" aria-hidden /></span>
                    <div className="min-w-0 flex-1 space-y-1.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="break-words font-semibold">{r.title}</p>
                        <Badge variant={STATUS_TONE[r.status]} data-testid="mine-status">{status}</Badge>
                      </div>
                      <p className="text-xs text-muted-foreground">{fill(l.redeemedOn, { date: day(r.at, locale) })} · {fill(l.pts, { points: num(r.points, locale) })}</p>
                      {r.couponCode && r.status === "ISSUED" && <div className="flex flex-wrap items-center gap-2"><CopyCode l={l} code={r.couponCode} />{r.expiresAt && <span className="text-xs text-muted-foreground">{fill(l.useBy, { date: day(r.expiresAt, locale) })}</span>}</div>}
                      {r.partnerCode && <div className="flex flex-wrap items-center gap-2"><CopyCode l={l} code={r.partnerCode} />{r.partnerUrl && <a href={r.partnerUrl} target="_blank" rel="noopener noreferrer" className="text-sm text-primary hover:underline">{l.openPartner} ↗</a>}</div>}
                      {r.partnerCode && r.terms && <p className="whitespace-pre-line break-words text-xs text-muted-foreground">{r.terms}</p>}
                      {product && <p className="break-words text-sm">{fill(l.freeUnits, { qty: r.qty, product: r.offer ?? "", supplier: r.supplier ?? "" })}</p>}
                      {product && r.status === "PENDING" && r.expiresAt && <p className="text-xs text-muted-foreground">{fill(l.orderBy, { date: day(r.expiresAt, locale) })}</p>}
                      {r.order && <Link href={`/buy/orders/${r.order.id}`} className="text-sm text-primary hover:underline">{fill(l.onOrder, { number: r.order.number ?? "" })}</Link>}
                      {r.address && <p className="break-words text-sm text-muted-foreground">{l.sendTo}: {r.address}</p>}
                      {r.tracking && <p className="break-words text-sm">{fill(l.tracking, { tracking: r.tracking })}</p>}
                      {r.cancelReason && <p className="break-words text-xs text-muted-foreground">{fill(l.cancelReason, { reason: r.cancelReason })}</p>}
                    </div>
                    {open && (
                      <div className="flex flex-wrap items-start gap-2 sm:flex-col sm:items-end">
                        {r.couponCode && r.status === "ISSUED" && <UseButton l={l} id={r.id} label={l.useInCart} />}
                        {product && (r.status === "PENDING" || r.status === "SHIPPED") && r.usedQty < r.qty && <UseButton l={l} id={r.id} label={l.addToCart} />}
                        {r.canCancel && <CancelMine l={l} id={r.id} />}
                      </div>
                    )}
                  </CardContent>
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}

// ── supplier ────────────────────────────────────────────────────────────────

const V_TONE: Record<string, "success" | "warning" | "secondary" | "destructive" | "default"> = { DRAFT: "secondary", PENDING: "warning", ACTIVE: "success", PAUSED: "secondary", REJECTED: "destructive", ENDED: "secondary" };

export async function SupplierRewardsView({ ctx }: { ctx: Ctx }) {
  const { l, locale } = await rewardsLabels();
  const d = await load(async () => ({ list: await R.supplierRewards(ctx, locale), opts: await R.supplierRewardOptions(ctx) }));
  if (!d) return <Closed l={l} title={l["v.title"]} text={l["v.closed"]} />;
  const { min, max } = { min: d.opts.settings.supplierMinPoints, max: d.opts.settings.supplierMaxPoints };
  return (
    <>
      <PageHeader title={l["v.title"]} icon={HandCoins} description={l["v.description"]} actions={<Link href="/vendor/products/rewards/handover" className="text-sm text-primary hover:underline">{l["v.handoverTitle"]} →</Link>} />
      <Card className="mb-4">
        <CardHeader><CardTitle>{l["v.new"]}</CardTitle></CardHeader>
        <CardContent><SupplierRewardForm l={l} locale={locale} offers={d.opts.offers} min={min} max={max} /></CardContent>
      </Card>
      {!d.list.items.length ? <p className="py-6 text-center text-muted-foreground" data-testid="sr-empty">{l["v.empty"]}</p> : (
        <ul className="space-y-3" data-testid="sr-list">
          {d.list.items.map((it) => (
            <li key={it.id}>
              <Card data-testid="sr-row" data-status={it.status}>
                <CardContent className="flex flex-col gap-3 pt-5 sm:flex-row sm:flex-wrap sm:items-start">
                  <Art kind={it.kind} image={it.image} className="size-16 shrink-0 rounded-xl" />
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex flex-wrap items-center gap-2"><p className="break-words font-semibold">{it.title}</p><Badge variant={V_TONE[it.status]} data-testid="sr-status">{l[`v.status.${it.status}`]}</Badge></div>
                    <p className="break-words text-sm text-muted-foreground">{it.qty} × {it.offer?.name}</p>
                    <p className="text-sm"><span className="font-semibold tabular-nums">{fill(l.pts, { points: num(it.points, locale) })}</span>{it.stock != null && <> · {fill(l.left, { n: num(it.stock, locale) })}</>} · {fill(l["v.redeemed"], { n: it.redeemed })}{it.toHand > 0 && <> · <Link href="/vendor/products/rewards/handover" className="text-primary hover:underline">{fill(l["v.toHand"], { n: it.toHand })}</Link></>}</p>
                    {it.reviewNote && <p className="break-words text-xs text-muted-foreground">{fill(l["v.note"], { note: it.reviewNote })}</p>}
                  </div>
                  <div className="flex flex-wrap items-center gap-1">
                    <SupplierStatus l={l} id={it.id} status={it.status} />
                    {it.status !== "ENDED" && <SupplierRewardEditor l={l} locale={locale} offers={d.opts.offers} min={min} max={max} item={{ id: it.id, offerId: it.offerId, qty: it.qty, points: it.points, stock: it.stock, perBuyerLimit: it.perBuyerLimit, minTier: it.minTier, title: it.title, description: it.description, validTo: it.validTo }} />}
                  </div>
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

export async function SupplierHandoverView({ ctx }: { ctx: Ctx }) {
  const { l, locale } = await rewardsLabels();
  const rows = await load(() => R.supplierHandovers(ctx, locale));
  if (!rows) return <Closed l={l} title={l["v.handoverTitle"]} text={l["v.closed"]} />;
  return (
    <>
      <PageHeader title={l["v.handoverTitle"]} icon={PackageCheck} description={l["v.handoverDescription"]} actions={<Link href="/vendor/products/rewards" className="text-sm text-primary hover:underline">← {l["v.title"]}</Link>} />
      {!rows.length ? <p className="py-10 text-center text-muted-foreground" data-testid="handover-empty">{l["v.noHandovers"]}</p> : (
        <Card><CardContent className="pt-4">
          <ul className="divide-y" data-testid="handover-list">
            {rows.map((r) => (
              <li key={r.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:flex-wrap sm:items-center" data-testid="handover-row" data-status={r.status}>
                <div className="min-w-0 flex-1">
                  <p className="break-words font-medium">{r.buyer}</p>
                  <p className="break-words text-sm text-muted-foreground">{r.qty} × {r.offer} · {day(r.at, locale)}</p>
                  {r.status === "PENDING" && r.expiresAt && <p className="text-xs text-muted-foreground">{fill(l["v.orderBy"], { date: day(r.expiresAt, locale) })}</p>}
                  {r.cancelReason && <p className="break-words text-xs text-muted-foreground">{fill(l.cancelReason, { reason: r.cancelReason })}</p>}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={r.status === "DELIVERED" ? "success" : r.status === "PENDING" ? "warning" : r.status === "SHIPPED" ? "default" : "secondary"}>{l[`v.hand.${r.status}`] ?? l[`status.${r.status}`]}</Badge>
                  {r.order && <Link href={`/vendor/orders/${r.order.id}`} className="text-sm text-primary hover:underline">{r.order.number}</Link>}
                  {r.canCancel && <CantGive l={l} id={r.id} />}
                </div>
              </li>
            ))}
          </ul>
        </CardContent></Card>
      )}
      <CardDescription className="mt-3">{l["v.cost"]}</CardDescription>
    </>
  );
}
