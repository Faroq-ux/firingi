/** Readable names for report dimensions, figures and keys (back office in English). */
import { pickLocalized } from "@/i18n/config";
import { fmtPeriod, type Fmt } from "@/lib/analytics-format";
import { labelsFor, type Dim, type Metric, type Row } from "./engine";

const TIME = new Set<Dim>(["day", "week", "month"]);

export const ADMIN_ENUMS = {
  flow: { CUSTOMER_FROM_WHOLESALER: "Customers ← Wholesalers", WHOLESALER_FROM_DISTRIBUTOR: "Wholesalers ← Distributors" } as Record<string, string>,
  deliveryMode: { VENDOR_FLEET: "Vendor fleet", FIRINGI_FLEET: "FIRINGI fleet", CARRIER: "Carrier", "-": "Pickup / not set" } as Record<string, string>,
  status: {
    NEW: "New", PENDING_CONFIRMATION: "Pending confirmation", SUPPLIER_PROCESSING: "Being prepared", READY_FOR_PICKUP: "Ready for pickup", DISPATCHED: "Dispatched",
    OUT_FOR_DELIVERY: "Out for delivery", DELIVERED: "Delivered", CANCELLED: "Cancelled", RETURNED: "Returned", EXCEPTION: "Exception",
  } as Record<string, string>,
};

export const DIM_LABEL: Record<Dim, string> = {
  day: "Day", week: "Week", month: "Month", vendor: "Vendor", buyer: "Buyer", country: "Buyer country", sellerCountry: "Seller country",
  flow: "Marketplace", deliveryMode: "Delivery mode", region: "Delivery region", product: "Product", category: "Category", categoryRoot: "Top category",
};
export const METRIC_LABEL: Record<Metric, string> = {
  orders: "Orders", buyers: "Buyers", units: "Units", net: "Net sales", goodsNet: "Goods net", gross: "Gross (incl. VAT)", vat: "VAT",
  commission: "Commission", margin: "Goods margin", fees: "Delivery fees", revenue: "FIRINGI revenue", discount: "Discounts", payout: "Owed to vendors", aov: "Average order",
};
export const METRIC_FMT: Record<Metric, Fmt> = {
  orders: "number", buyers: "number", units: "number", net: "money", goodsNet: "money", gross: "money", vat: "money",
  commission: "money", margin: "money", fees: "money", revenue: "money", discount: "money", payout: "money", aov: "money",
};

/** Resolve every dimension key in the rows to a readable label. */
export async function labelRows(rows: Row[], dims: Dim[], locale: string, enums: { flow: Record<string, string>; deliveryMode: Record<string, string> } = ADMIN_ENUMS) {
  const maps = await Promise.all(dims.map((d) => labelsFor(d, rows.map((r) => r.keys[d]), (v) => pickLocalized(v, locale))));
  return (d: Dim, key: string | null, i = dims.indexOf(d)) => {
    if (key === null || key === "-") return d === "deliveryMode" ? enums.deliveryMode["-"] : "—";
    if (TIME.has(d)) return fmtPeriod(key.slice(0, 10), d as "day", locale);
    if (d === "flow") return enums.flow[key] ?? key;
    if (d === "deliveryMode") return enums.deliveryMode[key] ?? key;
    return maps[i]?.get(key) ?? key;
  };
}

