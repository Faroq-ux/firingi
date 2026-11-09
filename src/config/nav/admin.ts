/**
 * FIRINGI admin sidebar — all 20 sections. Items with live:false render the
 * "Coming soon" placeholder (with their planned phase) via the catch-all route.
 */
import { section, type NavSection } from "./types";

const A = "/admin";

const dash = section(`${A}/dashboard`, "admin.dashboard.view");
const ord = section(`${A}/orders`, ["admin.orders.view", "admin.orders.manage"]);
const dist = section(`${A}/vendors/distributors`, "admin.vendors.view");
const whol = section(`${A}/vendors/wholesalers`, "admin.vendors.view");
const vm = section(`${A}/vendors/management`, "admin.vendors.view");
const cus = section(`${A}/customers`, "admin.customers.view");
const cat = section(`${A}/catalogue`, "admin.catalogue.view");
const alo = section(`${A}/allocation`, "admin.allocation.manage");
const del = section(`${A}/delivery`, "admin.delivery.view");
const flt = section(`${A}/fleet`, "admin.fleet.view");
const prc = section(`${A}/pricing`, "admin.pricing.view");
const fin = section(`${A}/finance`, "admin.finance.view");
const inv = section(`${A}/invoices`, "admin.invoices.view");
const ana = section(`${A}/analytics`, "admin.analytics.view");
const ai = section(`${A}/ai`, "admin.ai.view");
const crm = section(`${A}/crm`, "admin.crm.view");
const intl = section(`${A}/international`, ["admin.international.view", "admin.international.manage"]);
const mkt = section(`${A}/marketing`, "admin.marketing.view");
const rsk = section(`${A}/risk`, "admin.risk.view");
const usr = section(`${A}/users`, ["admin.users.view", "admin.users.manage"]);
const ntf = section(`${A}/notifications`, "admin.notifications.view");
const set = section(`${A}/settings`, ["admin.settings.view", "admin.settings.manage"]);

/** The 10 vendor sub-pages shared by Distributors and Wholesalers. */
function vendorItems(s: typeof dist) {
  return [
    s("all", "All", "Todos", "P2"),
    s("applications", "Applications", "Candidaturas", "P2", { perm: ["admin.vendors.view", "admin.vendors.approve"] }),
    s("active", "Active", "Ativos", "P2"),
    s("products", "Products", "Produtos", "P3"),
    s("pricing", "Pricing", "Preços", "P3"),
    s("stock", "Stock", "Stock", "P3"),
    s("orders", "Orders", "Encomendas", "P4"),
    s("performance", "Performance", "Desempenho", "LATER"),
    s("contracts", "Contracts", "Contratos", "LATER"),
    s("payments", "Payments", "Pagamentos", "P5", { perm: ["admin.finance.view"] }),
  ];
}

