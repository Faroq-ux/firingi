/** More Executive Overview cards: AI Centre, consignment stock, savings this month (messages › adminExtra). */
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { ArrowRight, Boxes, Fuel, Leaf, Route as RouteIcon, Sparkles } from "lucide-react";
import type { AdminExtras } from "@/server/data/admin-extras";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatMoney } from "@/lib/utils";

const tr = () => getTranslations("adminExtra");
const num = (v: number, locale: string) => v.toLocaleString(locale, { maximumFractionDigits: 1 });
const Head = ({ title, href, link, icon: Icon }: { title: string; href: string; link: string; icon: typeof Sparkles }) => (
  <CardHeader className="flex-row items-center justify-between gap-2 space-y-0 pb-2">
    <CardTitle className="flex items-center gap-2 text-[15px]"><Icon className="size-4 text-primary" aria-hidden /> {title}</CardTitle>
    <Link href={href} className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">{link} <ArrowRight className="size-3" /></Link>
  </CardHeader>
);
const Stat = ({ label, value, tone = "", href, testid }: { label: string; value: string; tone?: string; href?: string; testid?: string }) => {
  const body = <><p className="text-xs text-muted-foreground">{label}</p><p className={`text-lg font-semibold tabular-nums ${tone}`}>{value}</p></>;
  return href ? <Link href={href} className="min-w-0 rounded-xl border p-2.5 hover:bg-accent" data-testid={testid}>{body}</Link> : <div className="min-w-0 rounded-xl border p-2.5" data-testid={testid}>{body}</div>;
};

export async function AiCentrePanel({ d, locale }: { d: NonNullable<AdminExtras["ai"]>; locale: string }) {
  const t = await tr();
  return (
    <Card className="motion-rise h-full" data-testid="extra-ai">
      <Head title={t("aiTitle")} href="/admin/ai" link={t("open")} icon={Sparkles} />
      <CardContent className="space-y-3">
        <div className="grid grid-cols-3 gap-2">
          <Stat label={t("suggestions")} value={String(d.open)} href="/admin/ai/recommendations" />
          <Stat label={t("important")} value={String(d.important)} tone={d.important ? "text-amber-600" : ""} href="/admin/ai/recommendations" />
          <Stat label={t("alerts")} value={String(d.alerts)} tone={d.alerts ? "text-destructive" : ""} href="/admin/ai" />
        </div>
        <Link href="/admin/ai/recommendations?area=ROUTES" className="flex items-center gap-2 rounded-xl border p-2.5 text-sm hover:bg-accent" data-testid="extra-ai-routes">
          <RouteIcon className="size-4 shrink-0 text-primary" aria-hidden />
          <span className="min-w-0 flex-1">{t("routesWaiting", { n: d.routeCount })}</span>
          <span className="text-right text-xs tabular-nums text-muted-foreground">{num(d.routes.km, locale)} km · {formatMoney(d.routes.cost, locale)} · {num(d.routes.co2, locale)} kg CO₂</span>
        </Link>
        {d.top.length ? (
          <ul className="space-y-1 text-sm" data-testid="extra-ai-top">
            {d.top.map((r) => <li key={r.id} className="flex gap-2"><span className="w-8 shrink-0 text-right tabular-nums text-muted-foreground">{r.score}</span><Link href={`/admin/ai/recommendations?area=${r.area}`} className="min-w-0 break-words hover:underline">{r.title}</Link></li>)}
          </ul>
        ) : <p className="text-sm text-muted-foreground">{t("allClear")}</p>}
      </CardContent>
    </Card>
  );
}

export async function ConsignmentPanel({ d, locale }: { d: NonNullable<AdminExtras["consignment"]>; locale: string }) {
  const t = await tr();
  return (
    <Card className="motion-rise h-full" data-testid="extra-consignment">
      <Head title={t("consignmentTitle")} href="/admin/vendors/consignment" link={t("open")} icon={Boxes} />
      <CardContent>
        <div className="grid grid-cols-2 gap-2">
          <Stat label={t("activeSites")} value={String(d.active)} href="/admin/vendors/consignment" />
          <Stat label={t("pendingApproval")} value={String(d.pending)} tone={d.pending ? "text-amber-600" : ""} href="/admin/vendors/consignment" testid="extra-consignment-pending" />
          <Stat label={t("stockAtCost")} value={formatMoney(d.value, locale)} />
          <Stat label={t("countsToConfirm")} value={`${d.toConfirm}${d.disputes ? ` · ${t("disputes", { n: d.disputes })}` : ""}`} tone={d.disputes ? "text-destructive" : ""} />
        </div>
      </CardContent>
    </Card>
  );
}

export async function SavingsPanel({ d, locale }: { d: NonNullable<AdminExtras["savings"]>; locale: string }) {
  const t = await tr();
  const m = d.month;
  return (
    <Card className="motion-rise h-full" data-testid="extra-savings">
      <Head title={t("savingsTitle")} href="/admin/ai/recommendations?area=ROUTES" link={t("routes")} icon={Leaf} />
      <CardContent className="space-y-2">
        <div className="grid grid-cols-2 gap-2">
          <Stat label={t("kmSaved")} value={`${num(m.km, locale)} km`} testid="extra-savings-km" />
          <Stat label={t("co2Avoided")} value={`${num(m.co2, locale)} kg`} tone={m.co2 ? "delta-pos" : ""} />
          <Stat label={m.kwh && !m.litres ? t("energySaved") : t("fuelSaved")} value={m.kwh && !m.litres ? `${num(m.kwh, locale)} kWh` : `${num(m.litres, locale)} L${m.kwh ? ` · ${num(m.kwh, locale)} kWh` : ""}`} />
          <Stat label={t("costSaved")} value={formatMoney(m.cost, locale)} />
        </div>
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground"><Fuel className="size-3.5" aria-hidden /> {t("savingsHint", { n: d.changes })}{d.waiting.km > 0 ? ` ${t("stillWaiting", { km: num(d.waiting.km, locale), co2: num(d.waiting.co2, locale) })}` : ""}</p>
      </CardContent>
    </Card>
  );
}
