/** Shared admin catalogue views, reused by several sidebar entries. */
import Link from "next/link";
import type { OfferStatus, PriceListScope, SellerType } from "@prisma/client";
import { getLocale } from "next-intl/server";
import type { Ctx } from "@/server/context";
import { can } from "@/server/rbac/guard";
import { adminCustomerGroups, adminOffers, adminPriceLists, adminUnits, adminVariants } from "@/server/data/catalogue-admin";
import { pickLocalized } from "@/i18n/config";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { EmptyRow, TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { OfferDecision } from "./catalogue-editors";
import { formatDate, formatMoney } from "@/lib/utils";

const OFFER_VARIANT = { ACTIVE: "success", PAUSED: "secondary", PENDING_APPROVAL: "warning", REJECTED: "destructive", ARCHIVED: "secondary" } as const;

export async function OffersView({ ctx, title, description, basePath, sellerType, params, showStock = false }: {
  ctx: Ctx; title: string; description?: string; basePath: string; sellerType?: SellerType; showStock?: boolean; params: { q?: string; status?: string; page?: string };
}) {
  const status = (params.status || undefined) as OfferStatus | undefined;
  const [data, locale] = await Promise.all([adminOffers(ctx, { sellerType, status, q: params.q, page: Number(params.page) || 1 }), getLocale()]);
  const canDecide = can(ctx, "admin.catalogue.approve");
  return (
    <>
      <PageHeader title={title} description={description ?? `${data.total} offers`} />
      <form className="mb-4 flex flex-wrap gap-2" action={basePath}>
        <Input name="q" defaultValue={params.q} placeholder="Product or vendor" className="w-64" />
        <Select name="status" defaultValue={params.status ?? ""} className="w-48">
          <option value="">All statuses</option>{Object.keys(OFFER_VARIANT).map((s) => <option key={s} value={s}>{s.replace("_", " ").toLowerCase()}</option>)}
        </Select>
        <Button variant="outline" type="submit">Filter</Button>
      </form>
      <Table>
        <THead><TR><TH>Product</TH><TH>Vendor</TH><TH>Base price</TH>{showStock && <TH className="text-right">On hand</TH>}{showStock && <TH className="text-right">Reserved</TH>}<TH>Status</TH>{canDecide && <TH className="text-right">Decision</TH>}</TR></THead>
        <TBody>
          {data.rows.length === 0 && <EmptyRow colSpan={7}>No offers.</EmptyRow>}
          {data.rows.map((o) => {
            const onHand = o.stockLevels.reduce((a, s) => a + s.onHand, 0);
            const reserved = o.stockLevels.reduce((a, s) => a + s.reserved, 0);
            return (
              <TR key={o.id}>
                <TD>
                  <Link href={`/admin/catalogue/products/${o.packaging.variant.product.id}`} className="font-medium text-primary hover:underline">{pickLocalized(o.packaging.variant.product.name, locale)}</Link>
                  <div className="text-xs text-muted-foreground">{pickLocalized(o.packaging.name, locale)} · SKU {o.packaging.variant.sku}{(o.packaging.gtin ?? o.packaging.variant.gtin) ? ` · EAN ${o.packaging.gtin ?? o.packaging.variant.gtin}` : ""}</div>
                </TD>
                <TD><Link href={`/admin/companies/${o.vendor.id}`} className="hover:underline">{o.vendor.country.flag} {o.vendor.legalName}</Link><div className="text-xs text-muted-foreground">{o.vendor.type.toLowerCase()}</div></TD>
                <TD className="text-sm tabular-nums">{o.prices.length ? o.prices.map((p) => `${p.minQty > 1 ? `≥${p.minQty}: ` : ""}${formatMoney(p.unitPriceNet.toString(), locale)}`).join(" · ") : <Badge variant="warning">no price</Badge>}</TD>
                {showStock && <TD className={`text-right tabular-nums ${onHand - reserved <= 0 ? "text-destructive" : ""}`}>{onHand}</TD>}
                {showStock && <TD className="text-right tabular-nums">{reserved}</TD>}
                <TD><Badge variant={OFFER_VARIANT[o.status]}>{o.status.replace("_", " ").toLowerCase()}</Badge>{o.reviewNote && <div className="text-xs text-muted-foreground">{o.reviewNote}</div>}</TD>
                {canDecide && <TD>{o.packaging.variant.product.status === "APPROVED" && <OfferDecision offerId={o.id} status={o.status} />}</TD>}
              </TR>
            );
          })}
        </TBody>
      </Table>
      <p className="mt-3 text-sm text-muted-foreground">Page {data.page} of {data.pageCount}</p>
    </>
  );
}

export async function PriceListsView({ ctx, title, description, sellerType, scopes }: { ctx: Ctx; title: string; description?: string; sellerType?: SellerType; scopes?: PriceListScope[] }) {
  const rows = await adminPriceLists(ctx, { sellerType, scopes });
  return (
    <>
      <PageHeader title={title} description={description ?? "Prices are set by vendors. The most specific valid list applies: customer / contract → group → base."} />
      <Table>
        <THead><TR><TH>Vendor</TH><TH>Price list</TH><TH>Scope</TH><TH>Applies to</TH><TH>Country</TH><TH>Validity</TH><TH className="text-right">Prices</TH></TR></THead>
        <TBody>
          {rows.length === 0 && <EmptyRow colSpan={7}>No price lists.</EmptyRow>}
          {rows.map((l) => (
            <TR key={l.id}>
              <TD><Link href={`/admin/companies/${l.vendor.id}`} className="hover:underline">{l.vendor.legalName}</Link><div className="text-xs text-muted-foreground">{l.vendor.type.toLowerCase()}</div></TD>
              <TD className="font-medium">{l.name}{!l.isActive && <Badge variant="secondary" className="ml-1">inactive</Badge>}</TD>
              <TD><Badge variant={l.scope === "BASE" ? "secondary" : "default"}>{l.scope.replace("_", " ").toLowerCase()}</Badge></TD>
              <TD>{l.targetGroup?.name ?? (l.targetCompany ? <Link href={`/admin/companies/${l.targetCompany.id}`} className="hover:underline">{l.targetCompany.legalName}</Link> : "everyone")}</TD>
              <TD>{l.country.flag} {l.country.code} · {l.currencyCode}</TD>
              <TD className="text-xs text-muted-foreground">{formatDate(l.validFrom)} → {l.validTo ? formatDate(l.validTo) : "∞"}</TD>
              <TD className="text-right tabular-nums">{l._count.items}</TD>
            </TR>
          ))}
        </TBody>
      </Table>
    </>
  );
}

export async function VariantsView({ ctx, title, q }: { ctx: Ctx; title: string; q?: string }) {
  const [rows, locale] = await Promise.all([adminVariants(ctx, q), getLocale()]);
  return (
    <>
      <PageHeader title={title} description="Every sellable variant with its internal SKU, barcode and packaging units." />
      <form className="mb-4 flex gap-2"><Input name="q" defaultValue={q} placeholder="SKU, EAN or name" className="w-64" /><Button variant="outline" type="submit">Search</Button></form>
      <Table>
        <THead><TR><TH>SKU</TH><TH>Product</TH><TH>EAN / GTIN</TH><TH>Attributes</TH><TH>Packaging</TH><TH>Active</TH></TR></THead>
        <TBody>
          {rows.map((v) => (
            <TR key={v.id}>
              <TD><code className="text-xs">{v.sku}</code></TD>
              <TD><Link href={`/admin/catalogue/products/${v.product.id}`} className="text-primary hover:underline">{pickLocalized(v.product.name, locale)}</Link></TD>
              <TD className="font-mono text-xs">{v.gtin ?? "—"}</TD>
              <TD className="text-xs">{v.attributes ? Object.entries(v.attributes as Record<string, string>).map(([k, val]) => `${k}: ${val}`).join(", ") : "—"}</TD>
              <TD className="text-xs">{v.packagings.map((p) => `${pickLocalized(p.name, locale)} (${p.unitsPerPack} ${p.uomCode})`).join(" · ")}</TD>
              <TD>{v.isActive ? <Badge variant="success">yes</Badge> : <Badge variant="secondary">no</Badge>}</TD>
            </TR>
          ))}
        </TBody>
      </Table>
    </>
  );
}

export async function UnitsView({ ctx }: { ctx: Ctx }) {
  const [rows, locale] = await Promise.all([adminUnits(ctx), getLocale()]);
  return (
    <>
      <PageHeader title="Units & Packaging" description="Units of measure used by packaging units. Packaging (e.g. Case 24 × 33cl) is defined per product variant." />
      <Table>
        <THead><TR><TH>Code</TH><TH>Name</TH><TH className="text-right">Packaging units using it</TH></TR></THead>
        <TBody>{rows.map((u) => <TR key={u.code}><TD><code>{u.code}</code></TD><TD>{pickLocalized(u.name, locale)}</TD><TD className="text-right tabular-nums">{u._count.packagings}</TD></TR>)}</TBody>
      </Table>
    </>
  );
}

export async function CustomerGroupsView({ ctx }: { ctx: Ctx }) {
  const rows = await adminCustomerGroups(ctx);
  return (
    <>
      <PageHeader title="Customer Groups" description="Groups created by vendors for group pricing. FIRINGI-owned groups for promotions arrive with Phase 5." />
      <Table>
        <THead><TR><TH>Group</TH><TH>Owner</TH><TH>Members</TH><TH className="text-right">Price lists</TH></TR></THead>
        <TBody>
          {rows.length === 0 && <EmptyRow colSpan={4}>No groups.</EmptyRow>}
          {rows.map((g) => (
            <TR key={g.id}>
              <TD className="font-medium">{g.name}<div className="text-xs text-muted-foreground">{g.description}</div></TD>
              <TD>{g.owner?.legalName ?? "FIRINGI"}</TD>
              <TD className="text-sm">{g.members.map((m) => m.company.legalName).join(", ") || "—"}</TD>
              <TD className="text-right tabular-nums">{g._count.priceLists}</TD>
            </TR>
          ))}
        </TBody>
      </Table>
    </>
  );
}
