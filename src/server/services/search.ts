/**
 * Command palette search (Ctrl+K): orders, companies, products, invoices — only what the caller may
 * open in the portal it is using. Each hit carries the page to open.
 */
import { prisma } from "@/server/db";
import type { Ctx } from "@/server/context";
import { can, portalsFor, type Portal } from "@/server/rbac/guard";
import { scopeWhere } from "@/server/services/admin-access";

export type SearchHit = { kind: "order" | "company" | "product" | "invoice"; id: string; title: string; subtitle: string; href: string };
const nameOf = (n: unknown) => { const o = (n ?? {}) as Record<string, string>; return o.en ?? o.pt ?? Object.values(o)[0] ?? ""; };
const ci = (q: string) => ({ contains: q, mode: "insensitive" as const });

export async function globalSearch(ctx: Ctx, portal: Portal, raw: string): Promise<SearchHit[]> {
  const q = raw.trim().slice(0, 80);
  if (q.length < 2 || !portalsFor(ctx).includes(portal)) return [];
  const hits: SearchHit[] = [];
  const money = (v: { toString(): string }) => `${Number(v.toString()).toFixed(2)} €`;

  if (portal === "admin") {
    const scope = scopeWhere(ctx);
    const [orders, companies, products, invoices] = await Promise.all([
      can(ctx, ["admin.orders.view", "admin.orders.manage"]) ? prisma.order.findMany({ where: { number: ci(q), buyer: scope }, select: { id: true, number: true, status: true, grandTotal: true, buyer: { select: { legalName: true } } }, orderBy: { placedAt: "desc" }, take: 6 }) : [],
      can(ctx, ["admin.customers.view", "admin.vendors.view"]) ? prisma.company.findMany({ where: { AND: [scope, { type: { not: "ADMIN" } }, { OR: [{ legalName: ci(q) }, { tradeName: ci(q) }, { taxId: { startsWith: q } }, { email: ci(q) }] }] }, select: { id: true, legalName: true, tradeName: true, type: true, taxId: true }, take: 6 }) : [],
      can(ctx, ["admin.catalogue.view", "admin.catalogue.manage"]) ? prisma.product.findMany({ where: { OR: [{ searchText: ci(q) }, { variants: { some: { OR: [{ sku: ci(q) }, { gtin: q }] } } }] }, select: { id: true, name: true, status: true }, take: 6 }) : [],
      can(ctx, ["admin.invoices.view", "admin.finance.view"]) ? prisma.invoice.findMany({ where: { OR: [{ fullNumber: ci(q) }, { providerNumber: ci(q) }], recipient: scope }, select: { id: true, fullNumber: true, providerNumber: true, grossTotal: true, recipient: { select: { legalName: true } } }, take: 4 }) : [],
    ]);
    for (const o of orders) hits.push({ kind: "order", id: o.id, title: o.number, subtitle: `${o.buyer.legalName} · ${o.status} · ${money(o.grandTotal)}`, href: `/admin/orders/${o.id}` });
    for (const c of companies) hits.push({ kind: "company", id: c.id, title: c.tradeName ?? c.legalName, subtitle: `${c.type} · ${c.taxId}`, href: `/admin/companies/${c.id}` });
    for (const p of products) hits.push({ kind: "product", id: p.id, title: nameOf(p.name), subtitle: p.status, href: `/admin/catalogue/products/${p.id}` });
    for (const i of invoices) hits.push({ kind: "invoice", id: i.id, title: i.providerNumber ?? i.fullNumber ?? i.id, subtitle: `${i.recipient.legalName} · ${money(i.grossTotal)}`, href: `/admin/invoices/${i.id}` });
    return hits;
  }

  if (portal === "vendor") {
    const [orders, offers] = await Promise.all([
      can(ctx, ["vendor.orders.view", "vendor.orders.manage"]) ? prisma.order.findMany({ where: { sellerCompanyId: ctx.company.id, status: { not: "ON_HOLD" }, OR: [{ number: ci(q) }, { buyer: { legalName: ci(q) } }, { buyer: { tradeName: ci(q) } }] }, select: { id: true, number: true, status: true, buyer: { select: { legalName: true, tradeName: true } } }, orderBy: { placedAt: "desc" }, take: 8 }) : [],
      can(ctx, "vendor.products.view") ? prisma.vendorOffer.findMany({ where: { vendorCompanyId: ctx.company.id, OR: [{ vendorSku: ci(q) }, { packaging: { variant: { OR: [{ sku: ci(q) }, { product: { searchText: ci(q) } }] } } }] }, select: { id: true, vendorSku: true, status: true, packaging: { select: { name: true, variant: { select: { product: { select: { name: true } } } } } } }, take: 8 }) : [],
    ]);
    for (const o of orders) hits.push({ kind: "order", id: o.id, title: o.number, subtitle: `${o.buyer.tradeName ?? o.buyer.legalName} · ${o.status}`, href: `/vendor/orders/${o.id}` });
    for (const f of offers) hits.push({ kind: "product", id: f.id, title: `${nameOf(f.packaging.variant.product.name)} · ${nameOf(f.packaging.name)}`, subtitle: [f.vendorSku, f.status].filter(Boolean).join(" · "), href: `/vendor/products/catalogue?q=${encodeURIComponent(f.vendorSku ?? q)}` });
    return hits;
  }

  if (portal === "buy") {
    const orders = can(ctx, ["buyer.orders.view", "buyer.orders.place"])
      ? await prisma.order.findMany({ where: { buyerCompanyId: ctx.company.id, number: ci(q) }, select: { id: true, number: true, status: true, grandTotal: true }, orderBy: { placedAt: "desc" }, take: 6 })
      : [];
    for (const o of orders) hits.push({ kind: "order", id: o.id, title: o.number, subtitle: `${o.status} · ${money(o.grandTotal)}`, href: `/buy/orders/${o.id}` });
    if (can(ctx, "buyer.catalogue.view")) {
      const { searchAcrossSuppliers } = await import("@/server/data/catalogue-buyer");
      const r = await searchAcrossSuppliers(ctx, q).catch(() => ({ items: [] as never[] }));
      for (const i of r.items.slice(0, 8)) hits.push({ kind: "product", id: i.offerId, title: `${nameOf(i.name)} · ${nameOf(i.packaging.name)}`, subtitle: `${i.vendor.name}${i.price ? ` · ${i.price.unitPriceNet} €` : ""}`, href: `/buy/catalogue/offers/${i.offerId}` });
    }
    return hits;
  }
  return hits;
}
