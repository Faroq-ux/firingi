import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { Siren } from "lucide-react";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { myRecallNotices } from "@/server/warehouse/recalls";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export const metadata = { title: "Product recalls" };

export default async function MyRecalls() {
  const ctx = await pagePortal("buy");
  pagePermission(ctx, ["buyer.orders.view", "buyer.orders.place"]);
  const [t, locale] = await Promise.all([getTranslations("warehouse"), getLocale()]);
  const rows = await myRecallNotices(ctx, locale);
  const date = new Intl.DateTimeFormat(locale, { day: "2-digit", month: "short", year: "numeric" });
  return (
    <>
      <PageHeader title={t("noticesTitle")} description={t("noticesIntro")} />
      {rows.length === 0 ? <Card><CardContent className="py-10 text-center text-sm text-muted-foreground">{t("noNotices")}</CardContent></Card> : (
        <ul className="grid gap-3 lg:grid-cols-2" data-testid="recall-notices">
          {rows.map((r) => {
            const todo = r.status !== "DONE" && r.recallStatus === "OPEN";
            return (
              <li key={r.id}>
                <Link href={`/buy/orders/recalls/${r.id}`} className={cn("block rounded-2xl border p-4 transition hover:bg-accent/40", todo && "border-destructive/50 bg-destructive/5")} data-testid="recall-notice">
                  <div className="flex flex-wrap items-center gap-2">
                    <Siren className={cn("size-5", todo ? "text-destructive" : "text-muted-foreground")} />
                    <span className="font-mono text-sm font-semibold">{r.number}</span>
                    <Badge variant={r.recallClass === "CLASS_I" ? "destructive" : "outline"}>{t(`class.${r.recallClass}`)}</Badge>
                    <Badge variant={r.status === "DONE" ? "default" : r.status === "ACKNOWLEDGED" ? "secondary" : "destructive"} className="ml-auto">{t(`notice.${r.status}`)}</Badge>
                  </div>
                  <p className="mt-2 font-semibold">{r.product} <span className="font-normal text-muted-foreground">· {r.packaging}</span></p>
                  <p className="text-sm">{t("lot")}: <span className="font-mono">{r.lotCode ?? "—"}</span> · {t("youReceivedN", { count: r.qty })}</p>
                  <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{r.reason}</p>
                  <p className="mt-2 text-xs text-muted-foreground">{date.format(r.notifiedAt)}</p>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
