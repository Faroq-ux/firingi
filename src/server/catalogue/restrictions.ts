/**
 * Effective tobacco / alcohol restriction (pure).
 * A category inherits its parent's restriction unless it sets its own; a product
 * inherits its category's unless it sets its own. A product can ADD a restriction
 * (e.g. a liqueur inside "Groceries") but can never remove an inherited one.
 */
import type { Restriction } from "@prisma/client";

export type CategoryNode = { id: string; parentId: string | null; restriction: Restriction | null; isActive: boolean };
export type CategoryInfo = { restriction: Restriction | null; active: boolean; ancestors: string[] };

export function categoryInfo(categories: CategoryNode[]): Map<string, CategoryInfo> {
  const byId = new Map(categories.map((c) => [c.id, c]));
  const memo = new Map<string, CategoryInfo>();
  const resolve = (id: string, seen = new Set<string>()): CategoryInfo => {
    const hit = memo.get(id);
    if (hit) return hit;
    const c = byId.get(id);
    if (!c || seen.has(id)) return { restriction: null, active: false, ancestors: [] }; // missing or cycle → hidden
    seen.add(id);
    const parent = c.parentId ? resolve(c.parentId, seen) : null;
    const info: CategoryInfo = {
      restriction: c.restriction ?? parent?.restriction ?? null,
      active: c.isActive && (parent ? parent.active : true),
      ancestors: parent ? [...parent.ancestors, c.parentId!] : [],
    };
    memo.set(id, info);
    return info;
  };
  for (const c of categories) resolve(c.id);
  return memo;
}

export function effectiveRestriction(product: { restriction: Restriction | null; categoryId: string }, info: Map<string, CategoryInfo>) {
  // Category restriction always applies; the product may only add one.
  return info.get(product.categoryId)?.restriction ?? product.restriction ?? null;
}

/** Category ids a buyer may browse: active, and unrestricted or restricted to something allowed. */
export function browsableCategoryIds(info: Map<string, CategoryInfo>, allowed: Restriction[]) {
  return [...info.entries()].filter(([, i]) => i.active && (!i.restriction || allowed.includes(i.restriction))).map(([id]) => id);
}

/** A category plus all its descendants. */
export function withDescendants(rootId: string, info: Map<string, CategoryInfo>) {
  return [...info.entries()].filter(([id, i]) => id === rootId || i.ancestors.includes(rootId)).map(([id]) => id);
}
