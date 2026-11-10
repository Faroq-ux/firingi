/** "My notifications" and "Notification settings" pages, shared by every portal. */
import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import type { Ctx } from "@/server/context";
import { myNotifications, myPreferences } from "@/server/services/notifications";
import { enabledChannels } from "@/server/notify/dispatch";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDate } from "@/lib/utils";
import { MarkAllRead, PreferencesForm, PushToggle } from "./preferences-form";

export async function MyNotifications({ ctx, base }: { ctx: Ctx; base: string }) {
  const [rows, t, locale] = await Promise.all([myNotifications(ctx, { take: 100 }), getTranslations("notifications"), getLocale()]);
  return (
    <>
      <PageHeader title={t("title")} actions={<><MarkAllRead /><Link href={`${base}/me/notification-settings`} className="inline-flex h-8 items-center rounded-md border px-3 text-xs hover:bg-accent">{t("preferences")}</Link></>} />
      <Card><CardContent className="divide-y p-0">
        {rows.length === 0 && <p className="p-8 text-center text-sm text-muted-foreground">{t("empty")}</p>}
        {rows.map((n) => (
          <div key={n.id} className={`flex items-start gap-3 px-4 py-3 text-sm ${n.readAt ? "text-muted-foreground" : ""}`}>
            <span className={`mt-1.5 size-2 shrink-0 rounded-full ${n.readAt ? "bg-transparent" : "bg-primary"}`} />
            <div className="min-w-0 flex-1">
              <div className={n.readAt ? "" : "font-medium"}>{n.title}</div>
              {n.body && <div className="text-xs">{n.body}</div>}
              <div className="mt-0.5 text-xs text-muted-foreground">{formatDate(n.createdAt, locale, true)}</div>
            </div>
            {n.link && (n.link.startsWith("/api/") ? <a href={n.link} className="shrink-0 text-xs text-primary hover:underline">{t("open")}</a> : <Link href={n.link} className="shrink-0 text-xs text-primary hover:underline">{t("open")}</Link>)}
          </div>
        ))}
      </CardContent></Card>
    </>
  );
}

export async function NotificationSettings({ ctx }: { ctx: Ctx }) {
  const [p, enabled, t] = await Promise.all([myPreferences(ctx), enabledChannels(), getTranslations("notifications")]);
  return (
    <>
      <PageHeader title={t("preferences")} description={t("preferencesIntro")} />
      <Card className="mb-4"><CardContent className="pt-5">
        <PreferencesForm categories={p.categories} phone={p.phone} smsConsent={p.smsConsent} whatsappConsent={p.whatsappConsent} smsAvailable={enabled.has("SMS")} whatsappAvailable={enabled.has("WHATSAPP")} />
      </CardContent></Card>
      {enabled.has("PUSH") && <Card><CardHeader><CardTitle>{t("push")}</CardTitle></CardHeader><CardContent><PushToggle vapidPublicKey={p.vapidPublicKey} /></CardContent></Card>}
    </>
  );
}
