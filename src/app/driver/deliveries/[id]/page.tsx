import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { deliveryForViewer } from "@/server/services/deliveries";
import { FAILURE_REASONS } from "@/server/delivery/state";
import { NotFoundError } from "@/server/errors";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DeliveryEvidence } from "@/components/delivery/delivery-views";
import { DriverDeliveryCard, DriverItems } from "@/components/delivery/driver-views";
import { CompleteDeliveryForm, FailDeliveryForm } from "@/components/delivery/delivery-forms";
import { OrderChatPanel } from "@/components/chat/order-chat-panel";
import { deliveryEmpties } from "@/server/returnables/service";
import { rtLabels } from "@/components/returnables/labels";
import { stopWeights } from "@/server/catchweight/service";
import { cwLabels } from "@/components/catchweight/labels";
import { stopClasses } from "@/server/coldchain/service";
import { ccLabels } from "@/components/coldchain/labels";
import { RecordTempsForm } from "@/components/coldchain/client";

export const metadata = { title: "Delivery" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await pagePortal("driver");
  pagePermission(ctx, "driver.deliveries.view");
  const view = await deliveryForViewer(ctx, (await params).id).catch((e) => { if (e instanceof NotFoundError) notFound(); throw e; });
  if (view.role !== "DRIVER") notFound();
  const { delivery: d, driverActions } = view;
  const t = await getTranslations("delivery");
  // Phase 40: empties the driver can take back here (what the customer holds from this supplier + refills on the order)
  const rl = driverActions.includes("DELIVER") ? await rtLabels() : null;
  const empties = rl ? await deliveryEmpties(ctx, d.id, rl.locale) : [];
  // Phase 41: products sold by weight — the driver can weigh again and note that the customer accepts extra weight
  const cl = driverActions.includes("DELIVER") ? await cwLabels() : null;
  const weights = cl ? await stopWeights(d.order.id, cl.locale) : null;
  // Phase 42: chilled / frozen products — temperature at loading and at the handover
  const open = !["DELIVERED", "FAILED", "CANCELLED", "RETURNED"].includes(d.status);
  const cc = open ? await ccLabels() : null;
  const cold = cc ? await stopClasses(d.order.id, cc.locale) : null;
  return (
    <div className="mx-auto max-w-xl space-y-4">
      <Link href="/driver/deliveries/today" className="text-sm text-primary hover:underline">← {t("back")}</Link>
      <DriverDeliveryCard d={d} withActions={!driverActions.includes("DELIVER")} />
      <Card><CardHeader><CardTitle>{t("products")}</CardTitle></CardHeader><CardContent><DriverItems d={d} /></CardContent></Card>
      {cold && cc && cold.record.loading && cold.classes.length > 0 && <RecordTempsForm l={cc.l} mode="LOADING" targetId={d.id} classes={cold.classes} />}
      {driverActions.includes("DELIVER") && (
        <Card><CardHeader><CardTitle>{t("proof")}</CardTitle></CardHeader><CardContent><CompleteDeliveryForm deliveryId={d.id} empties={empties} emptiesLabels={rl?.l} weights={weights?.lines.length ? weights : undefined} weightLabels={cl?.l} locale={cl?.locale} cold={cold && cold.record.handover && cold.classes.length ? cold : undefined} coldLabels={cc?.l} /></CardContent></Card>
      )}
      {driverActions.includes("FAIL") && <FailDeliveryForm deliveryId={d.id} reasons={[...FAILURE_REASONS]} />}
      <div className="space-y-3 text-sm"><DeliveryEvidence d={d} /></div>
      <OrderChatPanel ctx={ctx} orderId={d.orderId} portal="driver" />
    </div>
  );
}
