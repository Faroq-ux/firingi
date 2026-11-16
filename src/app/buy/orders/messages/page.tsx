import { getTranslations } from "next-intl/server";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { ChatInbox } from "@/components/chat/chat-inbox";

export const metadata = { title: "Messages" };

export default async function Page() {
  const ctx = await pagePortal("buy");
  pagePermission(ctx, ["buyer.orders.view", "buyer.orders.place"]);
  const t = await getTranslations("chat");
  return (
    <>
      <PageHeader title={t("inboxTitle")} description={t("inboxIntro")} />
      <Card><CardContent className="pt-4"><ChatInbox ctx={ctx} portal="buy" /></CardContent></Card>
    </>
  );
}
