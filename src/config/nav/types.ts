import type { PermissionCode } from "@/server/rbac/permissions";

/** Localized label; missing languages fall back to English. */
export type L = { en: string; pt?: string; es?: string };

export type Phase = "P1" | "P2" | "P3" | "P4" | "P5" | "P6" | "P7" | "P8" | "P9" | "P10" | "P11" | "P12" | "P13" | "P14" | "P15" | "P16" | "P17" | "P18" | "P19" | "P20" | "P21" | "P24" | "P25" | "P26" | "P27" | "P28" | "P29" | "P30" | "P31" | "P32" | "P33" | "P34" | "P35" | "P36" | "P37" | "P38" | "P39" | "P40" | "P41" | "P42" | "P43" | "P44" | "P45" | "P46" | "P47" | "P48" | "P49" | "P50" | "P51" | "P52" | "P53" | "P54" | "P55" | "P56" | "P57" | "P58" | "P60" | "P61" | "P62" | "P63" | "P64" | "P65" | "P66" | "P67" | "P68" | "P69" | "P70" | "P71" | "P72" | "LATER";

export const PHASE_LABEL: Record<Phase, L> = {
  P1: { en: "Phase 1 — Foundation", pt: "Fase 1 — Fundação" },
  P2: { en: "Phase 2 — Onboarding", pt: "Fase 2 — Integração" },
  P3: { en: "Phase 3 — Catalogue", pt: "Fase 3 — Catálogo" },
  P4: { en: "Phase 4 — Orders", pt: "Fase 4 — Encomendas" },
  P5: { en: "Phase 5 — Commercial & Finance", pt: "Fase 5 — Comercial e Finanças" },
  P6: { en: "Phase 6 — Delivery & Fleet", pt: "Fase 6 — Entregas e Frota" },
  P7: { en: "Phase 7 — Notifications & WhatsApp", pt: "Fase 7 — Notificações e WhatsApp" },
  P8: { en: "Phase 8 — Analytics & Reports", pt: "Fase 8 — Análises e Relatórios" },
  P9: { en: "Phase 9 — Supplier Allocation", pt: "Fase 9 — Alocação de Fornecedores" },
  P10: { en: "Phase 10 — Ordering from FIRINGI", pt: "Fase 10 — Encomendas à FIRINGI" },
  P11: { en: "Phase 11 — Go-live essentials", pt: "Fase 11 — Essenciais para arranque" },
  P12: { en: "Phase 12 — Routes & Fleet", pt: "Fase 12 — Rotas e Frota" },
  P13: { en: "Phase 13 — CRM & Sales", pt: "Fase 13 — CRM e Vendas" },
  P14: { en: "Phase 14 — Profit & Performance", pt: "Fase 14 — Lucro e Desempenho" },
  P15: { en: "Phase 15 — Marketing & Promotions", pt: "Fase 15 — Marketing e Promoções" },
  P16: { en: "Phase 16 — Risk & Control", pt: "Fase 16 — Risco e Controlo" },
  P17: { en: "Phase 17 — AI Centre", pt: "Fase 17 — Centro de IA" },
  P18: { en: "Phase 18 — Certified invoicing & payouts", pt: "Fase 18 — Faturação certificada e pagamentos" },
  P19: { en: "Phase 19 — Production readiness", pt: "Fase 19 — Pronto para produção" },
  P20: { en: "Phase 20 — Customer payments", pt: "Fase 20 — Pagamentos de clientes" },
  P21: { en: "Phase 21 — Integrations", pt: "Fase 21 — Integrações" },
  P24: { en: "Phase 24 — Inventory & warehouses", pt: "Fase 24 — Inventário e armazéns" },
  P25: { en: "Phase 25 — Warehouse ops & traceability", pt: "Fase 25 — Operações de armazém e rastreabilidade" },
  P26: { en: "Phase 26 — B2B buying (quotes, recurring orders, approvals, lists)", pt: "Fase 26 — Compras B2B (orçamentos, encomendas recorrentes, aprovações, listas)" },
  P27: { en: "Phase 27 — Shops, budgets & accounting", pt: "Fase 27 — Lojas, orçamentos e contabilidade" },
  P28: { en: "Phase 28 — Supplier compliance", pt: "Fase 28 — Conformidade de fornecedores" },
  P29: { en: "Phase 29 — Price intelligence", pt: "Fase 29 — Inteligência de preços" },
  P30: { en: "Phase 30 — Demand planning & restock", pt: "Fase 30 — Planeamento da procura e reposição" },
  P31: { en: "Phase 31 — Quality claims & credits", pt: "Fase 31 — Reclamações de qualidade e créditos" },
  P32: { en: "Phase 32 — Loyalty & rewards", pt: "Fase 32 — Fidelização e recompensas" },
  P33: { en: "Phase 33 — Launch readiness & pilot", pt: "Fase 33 — Preparação do lançamento e piloto" },
  P34: { en: "Phase 34 — Sponsored products", pt: "Fase 34 — Produtos patrocinados" },
  P35: { en: "Phase 35 — Order chat", pt: "Fase 35 — Conversas nas encomendas" },
  P36: { en: "Phase 36 — Supplier plans & early payout", pt: "Fase 36 — Planos de fornecedor e pagamento antecipado" },
  P37: { en: "Phase 37 — Bank reconciliation", pt: "Fase 37 — Reconciliação bancária" },
  P38: { en: "Phase 38 — Clearance deals", pt: "Fase 38 — Oportunidades de escoamento" },
  P39: { en: "Phase 39 — Installable phone app (offline)", pt: "Fase 39 — Aplicação móvel instalável (offline)" },
  P40: { en: "Phase 40 — Returnables & deposits", pt: "Fase 40 — Vasilhame e depósitos" },
  P41: { en: "Phase 41 — Sold by weight", pt: "Fase 41 — Venda ao peso" },
  P42: { en: "Phase 42 — Cold chain & HACCP", pt: "Fase 42 — Cadeia de frio e HACCP" },
  P43: { en: "Phase 43 — Licensed & excise goods", pt: "Fase 43 — Produtos licenciados e IEC" },
  P44: { en: "Phase 44 — Food information & allergens", pt: "Fase 44 — Informação alimentar e alergénios" },
  P45: { en: "Phase 45 — Multi-currency", pt: "Fase 45 — Multimoeda" },
  P46: { en: "Phase 46 — E-invoicing", pt: "Fase 46 — Faturação eletrónica" },
  P47: { en: "Phase 47 — Till (POS)", pt: "Fase 47 — Caixa (POS)" },
  P48: { en: "Phase 48 — Rebates & Bonuses", pt: "Fase 48 — Rappel e Bónus" },
  P49: { en: "Phase 49 — Buying Groups", pt: "Fase 49 — Grupos de Compra" },
  P50: { en: "Phase 50 — Pay Later & Tenders", pt: "Fase 50 — Pagar Mais Tarde e Concursos" },
  P51: { en: "Phase 51 — Sustainability & CO₂", pt: "Fase 51 — Sustentabilidade e CO₂" },
  P52: { en: "Phase 52 — Staff Shifts & Time", pt: "Fase 52 — Turnos e Horários do Pessoal" },
  P53: { en: "Phase 53 — Product Reviews & Questions", pt: "Fase 53 — Avaliações e Perguntas sobre Produtos" },
  P54: { en: "Phase 54 — Menu Costing & Food Waste", pt: "Fase 54 — Custos de Menu e Desperdício Alimentar" },
  P55: { en: "Phase 55 — Rewards Shop", pt: "Fase 55 — Loja de Recompensas" },
  P57: { en: "Phase 57 — EU Trade Reporting", pt: "Fase 57 — Relatórios de Comércio UE" },
  P56: { en: "Phase 56 — Landing Page", pt: "Fase 56 — Página Inicial" },
  P58: { en: "Phase 58 — WhatsApp Ordering", pt: "Fase 58 — Encomendas por WhatsApp" },
  P60: { en: "Phase 60 — Substitutions", pt: "Fase 60 — Substituições" },
  P61: { en: "Phase 61 — Storefronts", pt: "Fase 61 — Lojas dos Grossistas" },
  P62: { en: "Phase 62 — Sales reps", pt: "Fase 62 — Vendedores" },
  P63: { en: "Phase 63 — Van sales", pt: "Fase 63 — Vendas na Carrinha" },
  P64: { en: "Phase 64 — Customer assortments", pt: "Fase 64 — Sortidos por Cliente" },
  P65: { en: "Phase 65 — Consignment stock", pt: "Fase 65 — Stock à Consignação" },
  P66: { en: "Phase 66 — AI Centre", pt: "Fase 66 — Centro de IA" },
  P67: { en: "Phase 67 — AI Automation, Agents & Governance", pt: "Fase 67 — Automação, Agentes e Governação de IA" },
  P68: { en: "Phase 68 — Services & used cooking oil", pt: "Fase 68 — Serviços e óleo alimentar usado" },
  P69: { en: "Phase 69 — Food safety (HACCP) logbook", pt: "Fase 69 — Registos de segurança alimentar (HACCP)" },
  P70: { en: "Phase 70 — Price benchmark", pt: "Fase 70 — Comparação de preços" },
  P71: { en: "Phase 71 — Pre-orders & price locks", pt: "Fase 71 — Pré-encomendas e preços fixos" },
  P72: { en: "Phase 72 — Smart search", pt: "Fase 72 — Pesquisa inteligente" },
  LATER: { en: "Later phases", pt: "Fases posteriores" },
};

