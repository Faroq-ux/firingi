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
const invn = section(`${A}/inventory`, ["admin.inventory.view", "admin.inventory.manage"]);
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
    s("all", "All", "Todos", "P2", { live: true, perm: ["admin.vendors.view", "admin.vendors.approve"] }),
    s("applications", "Applications", "Candidaturas", "P2", { live: true, perm: ["admin.vendors.view", "admin.vendors.approve"] }),
    s("active", "Active", "Ativos", "P2", { live: true, perm: ["admin.vendors.view", "admin.vendors.approve"] }),
    s("products", "Products", "Produtos", "P3", { live: true }),
    s("pricing", "Pricing", "Preços", "P3", { live: true, perm: ["admin.vendors.view", "admin.vendors.approve", "admin.pricing.view", "admin.pricing.manage"] }),
    s("stock", "Stock", "Stock", "P3", { live: true }),
    s("orders", "Orders", "Encomendas", "P4", { live: true, perm: ["admin.orders.view", "admin.orders.manage"] }),
    s("performance", "Performance", "Desempenho", "P14", { live: true, perm: ["admin.vendors.view", "admin.vendors.approve"] }),
    s("contracts", "Contracts", "Contratos", "P14", { live: true, perm: ["admin.pricing.view", "admin.pricing.manage", "admin.vendors.view"] }),
    s("payments", "Payments", "Pagamentos", "P5", { live: true, perm: ["admin.finance.view"] }),
  ];
}

