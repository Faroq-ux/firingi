import type { Portal } from "@/server/rbac/guard";
import type { PermissionCode } from "@/server/rbac/permissions";
import { NAV_BY_PORTAL, allItems } from "./resolve";

/** First sidebar page the user may open in a portal (used when they lack the dashboard). */
export function findFirstAllowed(portal: Portal, perms: Set<PermissionCode>): string {
  const item = allItems(NAV_BY_PORTAL[portal]).find((i) => i.permission.some((p) => perms.has(p)));
  return item?.href ?? "/forbidden";
}