export type NavItem = {
  key: string;
  label: L;
  href: string;
  /** Visible when the user holds ANY of these permissions. */
  permission: PermissionCode[];
  /** "live" pages are implemented; others render the Coming-soon placeholder. */
  phase: Phase;
  live: boolean;
  /** Hidden when FIRINGI switched this feature off for the company (warehouse features, Phase 25). */
  feature?: string;
};

export type NavGroup = { key: string; label: L; items: NavItem[] };

export type NavSection = {
  key: string;
  label: L;
  icon: string; // lucide icon name, mapped in the client sidebar
  items?: NavItem[];
  groups?: NavGroup[];
};

/** Helper that builds items for a section with a common base path & default permission. */
export function section(base: string, perm: PermissionCode | PermissionCode[]) {
  const defaultPerm = Array.isArray(perm) ? perm : [perm];
  return (
    slug: string,
    en: string,
    pt: string,
    phase: Phase,
    opts: { live?: boolean; perm?: PermissionCode | PermissionCode[]; href?: string; es?: string; feature?: string } = {},
  ): NavItem => ({
    key: `${base}/${slug}`,
    label: { en, pt, ...(opts.es ? { es: opts.es } : {}) },
    href: opts.href ?? `${base}/${slug}`,
    permission: opts.perm ? (Array.isArray(opts.perm) ? opts.perm : [opts.perm]) : defaultPerm,
    phase,
    live: opts.live ?? false,
    ...(opts.feature ? { feature: opts.feature } : {}),
  });
}
