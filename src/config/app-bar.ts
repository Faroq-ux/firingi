/**
 * Phase 39: the phone bottom bar and the app's home-screen shortcuts, per portal. Items point at
 * menu pages (their label and permission come from the menu); `special` items are app pages.
 */
import type { AppPortal } from "@/lib/app";

export type BarItem = { href: string; icon: string; special?: "scan" | "offline" };

export const APP_BAR: Record<AppPortal, BarItem[]> = {
  buy: [
    { href: "/buy/dashboard/overview", icon: "LayoutDashboard" },
    { href: "/buy/catalogue/browse", icon: "Store" },
    { href: "/buy/orders/scan", icon: "ScanBarcode", special: "scan" },
    { href: "/buy/orders/cart", icon: "ShoppingCart" },
    { href: "/buy/orders/history", icon: "Package" },
  ],
  vendor: [
    { href: "/vendor/dashboard/overview", icon: "LayoutDashboard" },
    { href: "/vendor/orders/incoming", icon: "Inbox" },
    { href: "/vendor/warehouse/pick", icon: "ClipboardCheck" },
    { href: "/vendor/products/stock", icon: "Boxes" },
  ],
  driver: [
    { href: "/driver/deliveries/today", icon: "Truck" },
    { href: "/driver/deliveries/history", icon: "History" },
    { href: "/driver/deliveries/messages", icon: "MessageSquare" },
  ],
  admin: [
    { href: "/admin/dashboard/overview", icon: "LayoutDashboard" },
    { href: "/admin/orders/all", icon: "Package" },
    { href: "/admin/orders/exceptions", icon: "AlertTriangle" },
  ],
};

/** Long-press shortcuts on the app icon (at most 4 are shown by most phones). */
export const APP_SHORTCUTS: Record<AppPortal, string[]> = {
  buy: ["/buy/orders/scan", "/buy/orders/cart", "/buy/orders/buy-again", "/buy/orders/history"],
  vendor: ["/vendor/orders/incoming", "/vendor/warehouse/pick", "/vendor/warehouse/scan", "/vendor/products/stock"],
  driver: ["/driver/deliveries/today", "/driver/deliveries/history", "/offline"],
  admin: ["/admin/dashboard/overview", "/admin/orders/all", "/admin/orders/exceptions"],
};
