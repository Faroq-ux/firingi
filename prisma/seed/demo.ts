/**
 * Demo / test accounts. Every user's password is SEED_PASSWORD (default "Firingi!2026").
 * Covers every account type and approval status so all rules can be tried by hand.
 */
import type { AccountStatus, CompanyType, PrismaClient } from "@prisma/client";
import { hashPassword } from "better-auth/crypto";
import { makePtNif } from "../../src/lib/tax-id";

type UserDef = { email: string; name: string; roles: string[]; owner?: boolean; regionCodes?: string[]; jobTitle?: string };
type CompanyDef = {
  key: string;
  type: CompanyType;
  status: AccountStatus;
  country: string;
  legalName: string;
  tradeName?: string;
  taxId: string;
  vatNumber?: string;
  email: string;
  businessType?: string;
  /** FIRINGI's own in-house warehouse (run as a wholesaler). */
  isInHouse?: boolean;
  users: UserDef[];
};

export const DEMO_COMPANIES: CompanyDef[] = [
  {
    key: "firingi", type: "ADMIN", status: "APPROVED", country: "PT", legalName: "FIRINGI, Lda", tradeName: "FIRINGI",
    taxId: makePtNif("51700000"), vatNumber: `PT${makePtNif("51700000")}`, email: "geral@firingi.test",
    users: [
      { email: "superadmin@firingi.test", name: "Super Admin", roles: ["SUPER_ADMIN"], owner: true, jobTitle: "CEO" },
      { email: "ops@firingi.test", name: "Olívia Operações", roles: ["OPERATIONS"], jobTitle: "Operations Lead" },
      { email: "finance@firingi.test", name: "Filipe Finanças", roles: ["FINANCE"], jobTitle: "Finance Manager" },
      { email: "sales@firingi.test", name: "Sara Vendas", roles: ["SALES"], jobTitle: "Account Manager" },
      { email: "support@firingi.test", name: "Sérgio Suporte", roles: ["SUPPORT"], jobTitle: "Support Agent" },
      { email: "rm.lisboa@firingi.test", name: "Rita Regional", roles: ["REGIONAL_MANAGER"], regionCodes: ["PT-11", "PT-15"], jobTitle: "Regional Manager Lisboa" },
      { email: "driver@firingi.test", name: "Daniel Motorista", roles: ["ADMIN_DRIVER"], jobTitle: "Driver" },
    ],
  },
  {
    key: "dist-pt", type: "DISTRIBUTOR", status: "APPROVED", country: "PT", legalName: "Distribuidora Atlântico, Lda", tradeName: "Atlântico",
    taxId: makePtNif("51012345"), vatNumber: `PT${makePtNif("51012345")}`, email: "geral@atlantico.test",
    users: [{ email: "owner@atlantico.test", name: "António Atlântico", roles: ["COMPANY_ADMIN"], owner: true }],
  },
  {
    key: "dist-es", type: "DISTRIBUTOR", status: "APPROVED", country: "ES", legalName: "Distribuciones Ibéricas S.L.", tradeName: "Ibéricas",
    taxId: "B12345678", vatNumber: "ESB12345678", email: "info@ibericas.test",
    users: [{ email: "owner@ibericas.test", name: "Javier Ibérico", roles: ["COMPANY_ADMIN"], owner: true }],
  },
  {
    key: "whs-lisboa", type: "WHOLESALER", status: "APPROVED", country: "PT", legalName: "Grossista Lisboa Central, Lda", tradeName: "Lisboa Central",
    taxId: makePtNif("51098765"), vatNumber: `PT${makePtNif("51098765")}`, email: "geral@lisboacentral.test",
    users: [
      { email: "owner@lisboacentral.test", name: "Luís Central", roles: ["COMPANY_ADMIN"], owner: true },
      // Limited employee — used to prove blocked pages / actions (checklist item 10).
      { email: "warehouse@lisboacentral.test", name: "Wagner Armazém", roles: ["VENDOR_WAREHOUSE"], jobTitle: "Warehouse" },
      { email: "purchasing@lisboacentral.test", name: "Paula Compras", roles: ["BUYER_PURCHASER"], jobTitle: "Purchasing" },
    ],
  },
  {
    key: "whs-almada", type: "WHOLESALER", status: "APPROVED", country: "PT", legalName: "Cash & Carry Almada, Lda", tradeName: "C&C Almada",
    taxId: makePtNif("51077777"), vatNumber: `PT${makePtNif("51077777")}`, email: "geral@ccalmada.test",
    users: [{ email: "owner@ccalmada.test", name: "Alice Almada", roles: ["COMPANY_ADMIN"], owner: true }],
  },
  {
    key: "whs-firingi", type: "WHOLESALER", status: "APPROVED", country: "PT", legalName: "FIRINGI Armazém Central, Lda", tradeName: "FIRINGI Armazém",
    taxId: makePtNif("51099999"), vatNumber: `PT${makePtNif("51099999")}`, email: "armazem@firingi.test", isInHouse: true,
    users: [{ email: "armazem@firingi.test", name: "Armando Armazém", roles: ["COMPANY_ADMIN"], owner: true, jobTitle: "In-house warehouse" }],
  },
  {
    key: "whs-porto", type: "WHOLESALER", status: "PENDING", country: "PT", legalName: "Grossista Porto Norte, Lda",
    taxId: makePtNif("51055555"), vatNumber: `PT${makePtNif("51055555")}`, email: "geral@portonorte.test",
    users: [{ email: "owner@portonorte.test", name: "Pedro Norte", roles: ["COMPANY_ADMIN"], owner: true }],
  },
  {
    key: "cust-kebab", type: "CUSTOMER", status: "APPROVED", country: "PT", legalName: "Kebab House Lisboa, Lda", tradeName: "Kebab House",
    taxId: makePtNif("51544444"), vatNumber: `PT${makePtNif("51544444")}`, email: "geral@kebabhouse.test", businessType: "kebab_pizza",
    users: [
      { email: "owner@kebabhouse.test", name: "Karim Kebab", roles: ["COMPANY_ADMIN"], owner: true },
      { email: "buyer@kebabhouse.test", name: "Bruno Compras", roles: ["BUYER_PURCHASER"], jobTitle: "Purchaser" },
    ],
  },
  {
    key: "cust-minimercado", type: "CUSTOMER", status: "PENDING", country: "PT", legalName: "Mini-Mercado Sol, Unipessoal Lda",
    taxId: makePtNif("51633333"), vatNumber: `PT${makePtNif("51633333")}`, email: "geral@minimercadosol.test", businessType: "mini_market",
    users: [{ email: "owner@minimercadosol.test", name: "Sofia Sol", roles: ["COMPANY_ADMIN"], owner: true }],
  },
  {
    key: "cust-pizzaria", type: "CUSTOMER", status: "UNDER_REVIEW", country: "PT", legalName: "Pizzaria Bella Porto, Lda",
    taxId: makePtNif("51722222"), vatNumber: `PT${makePtNif("51722222")}`, email: "geral@pizzariabella.test", businessType: "kebab_pizza",
    users: [{ email: "owner@pizzariabella.test", name: "Bianca Bella", roles: ["COMPANY_ADMIN"], owner: true }],
  },
];

