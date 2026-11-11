import Link from "next/link";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { getTransfer } from "@/server/inventory/warehouse";
import { offerLabel } from "@/server/inventory/options";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { TransferActions } from "@/components/inventory/controls";

export const metadata = { title: "Transfer" };

export default async function TransferPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await pagePortal("vendor");
  pagePermission(ctx, ["vendor.inventory.view", "vendor.inventory.manage"]);
  const { id } = await params;
  const [t, locale] = await Promise.all([getTranslations("inventory"), getLocale()]);
  const tr = await getTransfer(ctx, id).catch(() => null);
  if (!tr) notFound();
  const lines = tr.lines.map((l) => ({ ...l, label: offerLabel(l.product, l.packaging, l.sku, locale) }));
  return (
    <>
      <PageHeader title={tr.number} description={`${tr.from.label} → ${tr.to.label}`}
        actions={<><Badge variant={tr.status === "RECEIVED" ? "success" : tr.status === "IN_TRANSIT" ? "warning" : "secondary"} data-testid="transfer-status">{t(`transfer.${tr.status}`)}</Badge><Link className={buttonVariants({ variant: "ghost", size: "sm" })} href="/vendor/inventory/transfers">← {t("transfers")}</Link></>} />
      <Table smart={false}>
        <THead><TR><TH>{t("product")}</TH><TH>{t("batches")}</TH><TH className="text-right">{t("qty")}</TH><TH className="text-right">{t("received")}</TH></TR></THead>
        <TBody>
          {lines.map((l) => (
            <TR key={l.id}><TD>{l.label}</TD><TD className="text-xs text-muted-foreground">{l.picks.map((p) => `${p.lotCode ?? t("noLot")}${p.expiresOn ? ` (${String(p.expiresOn).slice(0, 10)})` : ""} × ${p.qty}`).join(", ")}</TD><TD className="text-right tabular-nums">{l.qty}</TD><TD className="text-right tabular-nums">{l.receivedQty ?? ""}</TD></TR>
          ))}
        </TBody>
      </Table>
      <div className="mt-4"><TransferActions id={tr.id} canSend={tr.canSend} canReceive={tr.canReceive} canCancel={tr.canCancel} lines={lines.map((l) => ({ id: l.id, label: l.label, qty: l.qty }))} /></div>
    </>
  );
}
