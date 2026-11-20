/**
 * FIRINGI permission catalogue — the single source of truth.
 * The seed syncs this list into the `Permission` table; code always references the
 * `P` constants (never raw strings) so a typo is a compile error.
 *
 * Audiences:
 *   ADMIN   – FIRINGI back office
 *   VENDOR  – sell portal (distributors, wholesalers)
 *   BUYER   – buy portal (customers, wholesalers buying from distributors)
 *   COMPANY – self-management of any non-admin company (team, profile, documents)
 *   DRIVER  – driver portal
 */
import type { CompanyType, PermissionAudience } from "@prisma/client";

type Def = { audience: PermissionAudience; module: string; description: string };

const defs = {
  // ── ADMIN ────────────────────────────────────────────────────────────────
  "admin.dashboard.view": { audience: "ADMIN", module: "Dashboard", description: "View admin dashboards" },
  "admin.orders.view": { audience: "ADMIN", module: "Orders", description: "View all orders" },
  "admin.orders.manage": { audience: "ADMIN", module: "Orders", description: "Change order status, split / re-allocate orders" },
  "admin.claims.manage": { audience: "ADMIN", module: "Orders", description: "Decide quality claims (credit, replacement, rejection), charge-backs and quality alerts" },
  "admin.vendors.view": { audience: "ADMIN", module: "Vendors", description: "View distributors and wholesalers" },
  "admin.vendors.approve": { audience: "ADMIN", module: "Vendors", description: "Review, approve, reject and suspend vendors" },
  "admin.vendors.commission": { audience: "ADMIN", module: "Vendors", description: "Set vendor commission rates" },
  "admin.customers.view": { audience: "ADMIN", module: "Customers", description: "View customers" },
  "admin.customers.approve": { audience: "ADMIN", module: "Customers", description: "Approve customers and restricted-product access" },
  "admin.customers.manage": { audience: "ADMIN", module: "Customers", description: "Manage customer groups, credit and limits" },
  "admin.catalogue.view": { audience: "ADMIN", module: "Catalogue", description: "View the catalogue" },
  "admin.catalogue.manage": { audience: "ADMIN", module: "Catalogue", description: "Manage categories, brands, products" },
  "admin.catalogue.approve": { audience: "ADMIN", module: "Catalogue", description: "Approve products and vendor offers" },
  "admin.allocation.manage": { audience: "ADMIN", module: "Allocation", description: "Allocation engine and overrides" },
  "admin.inventory.view": { audience: "ADMIN", module: "Inventory", description: "View stock, batches, expiry and valuation of all suppliers" },
  "admin.inventory.manage": { audience: "ADMIN", module: "Inventory", description: "Switch expiry features per supplier and decide supplier requests" },
  "admin.recalls.manage": { audience: "ADMIN", module: "Inventory", description: "Start and close product recalls for any supplier's lot" },
  "admin.delivery.view": { audience: "ADMIN", module: "Delivery", description: "View deliveries and logistics" },
  "admin.delivery.manage": { audience: "ADMIN", module: "Delivery", description: "Manage zones, rules, fees, assignments" },
  "admin.fleet.view": { audience: "ADMIN", module: "Fleet", description: "View all drivers and vehicles" },
  "admin.fleet.manage": { audience: "ADMIN", module: "Fleet", description: "Approve and manage drivers and vehicles" },
  "admin.pricing.view": { audience: "ADMIN", module: "Pricing", description: "View pricing and commercial rules" },
  "admin.pricing.manage": { audience: "ADMIN", module: "Pricing", description: "Manage promotions, commercial rules" },
  "admin.finance.view": { audience: "ADMIN", module: "Finance", description: "View finance" },
  "admin.finance.manage": { audience: "ADMIN", module: "Finance", description: "Record payments, refunds, approve vendor invoices" },
  "admin.invoices.view": { audience: "ADMIN", module: "Invoices", description: "View invoices and tax" },
  "admin.invoices.issue": { audience: "ADMIN", module: "Invoices", description: "Issue invoices and credit notes" },
  "admin.tax.manage": { audience: "ADMIN", module: "Invoices", description: "Manage tax rules and invoice settings" },
  "admin.analytics.view": { audience: "ADMIN", module: "Analytics", description: "View analytics and reports" },
  "admin.ai.view": { audience: "ADMIN", module: "AI Centre", description: "Use the AI Centre" },
  "admin.crm.view": { audience: "ADMIN", module: "CRM", description: "View CRM" },
  "admin.crm.manage": { audience: "ADMIN", module: "CRM", description: "Manage leads, accounts, pipeline" },
  "admin.support.manage": { audience: "ADMIN", module: "Customers", description: "Answer and manage customer and supplier support requests" },
  "admin.international.view": { audience: "ADMIN", module: "International", description: "View countries, currencies, tax" },
  "admin.international.manage": { audience: "ADMIN", module: "International", description: "Manage countries, currencies, tax" },
  "admin.marketing.view": { audience: "ADMIN", module: "Marketing", description: "View marketing" },
  "admin.marketing.manage": { audience: "ADMIN", module: "Marketing", description: "Manage campaigns, coupons" },
  "admin.risk.view": { audience: "ADMIN", module: "Risk", description: "View risk and compliance" },
  "admin.risk.manage": { audience: "ADMIN", module: "Risk", description: "Manage KYC/KYB, fraud cases" },
  "admin.audit.view": { audience: "ADMIN", module: "Risk", description: "View the audit trail" },
  "admin.users.view": { audience: "ADMIN", module: "Users", description: "View users" },
  "admin.users.manage": { audience: "ADMIN", module: "Users", description: "Create and manage admin users" },
  "admin.roles.manage": { audience: "ADMIN", module: "Users", description: "Manage roles and permissions" },
  "admin.notifications.view": { audience: "ADMIN", module: "Notifications", description: "View notifications" },
  "admin.notifications.manage": { audience: "ADMIN", module: "Notifications", description: "Manage templates and channels" },
  "admin.messages.manage": { audience: "ADMIN", module: "Notifications", description: "Reply to customer, vendor and driver messages" },
  "admin.settings.view": { audience: "ADMIN", module: "Settings", description: "View settings" },
  "admin.settings.manage": { audience: "ADMIN", module: "Settings", description: "Change platform settings" },
  "admin.reviews.moderate": { audience: "ADMIN", module: "Reviews", description: "Moderate product reviews and questions: held posts, reports, hide with a reason" },
  "admin.staff.manage": { audience: "ADMIN", module: "Staff & Time", description: "FIRINGI's own staff: rota, clock entries, timesheets, leave, payroll export" },

  // ── VENDOR (sell portal) ─────────────────────────────────────────────────
  "vendor.dashboard.view": { audience: "VENDOR", module: "Dashboard", description: "View the sales dashboard" },
  "vendor.products.view": { audience: "VENDOR", module: "Products", description: "View own products and offers" },
  "vendor.products.manage": { audience: "VENDOR", module: "Products", description: "Create and edit products and offers" },
  "vendor.reviews.manage": { audience: "VENDOR", module: "Reviews", description: "Reply to reviews, answer questions about own products, see review insights" },
  "vendor.stock.manage": { audience: "VENDOR", module: "Products", description: "Update stock levels" },
  "vendor.inventory.view": { audience: "VENDOR", module: "Inventory", description: "View stock, batches, expiry, movements and valuation" },
  "vendor.inventory.manage": { audience: "VENDOR", module: "Inventory", description: "Receive stock, counts, transfers, write-offs, reorder points" },
  "vendor.purchasing.manage": { audience: "VENDOR", module: "Inventory", description: "Suppliers and purchase orders" },
  "vendor.warehouse.pick": { audience: "VENDOR", module: "Inventory", description: "Pick & pack orders, scan, print labels and packing slips" },
  "vendor.recalls.manage": { audience: "VENDOR", module: "Inventory", description: "Recall own lots (blocks stock and tells every buyer)" },
  "vendor.pricing.manage": { audience: "VENDOR", module: "Pricing", description: "Manage price lists and customer pricing" },
  "vendor.promotions.manage": { audience: "VENDOR", module: "Pricing", description: "Manage own promotions" },
  "vendor.orders.view": { audience: "VENDOR", module: "Orders", description: "View incoming orders" },
  "vendor.orders.manage": { audience: "VENDOR", module: "Orders", description: "Confirm, prepare and dispatch orders" },
  "vendor.claims.respond": { audience: "VENDOR", module: "Orders", description: "Answer customers' quality claims, deliver replacements and dispute charge-backs" },
  "vendor.invoices.view": { audience: "VENDOR", module: "Finance", description: "View billing statements and own invoices" },
  "vendor.invoices.submit": { audience: "VENDOR", module: "Finance", description: "Upload invoices to FIRINGI" },
  "vendor.payments.view": { audience: "VENDOR", module: "Finance", description: "View payments from FIRINGI" },
  "vendor.fleet.view": { audience: "VENDOR", module: "Fleet", description: "View own drivers and vehicles" },
  "vendor.drivers.manage": { audience: "VENDOR", module: "Fleet", description: "Register and manage own drivers" },
  "vendor.vehicles.manage": { audience: "VENDOR", module: "Fleet", description: "Register and manage own vehicles" },
  "vendor.service_areas.manage": { audience: "VENDOR", module: "Delivery", description: "Manage service areas and delivery rules" },
  "vendor.reports.view": { audience: "VENDOR", module: "Reports", description: "View sales reports and export them" },

  // ── BUYER (buy portal) ───────────────────────────────────────────────────
  "buyer.dashboard.view": { audience: "BUYER", module: "Dashboard", description: "View the purchasing dashboard" },
  "buyer.catalogue.view": { audience: "BUYER", module: "Catalogue", description: "Browse the catalogue and prices" },
  "buyer.orders.place": { audience: "BUYER", module: "Orders", description: "Use the cart and place orders" },
  "buyer.orders.view": { audience: "BUYER", module: "Orders", description: "View orders" },
  "buyer.claims.manage": { audience: "BUYER", module: "Orders", description: "Report problems with delivered goods (damaged, missing, wrong, quality) and follow the claims" },
  "buyer.orders.approve": { audience: "BUYER", module: "Orders", description: "Approve the team's orders and set the approval rules" },
  "buyer.kitchen.manage": { audience: "BUYER", module: "Kitchen", description: "Menu costing: ingredients, recipes, prices, menu engineering; waste reports, targets and suggestions" },
  "buyer.kitchen.waste": { audience: "BUYER", module: "Kitchen", description: "Log food waste and donations" },
  "buyer.reviews.write": { audience: "BUYER", module: "Reviews", description: "Review products the business received, ask and answer questions" },
  "buyer.invoices.view": { audience: "BUYER", module: "Finance", description: "View and download invoices" },
  "buyer.payments.view": { audience: "BUYER", module: "Finance", description: "View payments and balance" },
  "buyer.payments.make": { audience: "BUYER", module: "Finance", description: "Pay invoices online and manage direct debit" },
  "buyer.addresses.manage": { audience: "BUYER", module: "Addresses", description: "Manage delivery addresses" },
  "buyer.compliance.manage": { audience: "BUYER", module: "Compliance", description: "Apply for tobacco / alcohol access" },
  "buyer.reports.view": { audience: "BUYER", module: "Reports", description: "View purchase reports and export them" },
  "buyer.branches.manage": { audience: "BUYER", module: "Branches", description: "Manage branches, staff assignments and budgets; see every branch" },

  // ── COMPANY (self-management) ────────────────────────────────────────────
  "company.profile.manage": { audience: "COMPANY", module: "Company", description: "Edit company profile" },
  "company.documents.manage": { audience: "COMPANY", module: "Company", description: "Upload and manage company documents" },
  "company.addresses.manage": { audience: "COMPANY", module: "Company", description: "Manage company addresses" },
  "company.support.use": { audience: "COMPANY", module: "Support", description: "Ask FIRINGI for help and follow support requests" },
  "company.integrations.manage": { audience: "COMPANY", module: "Integrations", description: "Create API keys and webhooks for the company's own systems" },
  "company.accounting.view": { audience: "COMPANY", module: "Accounting", description: "See the company's own accounting: sales, expenses, profit & loss (when FIRINGI switched it on)" },
  "company.accounting.manage": { audience: "COMPANY", module: "Accounting", description: "Enter daily sales and expenses (when FIRINGI switched it on)" },
  "company.pos.sell": { audience: "COMPANY", module: "Till (POS)", description: "Sell at the company's till: open/close a shift, take payments, print receipts (when FIRINGI switched the till on)" },
  "company.pos.manage": { audience: "COMPANY", module: "Till (POS)", description: "Set up the till: items, prices, recipes, tills, loyalty, the certified provider; refunds, discounts and reports" },
  "company.bank.view": { audience: "COMPANY", module: "Finance", description: "See the company's bank accounts and statement lines" },
  "company.bank.manage": { audience: "COMPANY", module: "Finance", description: "Import bank statements, link the bank feed and match bank lines" },
  "company.staff.manage": { audience: "COMPANY", module: "Staff & Time", description: "Plan the rota, manage staff and PINs, correct clock entries, approve timesheets, leave and swaps, export payroll (when FIRINGI switched it on)" },
  "company.staff.kiosk": { audience: "COMPANY", module: "Staff & Time", description: "Run the clock-in kiosk (PIN pad) on a shared device" },
  "team.users.view": { audience: "COMPANY", module: "Team", description: "View company users" },
  "team.users.manage": { audience: "COMPANY", module: "Team", description: "Create, disable and assign roles to company users" },
  "team.roles.manage": { audience: "COMPANY", module: "Team", description: "Create and edit company roles" },

  // ── DRIVER ───────────────────────────────────────────────────────────────
  "driver.deliveries.view": { audience: "DRIVER", module: "Deliveries", description: "View assigned deliveries" },
  "driver.deliveries.update": { audience: "DRIVER", module: "Deliveries", description: "Update delivery status" },
  "driver.pod.capture": { audience: "DRIVER", module: "Deliveries", description: "Capture proof of delivery" },
} as const satisfies Record<string, Def>;

