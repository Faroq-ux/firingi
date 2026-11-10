import { pagePermission, pagePortal, can } from "@/server/rbac/guard";
import { NEEDS_PROVIDER, paymentPolicy } from "@/server/services/payments";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { PaymentPolicyForm } from "@/components/admin/security-admin-forms";

export const metadata = { title: "Payment Settings" };

export default async function Page() {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.settings.view", "admin.settings.manage", "admin.finance.manage"]);
  const policy = await paymentPolicy();
  return (
    <>
      <PageHeader title="Payment Settings" description="How buyers pay FIRINGI, payment terms and credit control. Payments are recorded in Finance › Customer Payments; the IBAN comes from Invoice Settings (legal entity)." />
      <Card className="max-w-3xl"><CardContent className="pt-5"><PaymentPolicyForm policy={policy} needsProvider={NEEDS_PROVIDER} canEdit={can(ctx, ["admin.settings.manage", "admin.finance.manage"])} /></CardContent></Card>
    </>
  );
}