export const ADMIN_NAV: NavSection[] = [
  {
    key: "dashboard", icon: "LayoutDashboard", label: { en: "Dashboard", pt: "Painel", es: "Panel" },
    items: [
      dash("overview", "Executive Overview", "Visão Geral Executiva", "P1", { live: true }),
      dash("live-operations", "Live Operations", "Operações em Tempo Real", "P12", { live: true, perm: ["admin.dashboard.view", "admin.delivery.view", "admin.delivery.manage"] }),
      dash("kpi", "KPI & Performance", "KPI e Desempenho", "P14", { live: true, perm: ["admin.dashboard.view", "admin.finance.view", "admin.analytics.view"] }),
      dash("ai-insights", "AI Insights", "Insights de IA", "P17", { live: true, perm: ["admin.ai.view"] }),
      dash("alerts", "Alerts & Exceptions", "Alertas e Exceções", "P4", { live: true, perm: ["admin.orders.view", "admin.orders.manage"] }),
      dash("today", "Today's Activity", "Atividade de Hoje", "P4", { live: true, perm: ["admin.orders.view", "admin.orders.manage"] }),
    ],
  },
  {
    key: "orders", icon: "Package", label: { en: "Orders", pt: "Encomendas", es: "Pedidos" },
    items: [
      ord("all", "All Orders", "Todas as Encomendas", "P4", { live: true }),
      ord("new", "New Orders", "Novas Encomendas", "P4", { live: true }),
      ord("pending-confirmation", "Pending Confirmation", "A Aguardar Confirmação", "P4", { live: true }),
      ord("supplier-processing", "Supplier Processing", "Em Processamento no Fornecedor", "P4", { live: true }),
      ord("ready-for-pickup", "Ready for Pickup", "Pronta para Recolha", "P4", { live: true }),
      ord("dispatched", "Dispatched", "Expedida", "P4", { live: true }),
      ord("out-for-delivery", "Out for Delivery", "Em Distribuição", "P4", { live: true }),
      ord("delivered", "Delivered", "Entregue", "P4", { live: true }),
      ord("cancelled-returned", "Cancelled / Returned", "Canceladas / Devolvidas", "P4", { live: true }),
      ord("exceptions", "Order Exceptions", "Exceções de Encomendas", "P4", { live: true }),
      ord("split", "Order Split / Multi-Vendor Orders", "Divisão / Multi-Fornecedor", "P16", { live: true }),
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
          vm("onboarding", "Onboarding", "Integração", "P2", { live: true, perm: ["admin.vendors.view", "admin.vendors.approve"] }),
          vm("verification", "Verification", "Verificação", "P2", { live: true, perm: "admin.vendors.approve" }),
          vm("documents", "Documents", "Documentos", "P2", { live: true, perm: ["admin.vendors.view", "admin.vendors.approve"] }),
          vm("approval", "Approval", "Aprovação", "P2", { live: true, perm: "admin.vendors.approve" }),
          vm("commission", "Commission", "Comissões", "P5", { live: true, perm: ["admin.vendors.commission", "admin.finance.view"] }),
          vm("service-areas", "Service Areas", "Áreas de Serviço", "P6", { live: true, href: `${A}/delivery/zones`, perm: ["admin.delivery.view", "admin.vendors.view"] }),
          vm("rules", "Rules", "Regras", "P6", { live: true, href: `${A}/delivery/minimum-order`, perm: ["admin.delivery.view", "admin.vendors.view"] }),
          vm("ratings", "Ratings", "Avaliações", "P14", { live: true, perm: ["admin.vendors.view", "admin.customers.view"] }),
          vm("compliance", "Compliance", "Conformidade", "P2", { live: true, perm: ["admin.vendors.view", "admin.vendors.approve", "admin.risk.view"] }),
        ],
      },
    ],
  },
  {
    key: "customers", icon: "Users", label: { en: "Customers", pt: "Clientes", es: "Clientes" },
    items: [
      cus("all", "All Customers", "Todos os Clientes", "P2", { live: true, perm: ["admin.customers.view", "admin.customers.approve"] }),
      cus("businesses", "Wholesale Businesses", "Empresas Clientes", "P2", { live: true, perm: ["admin.customers.view", "admin.customers.approve"] }),
      cus("applications", "Customer Applications", "Candidaturas de Clientes", "P2", { live: true, perm: ["admin.customers.view", "admin.customers.approve"] }),
      cus("active", "Active Customers", "Clientes Ativos", "P2", { live: true, perm: ["admin.customers.view", "admin.customers.approve"] }),
      cus("groups", "Customer Groups", "Grupos de Clientes", "P3", { live: true, perm: ["admin.customers.view", "admin.customers.manage", "admin.pricing.view"] }),
      cus("pricing", "Customer Pricing", "Preços de Clientes", "P3", { live: true, perm: ["admin.customers.view", "admin.customers.manage", "admin.pricing.view", "admin.pricing.manage"] }),
      cus("credit", "Credit & Limits", "Crédito e Limites", "P5", { live: true, perm: ["admin.customers.manage", "admin.finance.view"] }),
      cus("addresses", "Customer Addresses", "Moradas de Clientes", "P2", { live: true, perm: ["admin.customers.view", "admin.customers.approve"] }),
      cus("purchase-history", "Purchase History", "Histórico de Compras", "P4", { live: true, perm: ["admin.orders.view", "admin.orders.manage"] }),
      cus("activity", "Customer Activity", "Atividade de Clientes", "P13", { live: true, perm: ["admin.customers.view", "admin.crm.view", "admin.crm.manage"] }),
      cus("support", "Customer Support", "Apoio ao Cliente", "P13", { live: true, perm: ["admin.support.manage", "admin.crm.view", "admin.customers.view"] }),
    ],
  },
  {
    key: "catalogue", icon: "ShoppingBag", label: { en: "Products & Catalogue", pt: "Produtos e Catálogo", es: "Productos y catálogo" },
    items: [
      cat("products", "Product Catalogue", "Catálogo de Produtos", "P3", { live: true }),
      cat("categories", "Categories", "Categorias", "P3", { live: true }),
      cat("brands", "Brands", "Marcas", "P3", { live: true }),
      cat("sku", "SKU Management", "Gestão de SKU", "P3", { live: true }),
      cat("variants", "Product Variants", "Variantes de Produto", "P3", { live: true }),
      cat("units", "Units & Packaging", "Unidades e Embalagens", "P3", { live: true }),
      cat("vendor-products", "Vendor Products", "Produtos de Fornecedores", "P3", { live: true }),
      cat("availability", "Product Availability", "Disponibilidade de Produtos", "P3", { live: true }),
      cat("stock", "Stock", "Stock", "P3", { live: true }),
      cat("pricing", "Product Pricing", "Preços de Produtos", "P3", { live: true, perm: ["admin.catalogue.view", "admin.pricing.view"] }),
      cat("customer-pricing", "Customer-Specific Pricing", "Preços por Cliente", "P3", { live: true, perm: ["admin.catalogue.view", "admin.pricing.view"] }),
      cat("promotions", "Promotions", "Promoções", "P5", { live: true, perm: ["admin.pricing.view", "admin.catalogue.view"] }),
      cat("approval", "Product Approval", "Aprovação de Produtos", "P3", { live: true, perm: "admin.catalogue.approve" }),
    ],
  },
  {
    key: "inventory", icon: "Warehouse", label: { en: "Inventory & Warehouses", pt: "Inventário e Armazéns", es: "Inventario y almacenes" },
    items: [
      invn("overview", "Inventory Overview", "Visão Geral do Inventário", "P24", { live: true }),
      invn("expiring", "Expiring Stock", "Stock a Expirar", "P24", { live: true }),
      invn("expiry-features", "Expiry Features", "Funcionalidades de Validade", "P24", { live: true }),
      invn("expiry-alerts", "Expiry Alerts", "Alertas de Validade", "P24", { live: true }),
    ],
  },
  {
    key: "allocation", icon: "Handshake", label: { en: "Supplier/Vendor Allocation", pt: "Alocação de Fornecedores", es: "Asignación de proveedores" },
    items: [
      alo("control-tower", "Allocation Control Tower", "Torre de Controlo de Alocação", "P9", { live: true }),
      alo("auto-allocation", "Auto Allocation", "Alocação Automática", "P9", { live: true }),
      alo("manual-allocation", "Manual Allocation", "Alocação Manual", "P9", { live: true }),
      alo("distributor-vs-wholesaler", "Distributor vs Wholesaler", "Distribuidor vs Grossista", "P9", { live: true }),
      alo("distance-rules", "Distance Rules", "Regras de Distância", "P9", { live: true }),
      alo("route-matching", "Route Matching", "Correspondência de Rotas", "P9", { live: true }),
      alo("existing-order-matching", "Existing Order Matching", "Correspondência com Encomendas", "P9", { live: true }),
      alo("margin-rules", "Margin Rules", "Regras de Margem", "P9", { live: true }),
      alo("stock-availability", "Stock Availability", "Disponibilidade de Stock", "P9", { live: true }),
      alo("delivery-capacity", "Delivery Capacity", "Capacidade de Entrega", "P9", { live: true }),
      alo("vendor-priority", "Vendor Priority", "Prioridade de Fornecedores", "P9", { live: true }),
      alo("allocation-history", "Allocation History", "Histórico de Alocação", "P9", { live: true }),
      alo("allocation-overrides", "Allocation Overrides", "Substituições de Alocação", "P9", { live: true }),
    ],
  },
  {
    key: "delivery", icon: "Truck", label: { en: "Delivery & Logistics", pt: "Entregas e Logística", es: "Entregas y logística" },
    items: [
      del("control-tower", "Delivery Control Tower", "Torre de Controlo de Entregas", "P6", { live: true, perm: ["admin.delivery.view", "admin.delivery.manage"] }),
      del("live", "Live Deliveries", "Entregas em Tempo Real", "P6", { live: true, perm: ["admin.delivery.view", "admin.delivery.manage"] }),
      del("drivers", "Drivers", "Motoristas", "P6", { live: true, perm: ["admin.fleet.view", "admin.fleet.manage", "admin.delivery.view"] }),
      del("vehicles", "Vehicles", "Veículos", "P6", { live: true, perm: ["admin.fleet.view", "admin.fleet.manage", "admin.delivery.view"] }),
      del("routes", "Routes", "Rotas", "P12", { live: true, perm: ["admin.delivery.view", "admin.delivery.manage"] }),
      del("multi-stop", "Multi-Stop Routes", "Rotas Multi-Paragem", "P12", { live: true, perm: ["admin.delivery.view", "admin.delivery.manage"] }),
      del("route-optimization", "Route Optimization", "Otimização de Rotas", "P12", { live: true, perm: ["admin.delivery.view", "admin.delivery.manage"] }),
      del("zones", "Delivery Zones", "Zonas de Entrega", "P6", { live: true, perm: ["admin.delivery.view", "admin.delivery.manage", "admin.international.view"] }),
      del("fees", "Delivery Fees", "Taxas de Entrega", "P4", { live: true }),
      del("minimum-order", "Minimum Order Rules", "Regras de Encomenda Mínima", "P4", { live: true }),
      del("eta", "ETA Management", "Gestão de ETA", "P12", { live: true, perm: ["admin.delivery.view", "admin.delivery.manage"] }),
      del("proof-of-delivery", "Proof of Delivery", "Comprovativo de Entrega", "P6", { live: true, perm: ["admin.delivery.view", "admin.delivery.manage"] }),
      del("failed", "Failed Deliveries", "Entregas Falhadas", "P6", { live: true, perm: ["admin.delivery.view", "admin.delivery.manage"] }),
      del("returns", "Returns", "Devoluções", "P6", { live: true, perm: ["admin.orders.view", "admin.orders.manage", "admin.delivery.view"] }),
      del("performance", "Delivery Performance", "Desempenho de Entregas", "P12", { live: true, perm: ["admin.delivery.view", "admin.delivery.manage", "admin.analytics.view"] }),
    ],
  },
  {
    key: "fleet", icon: "UserCog", label: { en: "Drivers & Fleet", pt: "Motoristas e Frota", es: "Conductores y flota" },
    items: [
      flt("admin-drivers", "Admin Driver List", "Motoristas FIRINGI", "P6", { live: true, perm: ["admin.fleet.view", "admin.fleet.manage", "admin.delivery.view"] }),
      flt("vendor-drivers", "Vendors Driver List", "Motoristas de Fornecedores", "P6", { live: true, perm: ["admin.fleet.view", "admin.fleet.manage", "admin.delivery.view"] }),
      flt("applications", "Driver Applications", "Candidaturas de Motoristas", "P2", { live: true, perm: ["admin.fleet.view", "admin.fleet.manage"] }),
      flt("availability", "Driver Availability", "Disponibilidade de Motoristas", "P6", { live: true, perm: ["admin.fleet.view", "admin.fleet.manage", "admin.delivery.view"] }),
      flt("assignments", "Driver Assignments", "Atribuições de Motoristas", "P6", { live: true, perm: ["admin.fleet.view", "admin.fleet.manage", "admin.delivery.view"] }),
      flt("vehicles", "Vehicle Management", "Gestão de Veículos", "P6", { live: true, perm: ["admin.fleet.view", "admin.fleet.manage", "admin.delivery.view"] }),
      flt("vehicle-registration", "Vehicle Registration", "Registo de Veículos", "P6", { live: true, href: `${A}/fleet/vehicles`, perm: ["admin.fleet.view", "admin.fleet.manage", "admin.delivery.view"] }),
      flt("documents", "Driver Documents", "Documentos de Motoristas", "P2", { live: true, perm: ["admin.fleet.view", "admin.fleet.manage"] }),
      flt("performance", "Driver Performance", "Desempenho de Motoristas", "P12", { live: true, perm: ["admin.fleet.view", "admin.fleet.manage", "admin.delivery.view"] }),
      flt("earnings", "Driver Earnings", "Ganhos de Motoristas", "P12", { live: true, perm: ["admin.fleet.view", "admin.fleet.manage", "admin.finance.view"] }),
    ],
  },
  {
    key: "pricing", icon: "Coins", label: { en: "Pricing & Commercial", pt: "Preços e Comercial", es: "Precios y comercial" },
    items: [
      prc("price-lists", "Price Lists", "Listas de Preços", "P3", { live: true }),
      prc("vendor", "Vendor Pricing", "Preços de Fornecedores", "P3", { live: true }),
      prc("customer", "Customer Pricing", "Preços de Clientes", "P3", { live: true }),
      prc("wholesale", "Wholesale Pricing", "Preços Grossista", "P3", { live: true }),
      prc("distributor", "Distributor Pricing", "Preços Distribuidor", "P3", { live: true }),
      prc("promotions", "Promotions", "Promoções", "P5", { live: true }),
      prc("discounts", "Discounts", "Descontos", "P5", { live: true }),
      prc("minimum-order", "Minimum Order Value", "Valor Mínimo de Encomenda", "P4", { live: true, perm: ["admin.pricing.view", "admin.delivery.view"] }),
      prc("delivery-fees", "Delivery Fee Rules", "Regras de Taxa de Entrega", "P4", { live: true, perm: ["admin.pricing.view", "admin.delivery.view"] }),
      prc("commission", "Commission Rules", "Regras de Comissão", "P5", { live: true, perm: ["admin.vendors.commission", "admin.finance.view"] }),
      prc("margin", "Margin Rules", "Regras de Margem", "P14", { live: true, perm: ["admin.pricing.view", "admin.pricing.manage"] }),
      prc("contract", "Contract Pricing", "Preços Contratuais", "P14", { live: true, perm: ["admin.pricing.view", "admin.pricing.manage", "admin.vendors.view"] }),
    ],
  },
  {
    key: "finance", icon: "Wallet", label: { en: "Finance", pt: "Finanças", es: "Finanzas" },
    items: [
      fin("overview", "Financial Overview", "Visão Financeira", "P5", { live: true }),
      fin("customer-payments", "Customer Payments", "Pagamentos de Clientes", "P5", { live: true }),
      fin("vendor-payments", "Vendor Payments", "Pagamentos a Fornecedores", "P5", { live: true }),
      fin("distributor-payments", "Distributor Payments", "Pagamentos a Distribuidores", "P5", { live: true }),
      fin("wholesaler-payments", "Wholesaler Payments", "Pagamentos a Grossistas", "P5", { live: true }),
      fin("commissions", "Commissions", "Comissões", "P5", { live: true }),
      fin("refunds", "Refunds", "Reembolsos", "P5", { live: true }),
      fin("credit-notes", "Credit Notes", "Notas de Crédito", "P5", { live: true }),
      fin("receivable", "Accounts Receivable", "Contas a Receber", "P5", { live: true }),
      fin("payable", "Accounts Payable", "Contas a Pagar", "P5", { live: true }),
      fin("profit-loss", "Profit & Loss", "Lucros e Perdas", "P14", { live: true, perm: ["admin.finance.view", "admin.finance.manage"] }),
      fin("cash-flow", "Cash Flow", "Fluxo de Caixa", "P14", { live: true, perm: ["admin.finance.view", "admin.finance.manage"] }),
      fin("payouts-due", "Supplier Payouts Due", "Pagamentos a Fornecedores Pendentes", "P18", { live: true, perm: ["admin.finance.view", "admin.finance.manage"] }),
      fin("online-payments", "Online Payments", "Pagamentos Online", "P20", { live: true, perm: ["admin.finance.view", "admin.finance.manage"] }),
      fin("direct-debit", "Direct Debit", "Débito Direto", "P20", { live: true, perm: ["admin.finance.view", "admin.finance.manage"] }),
      fin("accounting-export", "Accounting Export", "Exportação Contabilística", "P21", { live: true, perm: ["admin.finance.view", "admin.invoices.view"] }),
      fin("invoicing", "Certified Invoicing", "Faturação Certificada", "P18", { live: true, perm: ["admin.finance.view", "admin.tax.manage", "admin.settings.manage", "admin.invoices.view"] }),
    ],
  },
  {
    key: "invoices", icon: "Receipt", label: { en: "Invoices & Tax", pt: "Faturas e Impostos", es: "Facturas e impuestos" },
    items: [
      inv("customer", "Customer Invoices", "Faturas de Clientes", "P5", { live: true }),
      inv("vendor", "Vendor Invoices", "Faturas de Fornecedores", "P5", { live: true }),
      inv("distributor", "Distributor Invoices", "Faturas de Distribuidores", "P5", { live: true }),
      inv("wholesaler", "Wholesaler Invoices", "Faturas de Grossistas", "P5", { live: true }),
      inv("credit-notes", "Credit Notes", "Notas de Crédito", "P5", { live: true }),
      inv("vat", "VAT", "IVA", "P5", { live: true }),
      inv("tax-configuration", "Tax Configuration", "Configuração Fiscal", "P5", { live: true, perm: "admin.tax.manage" }),
      inv("settings", "Invoice Settings", "Definições de Faturação", "P5", { live: true, perm: "admin.tax.manage" }),
      inv("payment-status", "Payment Status", "Estado de Pagamento", "P5", { live: true }),
      inv("tax-reports", "Tax Reports", "Relatórios Fiscais", "P5", { live: true }),
      inv("saft", "SAF-T / Compliance", "SAF-T / Conformidade", "P11", { live: true, perm: ["admin.tax.manage", "admin.invoices.view"] }),
      inv("country-tax-rules", "Country Tax Rules", "Regras Fiscais por País", "P1", { live: true, href: `${A}/international/tax-rules` }),
    ],
  },
  {
    key: "analytics", icon: "BarChart3", label: { en: "Analytics & Reports", pt: "Análises e Relatórios", es: "Analítica e informes" },
    items: [
      ana("sales", "Sales Analytics", "Análise de Vendas", "P8", { live: true }),
      ana("revenue", "Revenue", "Receita", "P8", { live: true }),
      ana("gross-margin", "Gross Margin", "Margem Bruta", "P8", { live: true }),
      ana("net-profit", "Net Profit", "Lucro Líquido", "P14", { live: true, perm: ["admin.finance.view", "admin.finance.manage", "admin.analytics.view"] }),
      ana("orders", "Order Analytics", "Análise de Encomendas", "P8", { live: true }),
      ana("customers", "Customer Analytics", "Análise de Clientes", "P8", { live: true }),
      ana("vendors", "Vendor Analytics", "Análise de Fornecedores", "P8", { live: true }),
      ana("distributors", "Distributor Analytics", "Análise de Distribuidores", "P8", { live: true }),
      ana("wholesalers", "Wholesaler Analytics", "Análise de Grossistas", "P8", { live: true }),
      ana("products", "Product Analytics", "Análise de Produtos", "P8", { live: true }),
      ana("delivery", "Delivery Analytics", "Análise de Entregas", "P8", { live: true }),
      ana("route-profitability", "Route Profitability", "Rentabilidade de Rotas", "P14", { live: true, perm: ["admin.finance.view", "admin.finance.manage", "admin.analytics.view"] }),
      ana("country", "Country Performance", "Desempenho por País", "P8", { live: true }),
      ana("custom", "Custom Reports", "Relatórios Personalizados", "P8", { live: true }),
    ],
  },
  {
    key: "ai", icon: "Bot", label: { en: "AI Centre", pt: "Centro de IA", es: "Centro de IA" },
    items: [
      ai("assistant", "AI Business Assistant", "Assistente de Negócio IA", "P17", { live: true }),
      ai("supplier-recommendations", "Supplier Recommendations", "Recomendações de Fornecedores", "P17", { live: true }),
      ai("demand-forecasting", "Demand Forecasting", "Previsão de Procura", "P17", { live: true }),
      ai("stock-predictions", "Stock Predictions", "Previsões de Stock", "P17", { live: true }),
      ai("margin-opportunities", "Margin Opportunities", "Oportunidades de Margem", "P17", { live: true }),
      ai("delivery-risk", "Delivery Risk Detection", "Deteção de Risco de Entrega", "P17", { live: true }),
      ai("reorder-predictions", "Customer Reorder Predictions", "Previsões de Recompra", "P17", { live: true }),
      ai("fraud-alerts", "Fraud/Risk Alerts", "Alertas de Fraude/Risco", "P17", { live: true }),
      ai("route-optimization", "Route Optimization", "Otimização de Rotas", "P17", { live: true }),
      ai("recommendations", "Automated Recommendations", "Recomendações Automáticas", "P17", { live: true }),
      ai("activity-log", "AI Activity Log", "Registo de Atividade IA", "P17", { live: true }),
    ],
  },
  {
    key: "crm", icon: "Contact", label: { en: "CRM", pt: "CRM", es: "CRM" },
    items: [
      crm("leads", "Leads", "Leads", "P13", { live: true, perm: ["admin.crm.view", "admin.crm.manage"] }),
      crm("accounts", "Business Accounts", "Contas Empresariais", "P13", { live: true, perm: ["admin.crm.view", "admin.crm.manage"] }),
      crm("contacts", "Contacts", "Contactos", "P13", { live: true, perm: ["admin.crm.view", "admin.crm.manage"] }),
      crm("pipeline", "Sales Pipeline", "Pipeline de Vendas", "P13", { live: true, perm: ["admin.crm.view", "admin.crm.manage"] }),
      crm("segments", "Customer Segments", "Segmentos de Clientes", "P13", { live: true, perm: ["admin.crm.view", "admin.crm.manage"] }),
      crm("follow-ups", "Follow-ups", "Seguimentos", "P13", { live: true, perm: ["admin.crm.view", "admin.crm.manage"] }),
      crm("communications", "Communications", "Comunicações", "P13", { live: true, perm: ["admin.crm.view", "admin.crm.manage"] }),
      crm("notes", "Notes", "Notas", "P13", { live: true, perm: ["admin.crm.view", "admin.crm.manage"] }),
      crm("tasks", "Tasks", "Tarefas", "P13", { live: true, perm: ["admin.crm.view", "admin.crm.manage"] }),
      crm("performance", "Sales Performance", "Desempenho Comercial", "P13", { live: true, perm: ["admin.crm.view", "admin.crm.manage"] }),
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
      intl("country-pricing", "Country Pricing", "Preços por País", "P3", { live: true, perm: ["admin.pricing.view", "admin.pricing.manage"] }),
      intl("delivery-zones", "Delivery Zones", "Zonas de Entrega", "P6", { live: true, href: `${A}/delivery/zones`, perm: ["admin.delivery.view", "admin.international.view"] }),
      intl("vendors", "Country-Specific Vendors", "Fornecedores por País", "P2", { live: true, perm: ["admin.vendors.view", "admin.international.view"] }),
      intl("customers", "Country-Specific Customers", "Clientes por País", "P2", { live: true, perm: ["admin.customers.view", "admin.international.view"] }),
      intl("regional-managers", "Regional Managers", "Gestores Regionais", "P1", { live: true, href: `${A}/users/regional-managers`, perm: ["admin.users.view", "admin.users.manage"] }),
    ],
  },
  {
    key: "marketing", icon: "Megaphone", label: { en: "Marketing", pt: "Marketing", es: "Marketing" },
    items: [
      mkt("promotions", "Promotions", "Promoções", "P5", { live: true, perm: ["admin.marketing.view", "admin.pricing.view"] }),
      mkt("campaigns", "Campaigns", "Campanhas", "P15", { live: true, perm: ["admin.marketing.view", "admin.marketing.manage"] }),
      mkt("vendor-promotions", "Vendor Promotions", "Promoções de Fornecedores", "P5", { live: true, perm: ["admin.marketing.view", "admin.pricing.view"] }),
      mkt("customer-offers", "Customer Offers", "Ofertas a Clientes", "P15", { live: true, perm: ["admin.marketing.view", "admin.marketing.manage", "admin.pricing.view", "admin.pricing.manage"] }),
      mkt("coupons", "Coupons", "Cupões", "P15", { live: true, perm: ["admin.marketing.view", "admin.marketing.manage", "admin.pricing.view", "admin.pricing.manage"] }),
      mkt("push", "Push Notifications", "Notificações Push", "P15", { live: true, perm: ["admin.marketing.view", "admin.marketing.manage"] }),
      mkt("email", "Email Campaigns", "Campanhas de Email", "P15", { live: true, perm: ["admin.marketing.view", "admin.marketing.manage"] }),
      mkt("segments", "Customer Segments", "Segmentos de Clientes", "P15", { live: true, href: `${A}/crm/segments`, perm: ["admin.crm.view", "admin.crm.manage"] }),
      mkt("analytics", "Marketing Analytics", "Análise de Marketing", "P15", { live: true, perm: ["admin.marketing.view", "admin.marketing.manage", "admin.pricing.view"] }),
    ],
  },
  {
    key: "risk", icon: "ShieldCheck", label: { en: "Risk & Compliance", pt: "Risco e Conformidade", es: "Riesgo y cumplimiento" },
    items: [
      rsk("vendor-verification", "Vendor Verification", "Verificação de Fornecedores", "P2", { live: true, perm: ["admin.risk.view", "admin.vendors.approve"] }),
      rsk("customer-verification", "Customer Verification", "Verificação de Clientes", "P2", { live: true, perm: ["admin.risk.view", "admin.customers.approve"] }),
      rsk("kyc", "KYC/KYB", "KYC/KYB", "P2", { live: true }),
      rsk("documents", "Documents", "Documentos", "P2", { live: true, perm: ["admin.risk.view", "admin.risk.manage"] }),
      rsk("fraud", "Fraud Detection", "Deteção de Fraude", "P16", { live: true, perm: ["admin.risk.view", "admin.risk.manage"] }),
      rsk("suspicious-orders", "Suspicious Orders", "Encomendas Suspeitas", "P16", { live: true, perm: ["admin.risk.view", "admin.risk.manage"] }),
      rsk("payment-risk", "Payment Risk", "Risco de Pagamento", "P11", { live: true, perm: ["admin.finance.view", "admin.finance.manage", "admin.risk.view"] }),
      rsk("compliance", "Compliance", "Conformidade", "P2", { live: true, perm: ["admin.risk.view", "admin.risk.manage", "admin.customers.approve"] }),
      rsk("audit-trail", "Audit Trail", "Trilho de Auditoria", "P1", { live: true, perm: "admin.audit.view" }),
      rsk("data-privacy", "Data Privacy", "Privacidade de Dados", "P11", { live: true, perm: ["admin.users.manage", "admin.settings.manage"] }),
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
      usr("approval-workflows", "Approval Workflows", "Fluxos de Aprovação", "P16", { live: true, perm: ["admin.users.view", "admin.users.manage", "admin.finance.view", "admin.settings.view", "admin.marketing.manage", "admin.customers.manage"] }),
    ],
  },
  {
    key: "notifications", icon: "Bell", label: { en: "Notifications & Communications", pt: "Notificações e Comunicações", es: "Notificaciones y comunicaciones" },
    items: [
      ntf("all", "Notifications", "Notificações", "P7", { live: true, perm: ["admin.notifications.view", "admin.notifications.manage"] }),
      ntf("email", "Email", "Email", "P7", { live: true, perm: ["admin.notifications.view", "admin.notifications.manage"] }),
      ntf("sms", "SMS", "SMS", "P7", { live: true, perm: ["admin.notifications.view", "admin.notifications.manage"] }),
      ntf("push", "Push Notifications", "Notificações Push", "P7", { live: true, perm: ["admin.notifications.view", "admin.notifications.manage"] }),
      ntf("whatsapp", "WhatsApp Integration", "Integração WhatsApp", "P7", { live: true, perm: ["admin.notifications.view", "admin.notifications.manage"] }),
      ntf("customer-messages", "Customer Messages", "Mensagens de Clientes", "P7", { live: true, perm: ["admin.notifications.view", "admin.notifications.manage", "admin.messages.manage"] }),
      ntf("vendor-messages", "Vendor Messages", "Mensagens de Fornecedores", "P7", { live: true, perm: ["admin.notifications.view", "admin.notifications.manage", "admin.messages.manage"] }),
      ntf("driver-messages", "Driver Messages", "Mensagens de Motoristas", "P7", { live: true, perm: ["admin.notifications.view", "admin.notifications.manage", "admin.messages.manage"] }),
      ntf("templates", "Notification Templates", "Modelos de Notificação", "P7", { live: true, perm: ["admin.notifications.view", "admin.notifications.manage"] }),
    ],
  },
  {
    key: "settings", icon: "Settings", label: { en: "Settings", pt: "Definições", es: "Ajustes" },
    items: [
      set("company", "Company Settings", "Definições da Empresa", "P1", { live: true }),
      set("marketplace", "Marketplace Settings", "Definições do Marketplace", "P11", { live: true, perm: ["admin.settings.view", "admin.settings.manage"] }),
      set("orders", "Order Settings", "Definições de Encomendas", "P11", { live: true, perm: ["admin.settings.view", "admin.settings.manage"] }),
      set("vendors", "Vendor Settings", "Definições de Fornecedores", "P11", { live: true, perm: ["admin.settings.view", "admin.settings.manage"] }),
      set("customers", "Customer Settings", "Definições de Clientes", "P11", { live: true, perm: ["admin.settings.view", "admin.settings.manage"] }),
      set("delivery", "Delivery Settings", "Definições de Entrega", "P6", { live: true, perm: ["admin.settings.view", "admin.settings.manage"] }),
      set("payment", "Payment Settings", "Definições de Pagamento", "P11", { live: true, perm: ["admin.settings.view", "admin.settings.manage", "admin.finance.manage"] }),
      set("invoice", "Invoice Settings", "Definições de Faturação", "P5", { live: true, perm: ["admin.settings.view", "admin.tax.manage"] }),
      set("tax", "Tax Settings", "Definições Fiscais", "P5", { live: true, perm: ["admin.settings.view", "admin.tax.manage"] }),
      set("currency", "Currency Settings", "Definições de Moeda", "P1", { live: true, href: `${A}/international/currency`, perm: ["admin.settings.view", "admin.international.view"] }),
      set("language", "Language Settings", "Definições de Idioma", "P1", { live: true, href: `${A}/international/languages`, perm: ["admin.settings.view", "admin.international.view"] }),
      set("api", "API Keys", "Chaves de API", "P11", { live: true, perm: ["admin.settings.view", "admin.settings.manage"] }),
      set("integrations", "Integrations", "Integrações", "P21", { live: true, perm: ["admin.settings.view", "admin.settings.manage"] }),
      set("security", "Security", "Segurança", "P11", { live: true, perm: ["admin.settings.view", "admin.settings.manage"] }),
      set("audit-logs", "Audit Logs", "Registos de Auditoria", "P1", { live: true, perm: ["admin.audit.view", "admin.settings.view"] }),
      set("system-health", "System Health", "Saúde do Sistema", "P19", { live: true, perm: ["admin.settings.view", "admin.settings.manage"] }),
    ],
  },
];
