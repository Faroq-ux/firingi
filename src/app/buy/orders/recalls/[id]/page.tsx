import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { Siren } from "lucide-react";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { myRecallNotice } from "@/server/warehouse/recalls";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { RecallNoticeActions } from "@/components/warehouse/controls";

export const metadata = { title: "Product recall" };

export default async function MyRecall({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await pagePortal("buy");
  pagePermission(ctx, ["buyer.orders.view", "buyer.orders.place"]);
  const [t, locale] = await Promise.all([getTranslations("warehouse"), getLocale()]);
  const r = await myRecallNotice(ctx, (await params).id, locale);
  const date = new Intl.DateTimeFormat(locale, { day: "2-digit", month: "short", year: "numeric" });
  return (
    <>
      <PageHeader title={`${t("noticeTitle")} ${r.number}`} description={`${r.product} · ${t("lot")} ${r.lotCode ?? "—"}`} />
      <Card className="mb-6 border-destructive/50 bg-destructive/5" data-testid="recall-notice-detail">
        <CardContent className="space-y-2 pt-6 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <Siren className="size-5 text-destructive" />
            <Badge variant={r.recallClass === "CLASS_I" ? "destructive" : "outline"}>{t(`class.${r.recallClass}`)}</Badge>
            <Badge variant="outline">{t(`notice.${r.status}`)}</Badge>
            {r.recallStatus === "CLOSED" && <Badge variant="secondary">{t("recallStatus.CLOSED")}</Badge>}
          </div>
          <p className="text-lg font-semibold">{r.product} <span className="font-normal text-muted-foreground">· {r.packaging}</span></p>
          <p>{t("lot")}: <span className="font-mono font-semibold">{r.lotCode ?? "—"}</span>{r.expiresOn ? ` · ${t("bestBefore")}: ${date.format(r.expiresOn)}` : ""}</p>
          <p><span className="text-muted-foreground">{t("reason")}:</span> {r.reason}</p>
          <p className="rounded-lg border border-destructive/30 bg-card/70 p-3 font-medium">{r.instructions ?? t("defaultInstructions")}</p>
          <p>{t("youReceivedN", { count: r.qty })} · {r.orders.map((o, i) => <span key={o.id}>{i ? ", " : ""}<Link className="font-mono hover:underline" href={`/buy/orders/${o.id}`}>{o.number}</Link></span>)}</p>
          <p className="text-xs text-muted-foreground">{t("toldOn", { date: date.format(r.notifiedAt) })}</p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>{r.status === "DONE" ? t("reported") : t("whatYouDid")}</CardTitle></CardHeader>
        <CardContent>
          {r.status === "DONE" && <p className="mb-4 text-sm">{r.noneLeft && !r.returnedQty && !r.destroyedQty ? t("noneLeft") : t("returnedDestroyedYou", { returned: r.returnedQty, destroyed: r.destroyedQty })}</p>}
          <RecallNoticeActions id={r.id} status={r.status} qty={r.qty} returnedQty={r.returnedQty} destroyedQty={r.destroyedQty} noneLeft={r.noneLeft} note={r.note} open={r.recallStatus === "OPEN"} />
        </CardContent>
      </Card>
    </>
  );
}
