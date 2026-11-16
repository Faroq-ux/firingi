import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { Card, CardContent } from "@/components/ui/card";
import { ChatInbox } from "@/components/chat/chat-inbox";

export const metadata = { title: "Messages" };

export default async function Page() {
  const ctx = await pagePortal("driver");
  pagePermission(ctx, "driver.deliveries.view");
  const [t, td] = await Promise.all([getTranslations("chat"), getTranslations("delivery")]);
  return (
    <div className="mx-auto max-w-xl space-y-4">
      <Link href="/driver/deliveries/today" className="text-sm text-primary hover:underline">← {td("back")}</Link>
      <h1 className="text-2xl font-semibold">{t("inboxTitle")}</h1>
      <Card><CardContent className="pt-4"><ChatInbox ctx={ctx} portal="driver" /></CardContent></Card>
    </div>
  );
}
