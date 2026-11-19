/**
 * Phase 46 demo: FIRINGI's companies get their Peppol ids (PT VAT scheme 9946, PL VAT scheme 9945), so Peppol
 * routes can be tried at once; the Polish route (KSeF, mandatory) needs nothing else. A Portuguese wholesaler (as a
 * buyer from distributors, and for FIRINGI's service invoices) receives its invoices through Peppol. The routes stay at their defaults (see src/lib/einvoice.ts). Idempotent.
 */
import type { PrismaClient } from "@prisma/client";

export async function seedEInvoiceDemo(db: PrismaClient) {
  const ids: Record<string, string> = { PT: "9946:PT517000008", PL: "9945:PL5213999999" };
  for (const [cc, peppolId] of Object.entries(ids)) {
    const le = await db.legalEntity.findFirst({ where: { country: { code: cc }, isActive: true } });
    if (le && !le.peppolId) await db.legalEntity.update({ where: { id: le.id }, data: { peppolId } });
  }
  const co = await db.company.findFirst({ where: { legalName: "Cash & Carry Almada, Lda" } });
  if (co) await db.eInvoiceProfile.upsert({ where: { companyId: co.id }, update: {}, create: { companyId: co.id, delivery: "BOTH", peppolId: `9946:${(co.vatNumber ?? `PT${co.taxId}`).toUpperCase()}` } });
}
