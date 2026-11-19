/**
 * Phase 47 demo: a till at Kebab House Lisboa (menu, loyalty card, a guest) and a counter till at Distribuidora
 * Atlântico (its products are added from the till's "Fill from my products").
 */
import type { PrismaClient } from "@prisma/client";

export async function seedPosDemo(db: PrismaClient) {
  const kh = await db.company.findFirst({ where: { legalName: "Kebab House Lisboa, Lda" } });
  const atl = await db.company.findFirst({ where: { legalName: "Distribuidora Atlântico, Lda" } });
  if (kh) {
    await db.posCompany.upsert({ where: { companyId: kh.id }, update: {}, create: { companyId: kh.id, loyaltyOn: true, pointsPerUnit: 1, pointValue: 0.05, minRedeem: 50, receiptHeader: "Rua Augusta 120, Lisboa", receiptFooter: "Obrigado e volte sempre!" } });
    if (!(await db.posRegister.findFirst({ where: { companyId: kh.id } }))) await db.posRegister.create({ data: { companyId: kh.id, name: "Caixa principal", code: "C1" } });
    if (!(await db.posItem.count({ where: { companyId: kh.id } }))) {
      const items: [string, string, number, number, Partial<{ restriction: string; kitchen: boolean; allergens: string[]; color: string; byWeight: boolean }>][] = [
        ["Kebab no pão", "Pratos", 7.5, 13, { kitchen: true, allergens: ["GLUTEN", "SESAME"], color: "#ef4444" }],
        ["Dürüm", "Pratos", 8, 13, { kitchen: true, allergens: ["GLUTEN"], color: "#ef4444" }],
        ["Prato kebab com batatas", "Pratos", 11.5, 13, { kitchen: true, allergens: ["GLUTEN", "MILK"], color: "#f97316" }],
        ["Falafel", "Pratos", 7, 13, { kitchen: true, allergens: ["SESAME"], color: "#22c55e" }],
        ["Batatas fritas", "Acompanhamentos", 3, 13, { kitchen: true, color: "#eab308" }],
        ["Sopa do dia", "Acompanhamentos", 2.5, 13, { kitchen: true, allergens: ["CELERY"] }],
        ["Água 50 cl", "Bebidas", 1.2, 13, { color: "#3b82f6" }],
        ["Refrigerante lata", "Bebidas", 1.8, 23, { color: "#3b82f6" }],
        ["Imperial", "Bebidas", 1.8, 23, { restriction: "ALCOHOL", color: "#a16207" }],
        ["Café", "Bebidas", 0.9, 23, { color: "#78350f" }],
        ["Baklava", "Sobremesas", 3.5, 13, { allergens: ["NUTS", "GLUTEN"], color: "#a855f7" }],
        ["Azeitonas (kg)", "Mercearia", 9.9, 6, { byWeight: true }],
      ];
      for (const [i, [name, category, price, vatRate, x]] of items.entries()) await db.posItem.create({ data: { companyId: kh.id, name, category, price, vatRate, sortOrder: i, ...x } });
    }
    await db.posMember.upsert({ where: { companyId_code: { companyId: kh.id, code: "912000111" } }, update: {}, create: { companyId: kh.id, code: "912000111", name: "Ana Ribeiro", phone: "912000111", points: 120, consentAt: new Date() } });
  }
  if (atl) {
    await db.posCompany.upsert({ where: { companyId: atl.id }, update: {}, create: { companyId: atl.id } });
    const wh = await db.address.findFirst({ where: { companyId: atl.id, isActive: true, kind: { in: ["WAREHOUSE", "PICKUP"] } }, orderBy: { createdAt: "asc" } });
    if (!(await db.posRegister.findFirst({ where: { companyId: atl.id } }))) await db.posRegister.create({ data: { companyId: atl.id, name: "Balcão Cash & Carry", code: "C1", addressId: wh?.id ?? null } });
  }
}