export const ADMIN_NAV: NavSection[] = [
  {
    key: "dashboard", icon: "LayoutDashboard", label: { en: "Dashboard", pt: "Painel", es: "Panel" },
    items: [
      dash("overview", "Executive Overview", "Visão Geral Executiva", "P1", { live: true }),
      dash("live-operations", "Live Operations", "Operações em Tempo Real", "LATER"),
      dash("kpi", "KPI & Performance", "KPI e Desempenho", "LATER"),
      dash("ai-insights", "AI Insights", "Insights de IA", "LATER"),
      dash("alerts", "Alerts & Exceptions", "Alertas e Exceções", "P4"),
      dash("today", "Today's Activity", "Atividade de Hoje", "P4"),
    ],
  },
  {
    key: "orders", icon: "Package", label: { en: "Orders", pt: "Encomendas", es: "Pedidos" },
    items: [
      ord("all", "All Orders", "Todas as Encomendas", "P4"),
      ord("new", "New Orders", "Novas Encomendas", "P4"),
      ord("pending-confirmation", "Pending Confirmation", "A Aguardar Confirmação", "P4"),
      ord("supplier-processing", "Supplier Processing", "Em Processamento no Fornecedor", "P4"),
      ord("ready-for-pickup", "Ready for Pickup", "Pronta para Recolha", "P4"),
      ord("dispatched", "Dispatched", "Expedida", "P4"),
      ord("out-for-delivery", "Out for Delivery", "Em Distribuição", "P4"),
      ord("delivered", "Delivered", "Entregue", "P4"),
      ord("cancelled-returned", "Cancelled / Returned", "Canceladas / Devolvidas", "P4"),
      ord("exceptions", "Order Exceptions", "Exceções de Encomendas", "P4"),
      ord("split", "Order Split / Multi-Vendor Orders", "Divisão / Multi-Fornecedor", "LATER", { perm: "admin.orders.manage" }),
    ],
  },
  {
    key: "vendors", icon: "Store", label: { en: "Vendors", pt: "Fornecedores", es: "Proveedores" },
    groups: [
      { key: "distributors", label: { en: "Distributors", pt: "Distribuidores", es: "Distribuidores" }, items: vendorItems(dist) },
      { key: "wholesalers", label: { en: "Wholesalers", pt: "Grossistas", es: "Mayoristas" }, items: vendorItems(whol) },
      {
        key: "management", label: { en: "Vendor Management", pt: "Gestão de Fornecedores", es: "Gestión de proveedores" },
        items: [
          vm("onboarding", "Onboarding", "Integração", "P2"),
          vm("verification", "Verification", "Verificação", "P2", { perm: "admin.vendors.approve" }),
          vm("documents", "Documents", "Documentos", "P2"),
          vm("approval", "Approval", "Aprovação", "P2", { perm: "admin.vendors.approve" }),
          vm("commission", "Commission", "Comissões", "P5", { perm: ["admin.vendors.commission", "admin.finance.view"] }),
          vm("service-areas", "Service Areas", "Áreas de Serviço", "P6"),
          vm("rules", "Rules", "Regras", "P6"),
          vm("ratings", "Ratings", "Avaliações", "LATER"),
          vm("compliance", "Compliance", "Conformidade", "P2"),
        ],
      },
    ],
  },
  {
    key: "customers", icon: "Users", label: { en: "Customers", pt: "Clientes", es: "Clientes" },
    items: [
      cus("all", "All Customers", "Todos os Clientes", "P2"),
      cus("businesses", "Wholesale Businesses", "Empresas Clientes", "P2"),
      cus("applications", "Customer Applications", "Candidaturas de Clientes", "P2", { perm: ["admin.customers.view", "admin.customers.approve"] }),
      cus("active", "Active Customers", "Clientes Ativos", "P2"),
      cus("groups", "Customer Groups", "Grupos de Clientes", "P3"),
      cus("pricing", "Customer Pricing", "Preços de Clientes", "P3"),
      cus("credit", "Credit & Limits", "Crédito e Limites", "P5"),
      cus("addresses", "Customer Addresses", "Moradas de Clientes", "P2"),
      cus("purchase-history", "Purchase History", "Histórico de Compras", "P4"),
      cus("activity", "Customer Activity", "Atividade de Clientes", "LATER"),
      cus("support", "Customer Support", "Apoio ao Cliente", "LATER"),
    ],
  },
  {
    key: "catalogue", icon: "ShoppingBag", label: { en: "Products & Catalogue", pt: "Produtos e Catálogo", es: "Productos y catálogo" },
    items: [
      cat("products", "Product Catalogue", "Catálogo de Produtos", "P3"),
      cat("categories", "Categories", "Categorias", "P3"),
      cat("brands", "Brands", "Marcas", "P3"),
      cat("sku", "SKU Management", "Gestão de SKU", "P3"),
      cat("variants", "Product Variants", "Variantes de Produto", "P3"),
      cat("units", "Units & Packaging", "Unidades e Embalagens", "P3"),
      cat("vendor-products", "Vendor Products", "Produtos de Fornecedores", "P3"),
      cat("availability", "Product Availability", "Disponibilidade de Produtos", "P3"),
      cat("stock", "Stock", "Stock", "P3"),
      cat("pricing", "Product Pricing", "Preços de Produtos", "P3"),
      cat("customer-pricing", "Customer-Specific Pricing", "Preços por Cliente", "P3"),
      cat("promotions", "Promotions", "Promoções", "P5"),
      cat("approval", "Product Approval", "Aprovação de Produtos", "P3", { perm: "admin.catalogue.approve" }),
    ],
  },
  {
    key: "allocation", icon: "Handshake", label: { en: "Supplier/Vendor Allocation", pt: "Alocação de Fornecedores", es: "Asignación de proveedores" },
    items: [
      alo("control-tower", "Allocation Control Tower", "Torre de Controlo de Alocação", "LATER"),
      alo("auto", "Auto Allocation", "Alocação Automática", "LATER"),
      alo("manual", "Manual Allocation", "Alocação Manual", "LATER"),
      alo("distributor-vs-wholesaler", "Distributor vs Wholesaler", "Distribuidor vs Grossista", "LATER"),
      alo("distance-rules", "Distance Rules", "Regras de Distância", "LATER"),
      alo("route-matching", "Route Matching", "Correspondência de Rotas", "LATER"),
      alo("existing-order-matching", "Existing Order Matching", "Correspondência com Encomendas", "LATER"),
      alo("margin-rules", "Margin Rules", "Regras de Margem", "LATER"),
      alo("stock-availability", "Stock Availability", "Disponibilidade de Stock", "LATER"),
      alo("delivery-capacity", "Delivery Capacity", "Capacidade de Entrega", "LATER"),
      alo("vendor-priority", "Vendor Priority", "Prioridade de Fornecedores", "LATER"),
      alo("history", "Allocation History", "Histórico de Alocação", "LATER"),
      alo("overrides", "Allocation Overrides", "Substituições de Alocação", "LATER"),
    ],
  },
  {
    key: "delivery", icon: "Truck", label: { en: "Delivery & Logistics", pt: "Entregas e Logística", es: "Entregas y logística" },
    items: [
      del("control-tower", "Delivery Control Tower", "Torre de Controlo de Entregas", "P6"),
      del("live", "Live Deliveries", "Entregas em Tempo Real", "P6"),
      del("drivers", "Drivers", "Motoristas", "P6"),
      del("vehicles", "Vehicles", "Veículos", "P6"),
      del("routes", "Routes", "Rotas", "LATER"),
      del("multi-stop", "Multi-Stop Routes", "Rotas Multi-Paragem", "LATER"),
      del("route-optimization", "Route Optimization", "Otimização de Rotas", "LATER"),
      del("zones", "Delivery Zones", "Zonas de Entrega", "P6"),
      del("fees", "Delivery Fees", "Taxas de Entrega", "P6"),
      del("minimum-order", "Minimum Order Rules", "Regras de Encomenda Mínima", "P6"),
      del("eta", "ETA Management", "Gestão de ETA", "LATER"),
      del("proof-of-delivery", "Proof of Delivery", "Comprovativo de Entrega", "P6"),
      del("failed", "Failed Deliveries", "Entregas Falhadas", "P6"),
      del("returns", "Returns", "Devoluções", "P6"),
      del("performance", "Delivery Performance", "Desempenho de Entregas", "LATER"),
    ],
  },
  {
    key: "fleet", icon: "UserCog", label: { en: "Drivers & Fleet", pt: "Motoristas e Frota", es: "Conductores y flota" },
    items: [
      flt("admin-drivers", "Admin Driver List", "Motoristas FIRINGI", "P6"),
      flt("vendor-drivers", "Vendors Driver List", "Motoristas de Fornecedores", "P6"),
      flt("applications", "Driver Applications", "Candidaturas de Motoristas", "P2", { perm: ["admin.fleet.view", "admin.fleet.manage"] }),
      flt("availability", "Driver Availability", "Disponibilidade de Motoristas", "P6"),
      flt("assignments", "Driver Assignments", "Atribuições de Motoristas", "P6"),
      flt("vehicles", "Vehicle Management", "Gestão de Veículos", "P6"),
      flt("vehicle-registration", "Vehicle Registration", "Registo de Veículos", "P6"),
      flt("documents", "Driver Documents", "Documentos de Motoristas", "P2"),
      flt("performance", "Driver Performance", "Desempenho de Motoristas", "LATER"),
      flt("earnings", "Driver Earnings", "Ganhos de Motoristas", "LATER"),
    ],
  },
  {
    key: "pricing", icon: "Coins", label: { en: "Pricing & Commercial", pt: "Preços e Comercial", es: "Precios y comercial" },
    items: [
      prc("price-lists", "Price Lists", "Listas de Preços", "P3"),
      prc("vendor", "Vendor Pricing", "Preços de Fornecedores", "P3"),
      prc("customer", "Customer Pricing", "Preços de Clientes", "P3"),
      prc("wholesale", "Wholesale Pricing", "Preços Grossista", "P3"),
      prc("distributor", "Distributor Pricing", "Preços Distribuidor", "P3"),
      prc("promotions", "Promotions", "Promoções", "P5"),
      prc("discounts", "Discounts", "Descontos", "P5"),
      prc("minimum-order", "Minimum Order Value", "Valor Mínimo de Encomenda", "P6"),
      prc("delivery-fees", "Delivery Fee Rules", "Regras de Taxa de Entrega", "P6"),
      prc("commission", "Commission Rules", "Regras de Comissão", "P5"),
      prc("margin", "Margin Rules", "Regras de Margem", "LATER"),
      prc("contract", "Contract Pricing", "Preços Contratuais", "LATER"),
    ],
  },
  {
    key: "finance", icon: "Wallet", label: { en: "Finance", pt: "Finanças", es: "Finanzas" },
    items: [
      fin("overview", "Financial Overview", "Visão Financeira", "P5"),
      fin("customer-payments", "Customer Payments", "Pagamentos de Clientes", "P5"),
      fin("vendor-payments", "Vendor Payments", "Pagamentos a Fornecedores", "P5"),
      fin("distributor-payments", "Distributor Payments", "Pagamentos a Distribuidores", "P5"),
      fin("wholesaler-payments", "Wholesaler Payments", "Pagamentos a Grossistas", "P5"),
      fin("commissions", "Commissions", "Comissões", "P5"),
      fin("refunds", "Refunds", "Reembolsos", "P5"),
      fin("credit-notes", "Credit Notes", "Notas de Crédito", "P5"),
      fin("receivable", "Accounts Receivable", "Contas a Receber", "P5"),
      fin("payable", "Accounts Payable", "Contas a Pagar", "P5"),
      fin("profit-loss", "Profit & Loss", "Lucros e Perdas", "LATER"),
      fin("cash-flow", "Cash Flow", "Fluxo de Caixa", "LATER"),
    ],
  },
  {
    key: "invoices", icon: "Receipt", label: { en: "Invoices & Tax", pt: "Faturas e Impostos", es: "Facturas e impuestos" },
    items: [
      inv("customer", "Customer Invoices", "Faturas de Clientes", "P5"),
      inv("vendor", "Vendor Invoices", "Faturas de Fornecedores", "P5"),
      inv("distributor", "Distributor Invoices", "Faturas de Distribuidores", "P5"),
      inv("wholesaler", "Wholesaler Invoices", "Faturas de Grossistas", "P5"),
      inv("credit-notes", "Credit Notes", "Notas de Crédito", "P5"),
      inv("vat", "VAT", "IVA", "P5"),
      inv("tax-configuration", "Tax Configuration", "Configuração Fiscal", "P5", { perm: "admin.tax.manage" }),
      inv("settings", "Invoice Settings", "Definições de Faturação", "P5", { perm: "admin.tax.manage" }),
      inv("payment-status", "Payment Status", "Estado de Pagamento", "P5"),
      inv("tax-reports", "Tax Reports", "Relatórios Fiscais", "P5"),
      inv("saft", "SAF-T / Compliance", "SAF-T / Conformidade", "LATER"),
      inv("country-tax-rules", "Country Tax Rules", "Regras Fiscais por País", "P1", { live: true, href: `${A}/international/tax-rules` }),
    ],
  },
  {
    key: "analytics", icon: "BarChart3", label: { en: "Analytics & Reports", pt: "Análises e Relatórios", es: "Analítica e informes" },
    items: [
      ana("sales", "Sales Analytics", "Análise de Vendas", "LATER"),
      ana("revenue", "Revenue", "Receita", "LATER"),
      ana("gross-margin", "Gross Margin", "Margem Bruta", "LATER"),
      ana("net-profit", "Net Profit", "Lucro Líquido", "LATER"),
      ana("orders", "Order Analytics", "Análise de Encomendas", "LATER"),
      ana("customers", "Customer Analytics", "Análise de Clientes", "LATER"),
      ana("vendors", "Vendor Analytics", "Análise de Fornecedores", "LATER"),
      ana("distributors", "Distributor Analytics", "Análise de Distribuidores", "LATER"),
      ana("wholesalers", "Wholesaler Analytics", "Análise de Grossistas", "LATER"),
      ana("products", "Product Analytics", "Análise de Produtos", "LATER"),
      ana("delivery", "Delivery Analytics", "Análise de Entregas", "LATER"),
      ana("route-profitability", "Route Profitability", "Rentabilidade de Rotas", "LATER"),
      ana("country", "Country Performance", "Desempenho por País", "LATER"),
      ana("custom", "Custom Reports", "Relatórios Personalizados", "LATER"),
    ],
  },
  {
    key: "ai", icon: "Bot", label: { en: "AI Centre", pt: "Centro de IA", es: "Centro de IA" },
    items: [
      ai("assistant", "AI Business Assistant", "Assistente de Negócio IA", "LATER"),
      ai("supplier-recommendations", "Supplier Recommendations", "Recomendações de Fornecedores", "LATER"),
      ai("demand-forecasting", "Demand Forecasting", "Previsão de Procura", "LATER"),
      ai("stock-predictions", "Stock Predictions", "Previsões de Stock", "LATER"),
      ai("margin-opportunities", "Margin Opportunities", "Oportunidades de Margem", "LATER"),
      ai("delivery-risk", "Delivery Risk Detection", "Deteção de Risco de Entrega", "LATER"),
      ai("reorder-predictions", "Customer Reorder Predictions", "Previsões de Recompra", "LATER"),
      ai("fraud-alerts", "Fraud/Risk Alerts", "Alertas de Fraude/Risco", "LATER"),
      ai("route-optimization", "Route Optimization", "Otimização de Rotas", "LATER"),
      ai("recommendations", "Automated Recommendations", "Recomendações Automáticas", "LATER"),
      ai("activity-log", "AI Activity Log", "Registo de Atividade IA", "LATER"),
    ],
  },
  {
    key: "crm", icon: "Contact", label: { en: "CRM", pt: "CRM", es: "CRM" },
    items: [
      crm("leads", "Leads", "Leads", "LATER"),
      crm("accounts", "Business Accounts", "Contas Empresariais", "LATER"),
      crm("contacts", "Contacts", "Contactos", "LATER"),
      crm("pipeline", "Sales Pipeline", "Pipeline de Vendas", "LATER"),
      crm("segments", "Customer Segments", "Segmentos de Clientes", "LATER"),
      crm("follow-ups", "Follow-ups", "Seguimentos", "LATER"),
      crm("communications", "Communications", "Comunicações", "LATER"),
      crm("notes", "Notes", "Notas", "LATER"),
      crm("tasks", "Tasks", "Tarefas", "LATER"),
      crm("performance", "Sales Performance", "Desempenho Comercial", "LATER"),
    ],
  },
  {
    key: "international", icon: "Globe", label: { en: "International / Multi-Country", pt: "Internacional / Multi-País", es: "Internacional / multipaís" },
    items: [
      intl("countries", "Countries", "Países", "P1", { live: true }),
      intl("regions", "Regions", "Regiões", "P1", { live: true }),
      intl("cities", "Cities", "Cidades", "P1", { live: true }),
      intl("currency", "Currency", "Moeda", "P1", { live: true }),
      intl("exchange-rates", "Exchange Rates", "Taxas de Câmbio", "P1", { live: true }),
      intl("languages", "Languages", "Idiomas", "P1", { live: true }),
      intl("tax-rules", "Tax Rules", "Regras Fiscais", "P1", { live: true }),
      intl("vat-gst", "VAT/GST", "IVA/GST", "P1", { live: true, href: `${A}/international/tax-rules?view=vat` }),
      intl("country-pricing", "Country Pricing", "Preços por País", "P3"),
      intl("delivery-zones", "Delivery Zones", "Zonas de Entrega", "P6"),
      intl("vendors", "Country-Specific Vendors", "Fornecedores por País", "P2"),
      intl("customers", "Country-Specific Customers", "Clientes por País", "P2"),
      intl("regional-managers", "Regional Managers", "Gestores Regionais", "P1", { live: true, href: `${A}/users/regional-managers`, perm: ["admin.users.view", "admin.users.manage"] }),
    ],
  },
  {
    key: "marketing", icon: "Megaphone", label: { en: "Marketing", pt: "Marketing", es: "Marketing" },
    items: [
      mkt("promotions", "Promotions", "Promoções", "P5"),
      mkt("campaigns", "Campaigns", "Campanhas", "LATER"),
      mkt("vendor-promotions", "Vendor Promotions", "Promoções de Fornecedores", "P5"),
      mkt("customer-offers", "Customer Offers", "Ofertas a Clientes", "LATER"),
      mkt("coupons", "Coupons", "Cupões", "LATER"),
      mkt("push", "Push Notifications", "Notificações Push", "LATER"),
      mkt("email", "Email Campaigns", "Campanhas de Email", "LATER"),
      mkt("segments", "Customer Segments", "Segmentos de Clientes", "LATER"),
      mkt("analytics", "Marketing Analytics", "Análise de Marketing", "LATER"),
    ],
  },
  {
    key: "risk", icon: "ShieldCheck", label: { en: "Risk & Compliance", pt: "Risco e Conformidade", es: "Riesgo y cumplimiento" },
    items: [
      rsk("vendor-verification", "Vendor Verification", "Verificação de Fornecedores", "P2"),
      rsk("customer-verification", "Customer Verification", "Verificação de Clientes", "P2"),
      rsk("kyc", "KYC/KYB", "KYC/KYB", "P2"),
      rsk("documents", "Documents", "Documentos", "P2"),
      rsk("fraud", "Fraud Detection", "Deteção de Fraude", "LATER"),
      rsk("suspicious-orders", "Suspicious Orders", "Encomendas Suspeitas", "LATER"),
      rsk("payment-risk", "Payment Risk", "Risco de Pagamento", "LATER"),
      rsk("compliance", "Compliance", "Conformidade", "P2"),
      rsk("audit-trail", "Audit Trail", "Trilho de Auditoria", "P1", { live: true, perm: "admin.audit.view" }),
      rsk("data-privacy", "Data Privacy", "Privacidade de Dados", "LATER"),
    ],
  },
  {
    key: "users", icon: "UserRound", label: { en: "Users & Permissions", pt: "Utilizadores e Permissões", es: "Usuarios y permisos" },
    items: [
      usr("all", "Users", "Utilizadores", "P1", { live: true }),
      usr("admins", "Admins", "Administradores", "P1", { live: true }),
      usr("operations", "Operations Team", "Equipa de Operações", "P1", { live: true }),
      usr("finance", "Finance Team", "Equipa Financeira", "P1", { live: true }),
      usr("sales", "Sales Team", "Equipa Comercial", "P1", { live: true }),
      usr("support", "Support Team", "Equipa de Suporte", "P1", { live: true }),
      usr("regional-managers", "Regional Managers", "Gestores Regionais", "P1", { live: true }),
      usr("vendor-users", "Vendor Users", "Utilizadores de Fornecedores", "P1", { live: true }),
      usr("roles", "Roles", "Funções", "P1", { live: true }),
      usr("permissions", "Permissions", "Permissões", "P1", { live: true }),
      usr("approval-workflows", "Approval Workflows", "Fluxos de Aprovação", "LATER"),
    ],
  },
  {
    key: "notifications", icon: "Bell", label: { en: "Notifications & Communications", pt: "Notificações e Comunicações", es: "Notificaciones y comunicaciones" },
    items: [
      ntf("all", "Notifications", "Notificações", "LATER"),
      ntf("email", "Email", "Email", "LATER"),
      ntf("sms", "SMS", "SMS", "LATER"),
      ntf("push", "Push Notifications", "Notificações Push", "LATER"),
      ntf("whatsapp", "WhatsApp Integration", "Integração WhatsApp", "LATER"),
      ntf("customer-messages", "Customer Messages", "Mensagens de Clientes", "LATER"),
      ntf("vendor-messages", "Vendor Messages", "Mensagens de Fornecedores", "LATER"),
      ntf("driver-messages", "Driver Messages", "Mensagens de Motoristas", "LATER"),
      ntf("templates", "Notification Templates", "Modelos de Notificação", "LATER"),
    ],
  },
  {
    key: "settings", icon: "Settings", label: { en: "Settings", pt: "Definições", es: "Ajustes" },
    items: [
      set("company", "Company Settings", "Definições da Empresa", "P1", { live: true }),
      set("marketplace", "Marketplace Settings", "Definições do Marketplace", "P2"),
      set("orders", "Order Settings", "Definições de Encomendas", "P4"),
      set("vendors", "Vendor Settings", "Definições de Fornecedores", "P2"),
      set("customers", "Customer Settings", "Definições de Clientes", "P2"),
      set("delivery", "Delivery Settings", "Definições de Entrega", "P6"),
      set("payment", "Payment Settings", "Definições de Pagamento", "P5"),
      set("invoice", "Invoice Settings", "Definições de Faturação", "P5"),
      set("tax", "Tax Settings", "Definições Fiscais", "P5"),
      set("currency", "Currency Settings", "Definições de Moeda", "P1", { live: true, href: `${A}/international/currency`, perm: ["admin.settings.view", "admin.international.view"] }),
      set("language", "Language Settings", "Definições de Idioma", "P1", { live: true, href: `${A}/international/languages`, perm: ["admin.settings.view", "admin.international.view"] }),
      set("api", "API & Integrations", "API e Integrações", "LATER"),
      set("security", "Security", "Segurança", "LATER"),
      set("audit-logs", "Audit Logs", "Registos de Auditoria", "P1", { live: true, perm: ["admin.audit.view", "admin.settings.view"] }),
    ],
  },
];