export async function seedDemo(
  db: PrismaClient,
  refs: { countryIds: Record<string, string>; regionIds: Record<string, string>; taxCatIds: Record<string, string> },
  roleIds: Record<string, string>,
) {
  const password = await hashPassword(process.env.SEED_PASSWORD ?? "Firingi!2026");
  const companies: Record<string, string> = {};

  for (const def of DEMO_COMPANIES) {
    const countryId = refs.countryIds[def.country];
    const data = {
      type: def.type,
      status: def.status,
      legalName: def.legalName,
      tradeName: def.tradeName ?? null,
      vatNumber: def.vatNumber ?? null,
      email: def.email,
      businessType: def.businessType ?? null,
      isInHouse: def.isInHouse ?? false,
      approvedAt: def.status === "APPROVED" ? new Date() : null,
    };
    const company = await db.company.upsert({
      where: { countryId_taxId_type: { countryId, taxId: def.taxId, type: def.type } },
      update: data,
      create: { ...data, taxId: def.taxId, countryId },
    });
    companies[def.key] = company.id;
    if ((await db.companyStatusHistory.count({ where: { companyId: company.id } })) === 0)
      await db.companyStatusHistory.create({ data: { companyId: company.id, toStatus: def.status, reason: "Seeded demo account" } });

    for (const u of def.users) {
      const user = await db.user.upsert({
        where: { email: u.email },
        update: { name: u.name, status: "ACTIVE" },
        create: { email: u.email, name: u.name, emailVerified: true },
      });
      const acct = await db.account.findFirst({ where: { userId: user.id, providerId: "credential" } });
      if (acct) await db.account.update({ where: { id: acct.id }, data: { password } });
      else await db.account.create({ data: { userId: user.id, accountId: user.id, providerId: "credential", password } });

      const membership = await db.membership.upsert({
        where: { userId_companyId: { userId: user.id, companyId: company.id } },
        update: { isOwner: !!u.owner, status: "ACTIVE", jobTitle: u.jobTitle ?? null },
        create: { userId: user.id, companyId: company.id, isOwner: !!u.owner, jobTitle: u.jobTitle ?? null },
      });
      await db.membershipRole.deleteMany({ where: { membershipId: membership.id } });
      await db.membershipRole.createMany({ data: u.roles.map((k) => ({ membershipId: membership.id, roleId: roleIds[k] })) });
      await db.membershipScope.deleteMany({ where: { membershipId: membership.id } });
      for (const rc of u.regionCodes ?? [])
        await db.membershipScope.create({ data: { membershipId: membership.id, countryId, regionId: refs.regionIds[rc] } });

      if (u.roles.includes("ADMIN_DRIVER"))
        await db.driver.upsert({
          where: { userId: user.id },
          update: {},
          create: { userId: user.id, ownerCompanyId: company.id, licenceNumber: "L-123456", status: "APPROVED" },
        });
    }
  }

  // FIRINGI legal entity (issuer of every sales invoice) — Portugal at launch.
  const fir = DEMO_COMPANIES[0];
  await db.legalEntity.upsert({
    where: { countryId_taxId: { countryId: refs.countryIds.PT, taxId: fir.taxId } },
    update: {},
    create: {
      countryId: refs.countryIds.PT, legalName: "FIRINGI, Lda", taxId: fir.taxId, vatNumber: fir.vatNumber!,
      addressLine: "Avenida da Liberdade 100", postalCode: "1250-145", city: "Lisboa", email: "faturacao@firingi.test",
      phone: "+351 210 000 000", iban: "PT50 0000 0000 0000 0000 0000 0",
    },
  });

  // Platform settings (configurable; read by later phases).
  const settings: [string, unknown][] = [
    ["marketplace.defaultCountry", "PT"],
    ["marketplace.defaultCurrency", "EUR"],
    ["orders.numberPrefix", "FO"],
    ["billingStatements.numberPrefix", "VBS"],
  ];
  for (const [key, value] of settings)
    await db.setting.upsert({
      where: { scope_scopeId_key: { scope: "GLOBAL", scopeId: "", key } },
      update: { value: value as never },
      create: { scope: "GLOBAL", scopeId: "", key, value: value as never },
    });

  // FIRINGI delivery rule for Portugal (set by admin): minimum order for FIRINGI delivery + fee.
  if (!(await db.deliveryRule.findFirst({ where: { scope: "COUNTRY", countryId: refs.countryIds.PT } })))
    await db.deliveryRule.create({
      data: { scope: "COUNTRY", countryId: refs.countryIds.PT, minOrderValue: 50, firingiDeliveryFeeNet: 9.9, feeTaxCategoryId: refs.taxCatIds.STANDARD },
    });

  return { companies };
}
