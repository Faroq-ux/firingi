/**
 * System role templates (seeded, read-only). Companies can also create custom roles
 * from the permissions their company type may grant.
 */
import type { CompanyType } from "@prisma/client";
import { ALL_PERMISSION_CODES, PERMISSIONS, type PermissionCode } from "./permissions";

export type SystemRoleDef = {
  key: string;
  name: string;
  description: string;
  appliesTo: CompanyType[];
  /** "ALL_<AUDIENCE>" grants every permission of that audience, so new permissions are included automatically. */
  permissions: (PermissionCode | "ALL_ADMIN" | "ALL_VENDOR" | "ALL_BUYER" | "ALL_COMPANY")[];
};

const VENDOR_TYPES: CompanyType[] = ["DISTRIBUTOR", "WHOLESALER"];
const BUYER_TYPES: CompanyType[] = ["CUSTOMER", "WHOLESALER"];
const COMPANY_TYPES: CompanyType[] = ["DISTRIBUTOR", "WHOLESALER", "CUSTOMER"];

export const SYSTEM_ROLES: SystemRoleDef[] = [
  // ── FIRINGI admin roles ──
  { key: "SUPER_ADMIN", name: "Super Admin", description: "Full access to the back office", appliesTo: ["ADMIN"], permissions: ["ALL_ADMIN"] },
  {
    key: "OPERATIONS", name: "Operations", description: "Orders, vendors, catalogue, delivery and fleet", appliesTo: ["ADMIN"],
    permissions: [
      "admin.dashboard.view", "admin.orders.view", "admin.orders.manage", "admin.vendors.view", "admin.vendors.approve",
      "admin.customers.view", "admin.customers.approve", "admin.catalogue.view", "admin.catalogue.manage", "admin.catalogue.approve",
      "admin.allocation.manage", "admin.delivery.view", "admin.delivery.manage", "admin.fleet.view", "admin.fleet.manage",
      "admin.risk.view", "admin.international.view", "admin.notifications.view", "admin.messages.manage",
    ],
  },
  {
    key: "FINANCE", name: "Finance", description: "Finance, invoices, tax, commission", appliesTo: ["ADMIN"],
    permissions: [
      "admin.dashboard.view", "admin.orders.view", "admin.vendors.view", "admin.vendors.commission", "admin.customers.view",
      "admin.customers.manage", "admin.pricing.view", "admin.finance.view", "admin.finance.manage", "admin.invoices.view",
      "admin.invoices.issue", "admin.tax.manage", "admin.analytics.view", "admin.international.view", "admin.audit.view",
    ],
  },
  {
    key: "SALES", name: "Sales", description: "Customers, CRM, pricing and marketing", appliesTo: ["ADMIN"],
    permissions: [
      "admin.dashboard.view", "admin.orders.view", "admin.vendors.view", "admin.customers.view", "admin.customers.manage",
      "admin.catalogue.view", "admin.pricing.view", "admin.pricing.manage", "admin.crm.view", "admin.crm.manage",
      "admin.marketing.view", "admin.marketing.manage", "admin.analytics.view",
    ],
  },
  {
    key: "SUPPORT", name: "Support", description: "Read access to help customers and vendors", appliesTo: ["ADMIN"],
    permissions: [
      "admin.dashboard.view", "admin.orders.view", "admin.vendors.view", "admin.customers.view", "admin.catalogue.view",
      "admin.delivery.view", "admin.notifications.view", "admin.messages.manage", "admin.crm.view",
    ],
  },
  {
    key: "REGIONAL_MANAGER", name: "Regional Manager", description: "Operations limited to assigned country / region", appliesTo: ["ADMIN"],
    permissions: [
      "admin.dashboard.view", "admin.orders.view", "admin.orders.manage", "admin.vendors.view", "admin.vendors.approve",
      "admin.customers.view", "admin.customers.approve", "admin.delivery.view", "admin.fleet.view", "admin.analytics.view",
      "admin.crm.view", "admin.crm.manage",
    ],
  },
  { key: "ADMIN_DRIVER", name: "FIRINGI Driver", description: "Driver in the FIRINGI fleet", appliesTo: ["ADMIN"], permissions: ["driver.deliveries.view", "driver.deliveries.update", "driver.pod.capture"] },

  // ── Company templates (vendors / buyers) ──
  {
    key: "COMPANY_ADMIN", name: "Company Administrator", description: "Everything the company is allowed to do", appliesTo: COMPANY_TYPES,
    permissions: ["ALL_VENDOR", "ALL_BUYER", "ALL_COMPANY"],
  },
  {
    key: "VENDOR_SALES", name: "Sales Manager", description: "Products, pricing, promotions and orders", appliesTo: VENDOR_TYPES,
    permissions: [
      "vendor.dashboard.view", "vendor.products.view", "vendor.products.manage", "vendor.pricing.manage",
      "vendor.promotions.manage", "vendor.orders.view", "vendor.orders.manage", "vendor.reports.view",
    ],
  },
  {
    key: "VENDOR_WAREHOUSE", name: "Warehouse", description: "Stock and order preparation", appliesTo: VENDOR_TYPES,
    permissions: ["vendor.dashboard.view", "vendor.products.view", "vendor.stock.manage", "vendor.orders.view", "vendor.orders.manage"],
  },
  {
    key: "VENDOR_FLEET", name: "Fleet Manager", description: "Drivers, vehicles and service areas", appliesTo: VENDOR_TYPES,
    permissions: ["vendor.dashboard.view", "vendor.orders.view", "vendor.fleet.view", "vendor.drivers.manage", "vendor.vehicles.manage", "vendor.service_areas.manage"],
  },
  {
    key: "VENDOR_ACCOUNTANT", name: "Accountant (sales)", description: "Billing statements, invoices to FIRINGI, payments", appliesTo: VENDOR_TYPES,
    permissions: ["vendor.dashboard.view", "vendor.orders.view", "vendor.invoices.view", "vendor.invoices.submit", "vendor.payments.view", "vendor.reports.view"],
  },
  {
    key: "BUYER_PURCHASER", name: "Purchaser", description: "Browse, order and track orders", appliesTo: BUYER_TYPES,
    permissions: ["buyer.dashboard.view", "buyer.catalogue.view", "buyer.orders.place", "buyer.orders.view", "buyer.addresses.manage", "buyer.reports.view"],
  },
  {
    key: "BUYER_ACCOUNTANT", name: "Accountant (purchases)", description: "Invoices and payments", appliesTo: BUYER_TYPES,
    permissions: ["buyer.dashboard.view", "buyer.orders.view", "buyer.invoices.view", "buyer.payments.view", "buyer.reports.view"],
  },
  { key: "VENDOR_DRIVER", name: "Driver", description: "Driver in the company's own fleet", appliesTo: VENDOR_TYPES, permissions: ["driver.deliveries.view", "driver.deliveries.update", "driver.pod.capture"] },
];

/** Expand ALL_* shortcuts into concrete permission codes. */
export function expandRolePermissions(def: SystemRoleDef): PermissionCode[] {
  const out = new Set<PermissionCode>();
  for (const p of def.permissions) {
    if (p.startsWith("ALL_")) {
      const audience = p.slice(4);
      ALL_PERMISSION_CODES.filter((c) => PERMISSIONS[c].audience === audience).forEach((c) => out.add(c));
    } else out.add(p as PermissionCode);
  }
  return [...out];
}
