/** Marketplace / order / vendor / customer settings pages (one settings row, four views). */
import Link from "next/link";
import type { Ctx } from "@/server/context";
import { can } from "@/server/rbac/guard";
import { offerApprovalSetting, platformSettings } from "@/server/services/platform-settings";
import { paymentPolicy } from "@/server/services/payments";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { PlatformSettingsForm, type SettingField } from "./security-admin-forms";

export type SettingsPage = "marketplace" | "orders" | "vendors" | "customers";

const PAGES: Record<SettingsPage, { title: string; description: string; fields: SettingField[] }> = {
  marketplace: {
    title: "Marketplace Settings",
    description: "Contact details shown to users and a notice for every portal (e.g. planned maintenance).",
    fields: [
      { path: "supportEmail", label: "Support e-mail", kind: "text" },
      { path: "supportPhone", label: "Support phone", kind: "text" },
      { path: "notice", label: "Notice on every portal", help: "Shown at the top of all pages to everyone signed in. Empty = none.", kind: "textarea" },
      { path: "registrations.DRIVER", label: "Accept new driver applications", kind: "bool" },
    ],
  },
  orders: {
    title: "Order Settings",
    description: "Rules for buyers' orders. Delivery minimums and fees: Delivery Settings; supplier choice: Allocation.",
    fields: [
      { path: "buyerCanCancel", label: "Buyers may cancel until the supplier confirms", help: "Off: only FIRINGI cancels orders.", kind: "bool" },
      { path: "maxRequestedDays", label: "Furthest requested delivery date", kind: "number", min: 1, max: 180, suffix: "days ahead" },
    ],
  },
  vendors: {
    title: "Vendor Settings",
    description: "Onboarding and catalogue rules for wholesalers and distributors. Commission: Pricing & Commercial; allocation preferences: Vendor Priority.",
    fields: [
      { path: "registrations.WHOLESALER", label: "Accept new wholesaler applications", kind: "bool" },
      { path: "registrations.DISTRIBUTOR", label: "Accept new distributor applications", kind: "bool" },
      { path: "offerApprovalRequired", label: "New offers need FIRINGI approval", help: "New products always need approval; this also holds offers on already-approved products.", kind: "bool" },
    ],
  },
  customers: {
    title: "Customer Settings",
    description: "Onboarding for wholesale customers. How they order is set per country (International › Countries).",
    fields: [{ path: "registrations.CUSTOMER", label: "Accept new customer applications", kind: "bool" }],
  },
};

export async function PlatformSettingsPage({ ctx, page }: { ctx: Ctx; page: SettingsPage }) {
  const [s, offerApproval, pay] = await Promise.all([platformSettings(), offerApprovalSetting(), paymentPolicy()]);
  const def = PAGES[page];
  const values: Record<string, string | number | boolean | null> = {};
  for (const f of def.fields) {
    if (f.path === "offerApprovalRequired") { values[f.path] = offerApproval; continue; }
    const [a, b] = f.path.split(".");
    const v = (s as unknown as Record<string, unknown>)[a];
    values[f.path] = (b ? (v as Record<string, boolean>)[b] : v) as string | number | boolean | null;
  }
  return (
    <>
      <PageHeader title={def.title} description={def.description} />
      <Card className="max-w-3xl"><CardContent className="pt-5"><PlatformSettingsForm fields={def.fields} values={values} canEdit={can(ctx, "admin.settings.manage")} /></CardContent></Card>
      {page === "customers" && (
        <p className="mt-4 max-w-3xl text-sm text-muted-foreground">
          New customers pay within {pay.defaultTermsDays.CUSTOMER} days{pay.defaultCreditLimit.CUSTOMER !== null ? ` with a ${pay.defaultCreditLimit.CUSTOMER} € credit limit` : ""} — change it in <Link className="text-primary hover:underline" href="/admin/settings/payment">Payment Settings</Link>; per customer in <Link className="text-primary hover:underline" href="/admin/risk/payment-risk">Payment Risk</Link>.
        </p>
      )}
    </>
  );
}
