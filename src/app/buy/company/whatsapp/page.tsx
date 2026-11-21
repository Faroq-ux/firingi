import Link from "next/link";
import { MessageCircle } from "lucide-react";
import { getLocale, getTranslations } from "next-intl/server";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { myWhatsApp } from "@/server/whatsapp/ordering";
import { mySmallOrders } from "@/server/orders/small-orders";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { MyWhatsAppForm } from "@/components/whatsapp/mine";
import { formatDate, formatMoney } from "@/lib/utils";

export const metadata = { title: "WhatsApp" };
export const dynamic = "force-dynamic";

export default async function MyWhatsAppPage() {
  const ctx = await pagePortal("buy");
  pagePermission(ctx, ["buyer.orders.view", "buyer.orders.place", "company.profile.manage"]);
  const [d, small, t, to, locale] = await Promise.all([myWhatsApp(ctx), mySmallOrders(ctx), getTranslations("waOrder"), getTranslations("orders"), getLocale()]);
  const st = (s: string) => (to.has(`statuses.${s}`) ? to(`statuses.${s}`) : s);
  return (
    <>
      <PageHeader title={t("title")} icon={MessageCircle} description={t("intro")} />
      {!d.available ? (
        <Card><CardContent className="py-8 text-center text-sm text-muted-foreground" data-testid="wa-unavailable">{t("notAvailable")}</CardContent></Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader><CardTitle>{t("firingiNumber")}</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              {d.firingiNumber ? (
                <div className="flex flex-wrap items-center gap-3">
                  <span className="text-lg font-semibold tabular-nums" data-testid="wa-firingi">{d.firingiNumber}</span>
                  <a className={buttonVariants({ size: "sm" })} href={`https://wa.me/${d.firingiNumber.replace(/\D/g, "")}`} target="_blank" rel="noopener noreferrer">{t("openChat")}</a>
                </div>
              ) : <p className="text-sm text-muted-foreground">{t("noFiringiNumber")}</p>}
              <div className="border-t pt-3">
                <p className="text-sm font-medium">{t("myNumber")}</p>
                {d.myNumber ? <><p className="tabular-nums" data-testid="wa-mine">{d.myNumber}</p><p className="text-xs text-muted-foreground">{t("myNumberHint")}</p></> : <p className="text-sm text-warning-foreground" data-testid="wa-no-number">{t("noMyNumber")}</p>}
                <Link href="/buy/company/profile" className="mt-1 inline-block text-sm text-primary hover:underline">{t("editProfile")}</Link>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>{t("howTitle")}</CardTitle></CardHeader>
            <CardContent>
              <ol className="list-decimal space-y-1.5 pl-5 text-sm">
                <li>{t("how1")}</li><li>{t("how2")}</li><li>{t("how3")}</li>
              </ol>
              <ul className="mt-3 space-y-1 text-xs text-muted-foreground">
                {d.voice && <li>🎤 {t("howVoice")}</li>}
                {d.photos && <li>📷 {t("howPhotos")}</li>}
              </ul>
              {small.limit != null && (
                <div className="mt-4 rounded-md bg-muted p-3 text-sm" data-testid="wa-small">
                  <p className="font-medium">{t("small.title")}</p>
                  <p>{small.left ? t("small.left", { left: small.left, limit: small.limit }) : t("small.none")}</p>
                  <p className="text-xs text-muted-foreground">{t("small.hint")}</p>
                </div>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>{t("settingsTitle")}</CardTitle></CardHeader>
            <CardContent>
              <MyWhatsAppForm initial={{ orderUpdates: d.orderUpdates, reminders: d.reminders }} canEdit={d.canEdit} hasNumber={!!d.myNumber} remindersOn={d.remindersOn}
                labels={{ orderUpdates: t("orderUpdates"), orderUpdatesHint: t("orderUpdatesHint"), reminders: t("reminders"), remindersHint: t("remindersHint"), save: t("save"), saved: t("saved") }} />
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>{t("recentTitle")}</CardTitle></CardHeader>
            <CardContent>
              {d.orders.length === 0 ? <p className="text-sm text-muted-foreground">{t("noOrders")}</p> : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm" data-testid="wa-my-orders">
                    <thead><tr className="text-left text-xs text-muted-foreground"><th className="py-1">{t("order")}</th><th>{t("date")}</th><th>{t("status")}</th><th className="text-right">{t("total")}</th></tr></thead>
                    <tbody>
                      {d.orders.map((o) => (
                        <tr key={o.id} className="border-t">
                          <td className="py-1.5"><Link href={`/buy/orders/${o.id}`} className="text-primary hover:underline">{o.number}</Link></td>
                          <td>{formatDate(o.at, locale)}</td>
                          <td>{st(o.status)}</td>
                          <td className="text-right tabular-nums">{formatMoney(o.total, locale)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </>
  );
}
