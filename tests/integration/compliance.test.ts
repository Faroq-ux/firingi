/**
 * Phase 11: SAF-T (PT) export and series checks.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { addToCart, clearCart } from "@/server/services/cart";
import { changeOrderStatus, confirmOrder, placeOrder } from "@/server/services/orders";
import { setStock } from "@/server/services/vendor-catalogue";
import { issueCreditNote } from "@/server/services/finance";
import { buildSaft, checkSeries, monthRange, saftOverview, taxCode } from "@/server/invoicing/saft";
import { ctxFor } from "../helpers";

afterAll(() => prisma.$disconnect());
const month = new Date().toISOString().slice(0, 7);
let invoiceNo = "";

/** One delivered order (→ FIRINGI invoice) and a partial credit note on it. */
beforeAll(async () => {
  const kebab = await ctxFor("owner@kebabhouse.test");
  const lx = await ctxFor("owner@lisboacentral.test");
  const ops = await ctxFor("ops@firingi.test");
  const offer = await prisma.vendorOffer.findFirstOrThrow({ where: { vendorCompanyId: lx.company.id, packaging: { variant: { sku: "FIR-MOZZ2" }, unitsPerPack: 1 } } });
  const wh = await prisma.address.findFirstOrThrow({ where: { companyId: lx.company.id, kind: { in: ["WAREHOUSE", "PICKUP"] } } });
  await setStock(lx, offer.id, wh.id, 900);
  const addr = await prisma.address.findFirstOrThrow({ where: { companyId: kebab.company.id, kind: "DELIVERY", isActive: true } });
  const deliver = async () => {
    await clearCart(kebab);
    await addToCart(kebab, offer.id, 10);
    const { id } = await placeOrder(kebab, { deliveryAddressId: addr.id });
    await confirmOrder(lx, id, {});
    await changeOrderStatus(lx, id, "READY_FOR_PICKUP");
    for (const s of ["DISPATCHED", "OUT_FOR_DELIVERY", "DELIVERED"] as const) await changeOrderStatus(ops, id, s);
    return id;
  };
  await deliver(); // two invoices in the series, so the hash chain has a link to check
  const id = await deliver();
  const inv = await prisma.invoice.findFirstOrThrow({ where: { orderId: id, docType: "INVOICE" }, include: { lines: true } });
  invoiceNo = inv.fullNumber!;
  await issueCreditNote(await ctxFor("finance@firingi.test"), inv.id, { lines: [{ invoiceLineId: inv.lines[0].id, qty: 2 }], reason: "Damaged blocks" });
});

describe("SAF-T (PT)", () => {
  it("tax codes and month ranges", () => {
    expect([taxCode(23), taxCode(13), taxCode(6), taxCode(0), taxCode(22), taxCode(16), taxCode(4), taxCode(6, "OUT")]).toEqual(["NOR", "INT", "RED", "ISE", "NOR", "INT", "RED", "OUT"]);
    expect(monthRange("2026-02")).toMatchObject({ start: new Date("2026-02-01T00:00:00Z"), end: new Date("2026-03-01T00:00:00Z"), year: 2026 });
    expect(() => monthRange("2026-13")).toThrow();
  });

  it("builds a well-formed file with the month's invoices and credit notes", async () => {
    const sa = await ctxFor("superadmin@firingi.test");
    const o = await saftOverview(sa, month);
    expect(o.entity).not.toBeNull();
    expect(o.certified).toBe(false); // internal development provider
    const { xml, filename, documents } = await buildSaft(sa, o.entity!.id, month);
    expect(filename).toMatch(/^SAFT-PT_\d{9}_\d{4}-\d{2}\.xml$/);
    expect(documents).toBe(o.totals!.documents);
    // well-formed XML
    const dir = mkdtempSync(join(tmpdir(), "saft-"));
    writeFileSync(join(dir, "f.xml"), xml);
    execFileSync("xmllint", ["--noout", join(dir, "f.xml")]);
    expect(xml).toContain('xmlns="urn:OECD:StandardAuditFile-Tax:PT_1.04_01"');
    expect(xml).toContain("<AuditFileVersion>1.04_01</AuditFileVersion>");
    expect(xml).toContain(`<InvoiceNo>${invoiceNo}</InvoiceNo>`);
    expect(xml).toMatch(/<InvoiceType>NC<\/InvoiceType>/);
    expect(xml).toContain(`<Reference>${invoiceNo}</Reference><Reason>Damaged blocks</Reason>`);
    expect(xml).toMatch(/<TaxCode>RED<\/TaxCode><TaxPercentage>6\.00<\/TaxPercentage>/);
    // totals match the documents
    const num = (re: RegExp) => Number(xml.match(re)![1]);
    const nets = [...xml.matchAll(/<InvoiceType>(FT|FR|NC)<\/InvoiceType>[\s\S]*?<NetTotal>([\d.]+)<\/NetTotal>/g)];
    const credit = nets.filter((m) => m[1] !== "NC").reduce((a, m) => a + Number(m[2]), 0);
    const debit = nets.filter((m) => m[1] === "NC").reduce((a, m) => a + Number(m[2]), 0);
    expect(num(/<TotalCredit>([\d.]+)<\/TotalCredit>/)).toBeCloseTo(credit, 2);
    expect(num(/<TotalDebit>([\d.]+)<\/TotalDebit>/)).toBeCloseTo(debit, 2);
    expect(num(/<NumberOfEntries>(\d+)<\/NumberOfEntries>/)).toBe(nets.length);
    // every customer referenced is in MasterFiles
    for (const [, id] of xml.matchAll(/<\/SystemEntryDate><CustomerID>([^<]+)<\/CustomerID>/g)) expect(xml).toContain(`<Customer><CustomerID>${id}</CustomerID>`);
  });

  it("series check: clean chain passes, a tampered hash is reported", async () => {
    const le = await prisma.legalEntity.findFirstOrThrow({ where: { country: { code: "PT" } } });
    const end = monthRange(month).end;
    const before = await checkSeries(le.id, end);
    const ft = before.find((s) => s.docType === "INVOICE" && s.documents > 1)!;
    expect(ft.problems.filter((p) => p.startsWith("Hash") || p.startsWith("Numbering"))).toEqual([]);
    const doc = await prisma.invoice.findFirstOrThrow({ where: { seriesId: ft.id, number: 2 } });
    await prisma.invoice.update({ where: { id: doc.id }, data: { previousHash: "tampered" } });
    try {
      const after = (await checkSeries(le.id, end)).find((s) => s.id === ft.id)!;
      expect(after.ok).toBe(false);
      expect(after.problems.join()).toContain(`Hash chain broken at ${doc.fullNumber}`);
    } finally {
      await prisma.invoice.update({ where: { id: doc.id }, data: { previousHash: doc.previousHash } });
    }
  });

  it("only FIRINGI tax / invoice staff may export", async () => {
    await expect(buildSaft(await ctxFor("owner@lisboacentral.test"), "x", month)).rejects.toThrow();
    await expect(buildSaft(await ctxFor("driver@firingi.test"), "x", month)).rejects.toThrow();
    await expect(buildSaft(await ctxFor("superadmin@firingi.test"), "nope", month)).rejects.toThrow(/Portuguese legal entity/);
  });
});