export type PermissionCode = keyof typeof defs;

export const PERMISSIONS: Record<PermissionCode, Def> = defs;
export const ALL_PERMISSION_CODES = Object.keys(defs) as PermissionCode[];

/** Typed accessor: P("buyer.orders.place") */
export const P = <C extends PermissionCode>(code: C): C => code;

/** Which permission audiences each company type may ever hold (defence in depth). */
export const AUDIENCES_BY_COMPANY_TYPE: Record<CompanyType, PermissionAudience[]> = {
  ADMIN: ["ADMIN", "DRIVER"],
  DISTRIBUTOR: ["VENDOR", "COMPANY", "DRIVER"],
  WHOLESALER: ["VENDOR", "BUYER", "COMPANY", "DRIVER"],
  CUSTOMER: ["BUYER", "COMPANY"],
};

export function permissionsForAudiences(audiences: PermissionAudience[]): PermissionCode[] {
  return ALL_PERMISSION_CODES.filter((c) => audiences.includes(PERMISSIONS[c].audience));
}

/** Permissions a company of this type may grant to its users (roles are validated against this). */
export function grantablePermissions(type: CompanyType): PermissionCode[] {
  return permissionsForAudiences(AUDIENCES_BY_COMPANY_TYPE[type]);
}

export function isPermissionCode(v: string): v is PermissionCode {
  return v in defs;
}
