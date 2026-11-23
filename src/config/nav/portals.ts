/** Smaller navigations for the vendor (Sell), buyer (Buy) and driver portals. */
import { section, type NavSection } from "./types";

/** The optional accounting section (Phase 27) — same pages in the buy and sell portals; FIRINGI switches it on per company. */
function ACCOUNTING_ITEMS(s: ReturnType<typeof section>) {
  return [
    s("overview", "Accounting Dashboard", "Painel de Contabilidade", "P27", { live: true, feature: "ACCOUNTING", es: "Panel de contabilidad" }),
    s("sales", "Daily Sales", "Vendas Diárias", "P27", { live: true, feature: "ACCOUNTING", es: "Ventas diarias" }),
    s("expenses", "Expenses", "Despesas", "P27", { live: true, feature: "ACCOUNTING", es: "Gastos" }),
    s("profit-loss", "Profit & Loss", "Lucros e Perdas", "P27", { live: true, feature: "ACCOUNTING", es: "Pérdidas y ganancias" }),
  ];
}

/** Staff shifts & time (Phase 52) — customers in /buy, suppliers in /vendor; FIRINGI switches it per type and per business. */
function STAFF_ITEMS(s: ReturnType<typeof section>) {
  const mgr = ["company.staff.manage", "team.users.manage"] as const;
  return [
    s("me", "My Shifts & Hours", "Os Meus Turnos e Horas", "P52", { live: true, feature: "STAFF", es: "Mis turnos y horas" }),
    s("", "Who's In", "Quem Está", "P52", { live: true, feature: "STAFF_MGR", perm: [...mgr], href: `${s("", "", "", "P52").href.replace(/\/$/, "")}`, es: "Quién está" }),
    s("rota", "Rota", "Escala", "P52", { live: true, feature: "STAFF", es: "Cuadrante" }),
    s("clock", "Clock-in Kiosk", "Quiosque de Ponto", "P52", { live: true, feature: "STAFF", perm: [...mgr, "company.staff.kiosk", "company.pos.sell", "company.pos.manage"], es: "Quiosco de fichaje" }),
    s("timesheets", "Timesheets", "Folhas de Horas", "P52", { live: true, feature: "STAFF_MGR", perm: [...mgr], es: "Hojas de horas" }),
    s("leave", "Leave & Swaps", "Férias e Trocas", "P52", { live: true, feature: "STAFF_MGR", perm: [...mgr], es: "Ausencias y cambios" }),
    s("people", "Staff", "Pessoal", "P52", { live: true, feature: "STAFF_MGR", perm: [...mgr], es: "Personal" }),
  ];
}

/** The till (Phase 47) — same pages in both portals; FIRINGI switches it on per company type, country and company. */
function POS_ITEMS(s: ReturnType<typeof section>, customer: boolean) {
  const sell = ["company.pos.sell", "company.pos.manage"] as const;
  return [
    s("till", "Till", "Caixa", "P47", { live: true, feature: "POS", perm: [...sell], es: "Caja" }),
    s("", "Till Overview", "Resumo da Caixa", "P47", { live: true, feature: "POS", perm: [...sell], href: `${s("", "", "", "P47").href.replace(/\/$/, "")}`, es: "Resumen de caja" }),
    s("items", customer ? "Menu & Recipes" : "Till Items", customer ? "Menu e Receitas" : "Artigos da Caixa", "P47", { live: true, feature: "POS", perm: [...sell], es: customer ? "Menú y recetas" : "Artículos de caja" }),
    s("sales", "Till Sales", "Vendas da Caixa", "P47", { live: true, feature: "POS", perm: [...sell], es: "Ventas de caja" }),
    s("shifts", "Shifts (X/Z)", "Turnos (X/Z)", "P47", { live: true, feature: "POS", perm: [...sell], es: "Turnos (X/Z)" }),
    s("reports", "Till Reports", "Relatórios da Caixa", "P47", { live: true, feature: "POS", perm: [...sell], es: "Informes de caja" }),
    ...(customer ? [s("stock", "Ingredient Stock", "Stock de Ingredientes", "P47", { live: true, feature: "POS", perm: "company.pos.manage", es: "Stock de ingredientes" })] : []),
    s("guests", "Guests & Loyalty", "Clientes e Fidelização", "P47", { live: true, feature: "POS", perm: [...sell], es: "Clientes y fidelización" }),
    s("staff", "Till Staff", "Equipa da Caixa", "P47", { live: true, feature: "POS", perm: [...sell], es: "Personal de caja" }),
    s("settings", "Till Settings", "Definições da Caixa", "P47", { live: true, feature: "POS", perm: "company.pos.manage", es: "Ajustes de caja" }),
  ];
}

const V = "/vendor";
const vd = section(`${V}/dashboard`, "vendor.dashboard.view");
const vp = section(`${V}/products`, "vendor.products.view");
const vo = section(`${V}/orders`, "vendor.orders.view");
const vf = section(`${V}/finance`, "vendor.invoices.view");
const vfl = section(`${V}/fleet`, "vendor.fleet.view");
const vc = section(`${V}/company`, "company.profile.manage");
const vr = section(`${V}/reports`, "vendor.reports.view");
const vs = section(`${V}`, "company.support.use");
const vai = section(`${V}`, ["vendor.reports.view", "vendor.dashboard.view"]);
const vac = section(`${V}/accounting`, ["company.accounting.view", "company.accounting.manage"]);
const vin = section(`${V}/inventory`, ["vendor.inventory.view", "vendor.inventory.manage", "vendor.purchasing.manage"]);
const vpl = section(`${V}/inventory/planning`, ["vendor.inventory.view", "vendor.inventory.manage", "vendor.purchasing.manage"]);
const vad = section(`${V}/ads`, "vendor.promotions.manage");
const vpos = section(`${V}/pos`, ["company.pos.sell", "company.pos.manage"]);
const vrp = section(`${V}/reps`, ["vendor.reps.manage", "vendor.reps.field"]);
const vcs = section(`${V}/consignment`, ["vendor.consignment.manage", "vendor.consignment.count"]);
const vvn = section(`${V}/van`, ["vendor.vansales.manage", "vendor.vansales.sell"]);
const vst = section(`${V}/staff`, ["vendor.dashboard.view", "company.support.use", "company.pos.sell", "company.staff.manage", "company.staff.kiosk", "team.users.view"]);
const vsv = section(`${V}/services`, ["vendor.services.manage", "vendor.services.visit"]);
const vwh = section(`${V}/warehouse`, ["vendor.inventory.view", "vendor.inventory.manage", "vendor.warehouse.pick", "vendor.recalls.manage"]);

export const VENDOR_NAV: NavSection[] = [
  { key: "dashboard", icon: "LayoutDashboard", label: { en: "Dashboard", pt: "Painel", es: "Panel" }, items: [vd("overview", "Overview", "Visão Geral", "P1", { live: true, es: "Resumen" })] },
  {
    key: "products", icon: "ShoppingBag", label: { en: "Products", pt: "Produtos", es: "Productos" },
    items: [
      vp("catalogue", "My Products", "Os Meus Produtos", "P3", { live: true, es: "Mis productos" }),
      vp("stock", "Stock", "Stock", "P3", { live: true, perm: ["vendor.stock.manage", "vendor.products.view"], es: "Stock" }),
      vp("price-lists", "Price Lists", "Listas de Preços", "P3", { live: true, perm: "vendor.pricing.manage", es: "Listas de precios" }),
      vp("price-insights", "Price Insights", "Análise de Preços", "P29", { live: true, feature: "PRICE_INSIGHTS", perm: ["vendor.pricing.manage", "vendor.products.view", "vendor.products.manage"], es: "Análisis de precios" }),
      vp("assortments", "Customer Assortments", "Sortidos de Clientes", "P64", { live: true, feature: "ASSORTMENTS", perm: ["vendor.pricing.manage", "vendor.products.view"], es: "Surtidos por cliente" }),
      vp("customer-groups", "Customer Groups", "Grupos de Clientes", "P3", { live: true, perm: "vendor.pricing.manage", es: "Grupos de clientes" }),
      vp("promotions", "Promotions", "Promoções", "P5", { live: true, perm: "vendor.promotions.manage", es: "Promociones" }),
      vp("deals", "Clearance Deals", "Oportunidades", "P38", { live: true, perm: ["vendor.promotions.manage", "vendor.pricing.manage"], es: "Oportunidades" }),
      vp("buying-groups", "Buying Groups", "Grupos de Compra", "P49", { live: true, perm: ["vendor.pricing.manage", "vendor.promotions.manage"], es: "Grupos de compra" }),
      vp("rebates", "Rebates & Bonuses", "Rappel e Bónus", "P48", { live: true, perm: ["vendor.promotions.manage", "vendor.pricing.manage", "vendor.reports.view"], es: "Rappels y bonificaciones" }),
      vp("rewards", "Reward Products", "Produtos de Recompensa", "P55", { live: true, feature: "REWARDS_SUPPLIER", perm: "vendor.promotions.manage", es: "Productos de Recompensa" }),
      vp("rewards/handover", "Rewards to Hand Over", "Recompensas a Entregar", "P55", { live: true, feature: "REWARDS_SUPPLIER", perm: "vendor.promotions.manage", es: "Recompensas por Entregar" }),
      vp("returnables", "Returnables", "Vasilhame e Tara", "P40", { live: true, perm: ["vendor.products.manage", "vendor.products.view"], es: "Envases retornables" }),
      vp("weights", "Sold by Weight", "Venda ao Peso", "P41", { live: true, perm: ["vendor.products.manage", "vendor.products.view"], es: "Venta al peso" }),
      vp("temperature", "Temperature", "Temperatura", "P42", { live: true, perm: ["vendor.products.manage", "vendor.products.view"], es: "Temperatura" }),
      vp("excise", "Licensed Goods", "Produtos Licenciados", "P43", { live: true, perm: ["vendor.products.manage", "vendor.products.view"], es: "Productos con licencia" }),
      vp("co2", "CO₂ & Packaging", "CO₂ e Embalagem", "P51", { live: true, perm: ["vendor.products.manage", "vendor.pricing.manage"], es: "CO₂ y envases" }),
      vp("food", "Food Information", "Informação Alimentar", "P44", { live: true, perm: ["vendor.products.manage", "vendor.products.view"], es: "Información alimentaria" }),
      vp("customs", "Customs Codes", "Códigos Aduaneiros", "P57", { live: true, perm: ["vendor.products.manage", "vendor.products.view"], es: "Códigos aduaneros" }),
      vp("reviews", "Reviews", "Avaliações", "P53", { live: true, href: `${V}/reviews`, feature: "REVIEWS", perm: "vendor.reviews.manage", es: "Valoraciones" }),
      vp("questions", "Product Questions", "Perguntas sobre Produtos", "P53", { live: true, href: `${V}/reviews/questions`, feature: "REVIEWS", perm: "vendor.reviews.manage", es: "Preguntas sobre productos" }),
      vp("review-insights", "Review Insights", "Análise das Avaliações", "P53", { live: true, href: `${V}/reviews/insights`, feature: "REVIEWS", perm: "vendor.reviews.manage", es: "Análisis de valoraciones" }),
      vp("import", "Import & Sync", "Importar e Sincronizar", "P21", { live: true, feature: "INTEGRATIONS", perm: ["vendor.products.manage", "vendor.pricing.manage", "vendor.stock.manage"], es: "Importar y sincronizar" }),
    ],
  },
  {
    key: "ads", icon: "Megaphone", label: { en: "Advertising", pt: "Publicidade", es: "Publicidad" },
    items: [
      vad("", "My Ads", "Os Meus Anúncios", "P34", { live: true, href: `${V}/ads`, feature: "ADS", es: "Mis anuncios" }),
      vad("new", "New Ad", "Novo Anúncio", "P34", { live: true, feature: "ADS", es: "Nuevo anuncio" }),
      vad("billing", "Ad Billing", "Faturação de Anúncios", "P34", { live: true, feature: "ADS", es: "Facturación de anuncios" }),
    ],
  },
  {
    key: "inventory", icon: "Warehouse", label: { en: "Inventory", pt: "Inventário", es: "Inventario" },
    items: [
      vin("overview", "Stock & Batches", "Stock e Lotes", "P24", { live: true, feature: "INVENTORY", es: "Stock y lotes" }),
      vin("expiry", "Expiry", "Validades", "P24", { live: true, feature: "INVENTORY", es: "Caducidad" }),
      vin("purchase-orders", "Purchase Orders", "Notas de Encomenda", "P24", { live: true, feature: "INVENTORY", perm: ["vendor.purchasing.manage", "vendor.inventory.view", "vendor.inventory.manage"], es: "Órdenes de compra" }),
      vin("suppliers", "My Suppliers", "Os Meus Fornecedores", "P24", { live: true, feature: "INVENTORY", perm: ["vendor.purchasing.manage", "vendor.inventory.view", "vendor.inventory.manage"], es: "Mis proveedores" }),
      vin("reorder", "Reorder", "Reaprovisionamento", "P24", { live: true, feature: "INVENTORY", es: "Reposición" }),
      vin("counts", "Stock Counts", "Contagens de Stock", "P24", { live: true, feature: "INVENTORY", perm: ["vendor.inventory.view", "vendor.inventory.manage"], es: "Recuentos de stock" }),
      vin("transfers", "Transfers", "Transferências", "P24", { live: true, feature: "INVENTORY", perm: ["vendor.inventory.view", "vendor.inventory.manage"], es: "Transferencias" }),
      vin("movements", "Stock Movements", "Movimentos de Stock", "P24", { live: true, feature: "INVENTORY", es: "Movimientos de stock" }),
      vin("valuation", "Valuation", "Valorização", "P24", { live: true, feature: "INVENTORY", perm: ["vendor.inventory.view", "vendor.inventory.manage", "vendor.reports.view"], es: "Valoración" }),
    ],
  },
  {
    key: "planning", icon: "TrendingUp", label: { en: "Planning", pt: "Planeamento", es: "Planificación" },
    items: [
      vpl("", "Planning Overview", "Visão do Planeamento", "P30", { live: true, feature: "PLANNING", href: `${V}/inventory/planning`, es: "Resumen de planificación" }),
      vpl("forecast", "Demand Forecast", "Previsão da Procura", "P30", { live: true, feature: "PLANNING", es: "Previsión de la demanda" }),
      vpl("restock", "Restock", "Reposição", "P30", { live: true, feature: "PLANNING", es: "Reposición" }),
      vpl("risk", "Overstock & Expiry", "Excesso e Validades", "P30", { live: true, feature: "PLANNING", es: "Exceso y caducidad" }),
      vpl("lead-times", "Lead Times", "Prazos de Entrega", "P30", { live: true, feature: "PLANNING", es: "Plazos de entrega" }),
      vpl("events", "Demand Events", "Eventos de Procura", "P30", { live: true, feature: "PLANNING", es: "Eventos de demanda" }),
      vpl("settings", "Planning Settings", "Definições de Planeamento", "P30", { live: true, feature: "PLANNING", es: "Ajustes de planificación" }),
    ],
  },
  {
    key: "warehouse", icon: "ScanBarcode", label: { en: "Warehouse", pt: "Armazém", es: "Almacén" },
    items: [
      vwh("pick", "Pick & Pack", "Preparação e Embalagem", "P25", { live: true, feature: "PICK_PACK", perm: ["vendor.warehouse.pick", "vendor.inventory.manage", "vendor.inventory.view"], es: "Preparación y embalaje" }),
      vwh("scan", "Scanner", "Leitor", "P25", { live: true, feature: "SCAN", perm: ["vendor.warehouse.pick", "vendor.inventory.manage", "vendor.inventory.view"], es: "Escáner" }),
      vwh("shelves", "Shelves", "Prateleiras", "P25", { live: true, feature: "BINS", perm: ["vendor.warehouse.pick", "vendor.inventory.manage", "vendor.inventory.view"], es: "Estanterías" }),
      vwh("trace", "Traceability", "Rastreabilidade", "P25", { live: true, feature: "TRACE", perm: ["vendor.inventory.view", "vendor.inventory.manage", "vendor.recalls.manage"], es: "Trazabilidad" }),
      vwh("recalls", "Recalls", "Recolhas", "P25", { live: true, feature: "WAREHOUSE", perm: ["vendor.inventory.view", "vendor.inventory.manage", "vendor.recalls.manage"], es: "Retiradas" }),
    ],
  },
  {
    key: "orders", icon: "Package", label: { en: "Orders", pt: "Encomendas", es: "Pedidos" },
    items: [
      vo("incoming", "Incoming Orders", "Encomendas Recebidas", "P4", { live: true, es: "Pedidos recibidos" }),
      vo("history", "Order History", "Histórico", "P4", { live: true, es: "Historial" }),
      vcs("", "Consignment Stock", "Stock à Consignação", "P65", { live: true, href: `${V}/consignment`, feature: "CONSIGNMENT", perm: ["vendor.consignment.manage", "vendor.consignment.count"], es: "Stock en depósito" }),
      vo("quotes", "Quote Requests", "Pedidos de Orçamento", "P26", { live: true, perm: ["vendor.pricing.manage", "vendor.orders.manage", "vendor.orders.view"], es: "Solicitudes de presupuesto" }),
      vo("tenders", "Tenders", "Concursos", "P50", { live: true, perm: ["vendor.pricing.manage", "vendor.orders.manage"], es: "Licitaciones" }),
      vo("returns", "Returns", "Devoluções", "P6", { live: true, es: "Devoluciones" }),
      vo("empties", "Empties & Deposits", "Vasilhame e Depósitos", "P40", { live: true, es: "Envases y depósitos" }),
      vo("excise-report", "Excise Report", "Relatório de IEC", "P43", { live: true, perm: ["vendor.orders.view", "vendor.orders.manage", "vendor.reports.view"], es: "Informe de impuestos especiales" }),
      vo("weighing", "Weighing", "Pesagem", "P41", { live: true, es: "Pesaje" }),
      vo("substitutions", "Replacements", "Substituições", "P60", { live: true, perm: ["vendor.orders.view", "vendor.orders.manage", "vendor.products.manage"], es: "Sustituciones" }),
      vo("claims", "Quality Claims", "Reclamações de Qualidade", "P31", { live: true, perm: ["vendor.claims.respond", "vendor.orders.view"], es: "Reclamaciones de calidad" }),
      vo("claims/quality", "Quality Score", "Índice de Qualidade", "P31", { live: true, perm: ["vendor.claims.respond", "vendor.orders.view"], es: "Índice de calidad" }),
      vo("messages", "Messages", "Mensagens", "P35", { live: true, perm: ["vendor.orders.view", "vendor.orders.manage"], es: "Mensajes", feature: "CHAT" }),
    ],
  },
  {
    key: "finance", icon: "Receipt", label: { en: "Finance", pt: "Finanças", es: "Finanzas" },
    items: [
      vf("statements", "Billing Statements", "Extratos de Faturação", "P5", { live: true, es: "Extractos de facturación" }),
      vf("invoices", "My Invoices to FIRINGI", "As Minhas Faturas à FIRINGI", "P5", { live: true, perm: ["vendor.invoices.view", "vendor.invoices.submit"], es: "Mis facturas a FIRINGI" }),
      vf("payments", "Payments", "Pagamentos", "P5", { live: true, perm: "vendor.payments.view", es: "Pagos" }),
      vf("commission", "Commission", "Comissão", "P5", { live: true, perm: ["vendor.invoices.view", "vendor.payments.view"], es: "Comisión" }),
      vf("early-payout", "Early Payout", "Pagamento Antecipado", "P36", { live: true, perm: ["vendor.invoices.view", "vendor.payments.view"], es: "Pago anticipado" }),
      vf("bank", "Bank", "Banco", "P37", { live: true, perm: ["company.bank.view", "company.bank.manage"], es: "Banco" }),
      vf("exports", "Exports", "Exportações", "P21", { live: true, feature: "INTEGRATIONS", perm: ["vendor.invoices.view", "vendor.invoices.submit", "vendor.payments.view"], es: "Exportaciones" }),
    ],
  },
  {
    key: "fleet", icon: "Truck", label: { en: "Delivery & Fleet", pt: "Entregas e Frota", es: "Entregas y flota" },
    items: [
      vfl("deliveries", "Deliveries", "Entregas", "P6", { live: true, perm: ["vendor.orders.view", "vendor.fleet.view"], es: "Entregas" }),
      vfl("routes", "Routes", "Rotas", "P12", { live: true, feature: "ROUTES", perm: ["vendor.orders.manage", "vendor.drivers.manage"], es: "Rutas" }),
      vfl("drivers", "Drivers", "Motoristas", "P6", { live: true, perm: ["vendor.fleet.view", "vendor.drivers.manage"], es: "Conductores" }),
      vfl("vehicles", "Vehicles", "Veículos", "P6", { live: true, perm: ["vendor.fleet.view", "vendor.vehicles.manage"], es: "Vehículos" }),
      vfl("service-areas", "Service Areas", "Áreas de Serviço", "P6", { live: true, perm: ["vendor.service_areas.manage", "vendor.fleet.view"], es: "Áreas de servicio" }),
      vfl("delivery-rules", "Delivery Minimum", "Mínimo de Entrega", "P4", { live: true, perm: "vendor.service_areas.manage", es: "Mínimo de entrega" }),
      vfl("cold-chain", "Cold Chain", "Cadeia de Frio", "P42", { live: true, perm: ["vendor.orders.view", "vendor.orders.manage", "vendor.fleet.view", "vendor.inventory.view"], es: "Cadena de frío" }),
    ],
  },
  {
    key: "reps", icon: "Handshake", label: { en: "Sales Reps", pt: "Vendedores", es: "Comerciales" },
    items: [
      vrp("my-day", "My Day", "O Meu Dia", "P62", { live: true, feature: "SALES_REP_ME", perm: "vendor.reps.field", es: "Mi día" }),
      vrp("my-customers", "My Customers", "Os Meus Clientes", "P62", { live: true, feature: "SALES_REP_ME", perm: "vendor.reps.field", es: "Mis clientes" }),
      vrp("my-orders", "Orders I Took", "Encomendas que Registei", "P62", { live: true, feature: "SALES_REP_ME", perm: "vendor.reps.field", es: "Pedidos que tomé" }),
      vrp("", "Sales Team", "Equipa Comercial", "P62", { live: true, href: `${V}/reps`, feature: "SALES_REPS", perm: "vendor.reps.manage", es: "Equipo comercial" }),
      vrp("customers", "Rep Customers", "Clientes por Vendedor", "P62", { live: true, feature: "SALES_REPS", perm: "vendor.reps.manage", es: "Clientes por comercial" }),
      vrp("visits", "Visit Plan & Map", "Plano e Mapa de Visitas", "P62", { live: true, feature: "SALES_REPS", perm: "vendor.reps.manage", es: "Plan y mapa de visitas" }),
    ],
  },
  {
    key: "van", icon: "Truck", label: { en: "Van Sales", pt: "Vendas na Carrinha", es: "Venta en ruta" },
    items: [
      vvn("sell", "Sell from Van", "Vender da Carrinha", "P63", { live: true, feature: "VAN_SALES", perm: ["vendor.vansales.sell", "vendor.vansales.manage"], es: "Vender desde la furgoneta" }),
      vvn("", "Van Loads", "Cargas das Carrinhas", "P63", { live: true, href: `${V}/van`, feature: "VAN_SALES", perm: "vendor.vansales.manage", es: "Cargas de furgonetas" }),
    ],
  },
  {
    key: "services", icon: "Recycle", label: { en: "Services", pt: "Serviços", es: "Servicios" },
    items: [vsv("", "Services", "Serviços", "P68", { live: true, href: `${V}/services`, feature: "SERVICES_PROVIDER", es: "Servicios" })],
  },
  { key: "reports", icon: "BarChart3", label: { en: "Reports", pt: "Relatórios", es: "Informes" }, items: [vr("sales", "Sales Report", "Relatório de Vendas", "P8", { live: true, es: "Informe de ventas" }), vr("demand", "Demand & Stock", "Procura e Stock", "P17", { live: true, es: "Demanda y stock" }), vr("co2", "CO₂ Footprint", "Pegada de CO₂", "P51", { live: true, perm: ["vendor.reports.view", "vendor.orders.view", "vendor.products.manage"], es: "Huella de CO₂" }), vr("eu-trade", "EU Trade Report", "Relatório Intracomunitário", "P57", { live: true, perm: ["vendor.reports.view", "vendor.invoices.view", "vendor.orders.view"], es: "Informe intracomunitario" })] },
  { key: "pos", icon: "Calculator", label: { en: "Till (POS)", pt: "Caixa (POS)", es: "Caja (TPV)" }, items: POS_ITEMS(vpos, false) },
  { key: "staff", icon: "CalendarClock", label: { en: "Staff & Time", pt: "Pessoal e Horários", es: "Personal y horarios" }, items: STAFF_ITEMS(vst) },
  { key: "accounting", icon: "BookOpenCheck", label: { en: "Accounting", pt: "Contabilidade", es: "Contabilidad" }, items: ACCOUNTING_ITEMS(vac) },
  { key: "assistant", icon: "Bot", label: { en: "Assistant", pt: "Assistente", es: "Asistente" }, items: [vai("assistant", "Assistant", "Assistente", "P17", { live: true, feature: "ASSISTANT", es: "Asistente" })] },
  { key: "help", icon: "LifeBuoy", label: { en: "Help & Support", pt: "Ajuda e Suporte", es: "Ayuda y soporte" }, items: [vs("support", "Help & Support", "Ajuda e Suporte", "P13", { live: true, es: "Ayuda y soporte" })] },
  {
    key: "company", icon: "Building2", label: { en: "Company", pt: "Empresa", es: "Empresa" },
    items: [
      vc("profile", "Profile", "Perfil", "P2", { live: true, es: "Perfil" }),
      vc("storefront", "Storefront", "Loja Online", "P61", { live: true, perm: ["company.profile.manage", "vendor.products.manage", "vendor.products.view"], es: "Tienda online" }),
      vc("addresses", "Warehouse & Pickup Addresses", "Moradas de Armazém e Recolha", "P2", { live: true, perm: "company.addresses.manage", es: "Direcciones" }),
      vc("documents", "Documents", "Documentos", "P2", { live: true, perm: "company.documents.manage", es: "Documentos" }),
      vc("compliance", "Certificates & Compliance", "Certificados e Conformidade", "P28", { live: true, perm: ["company.documents.manage", "company.profile.manage", "vendor.products.view", "vendor.products.manage"], es: "Certificados y cumplimiento" }),
      vc("plan", "Plan & Billing", "Plano e Faturação", "P36", { live: true, perm: ["company.profile.manage", "vendor.invoices.view"], es: "Plan y facturación" }),
      vc("users", "Users", "Utilizadores", "P1", { live: true, perm: ["team.users.view", "team.users.manage"], es: "Usuarios" }),
      vc("roles", "Roles & Permissions", "Funções e Permissões", "P1", { live: true, perm: ["team.users.view", "team.roles.manage"], es: "Roles y permisos" }),
      vc("integrations", "Integrations", "Integrações", "P21", { live: true, feature: "INTEGRATIONS", perm: "company.integrations.manage", es: "Integraciones" }),
      vc("e-invoicing", "E-Invoicing", "Faturação Eletrónica", "P46", { live: true, perm: ["company.profile.manage", "company.accounting.manage", "vendor.invoices.view", "vendor.invoices.submit"], es: "Facturación electrónica" }),
    ],
  },
];

const B = "/buy";
const bd = section(`${B}/dashboard`, "buyer.dashboard.view");
const bc = section(`${B}/catalogue`, "buyer.catalogue.view");
const bo = section(`${B}/orders`, ["buyer.orders.view", "buyer.orders.place"]);
const bf = section(`${B}/finance`, "buyer.invoices.view");
const bco = section(`${B}/company`, "company.profile.manage");
const br = section(`${B}/reports`, "buyer.reports.view");
const bs = section(`${B}`, "company.support.use");
const bai = section(`${B}`, ["buyer.orders.view", "buyer.orders.place"]);
const bsh = section(`${B}/branches`, ["buyer.branches.manage", "buyer.orders.view", "buyer.orders.place", "buyer.reports.view"]);
const bac = section(`${B}/accounting`, ["company.accounting.view", "company.accounting.manage"]);
const bpos = section(`${B}/pos`, ["company.pos.sell", "company.pos.manage"]);
const bk = section(`${B}/kitchen`, ["buyer.kitchen.manage", "buyer.kitchen.waste"]);
const bsv = section(`${B}/services`, ["buyer.services.manage", "buyer.services.log"]);
const bst = section(`${B}/staff`, ["buyer.dashboard.view", "company.support.use", "company.pos.sell", "company.staff.manage", "company.staff.kiosk", "team.users.view"]);

export const BUY_NAV: NavSection[] = [
  { key: "dashboard", icon: "LayoutDashboard", label: { en: "Dashboard", pt: "Painel", es: "Panel" }, items: [bd("overview", "Overview", "Visão Geral", "P1", { live: true, es: "Resumen" })] },
  {
    key: "catalogue", icon: "ShoppingBag", label: { en: "Catalogue", pt: "Catálogo", es: "Catálogo" },
    items: [
      bc("browse", "Shop", "Loja", "P3", { live: true, es: "Tienda" }),
      bc("suppliers", "Suppliers", "Fornecedores", "P3", { live: true, es: "Proveedores" }),
      bc("clearance", "Clearance Deals", "Oportunidades", "P38", { live: true, es: "Oportunidades" }),
      bc("deals", "My Offers", "As Minhas Ofertas", "P15", { live: true, es: "Mis ofertas" }),
      bc("price-changes", "Price Changes", "Alterações de Preço", "P29", { live: true, es: "Cambios de precio" }),
      bc("allergens", "Allergens & Food Info", "Alergénios e Info Alimentar", "P44", { live: true, es: "Alérgenos e info alimentaria" }),
    ],
  },
  {
    key: "orders", icon: "Package", label: { en: "Orders", pt: "Encomendas", es: "Pedidos" },
    items: [
      bo("cart", "Cart", "Carrinho", "P4", { live: true, perm: "buyer.orders.place", es: "Carrito" }),
      bo("history", "My Orders", "As Minhas Encomendas", "P4", { live: true, es: "Mis pedidos" }),
      bo("buy-again", "Buy Again", "Comprar de Novo", "P17", { live: true, perm: "buyer.orders.place", es: "Volver a comprar" }),
      bo("scan", "Scan to Reorder", "Ler e Encomendar", "P39", { live: true, perm: "buyer.orders.place", es: "Escanear y pedir" }),
      bo("empties", "Empties & Deposits", "Vasilhame e Depósitos", "P40", { live: true, es: "Envases y depósitos" }),
      bo("receiving", "Receiving Log", "Registo de Receção", "P42", { live: true, es: "Registro de recepción" }),
      bo("expiring", "Expiring Purchases", "Compras a Expirar", "P24", { live: true, es: "Compras por caducar" }),
      bo("recalls", "Product Recalls", "Recolhas de Produtos", "P25", { live: true, es: "Retiradas de productos" }),
      bo("quotes", "Quotes", "Orçamentos", "P26", { live: true, es: "Presupuestos" }),
      bo("tenders", "Tenders", "Concursos", "P50", { live: true, perm: ["buyer.orders.view", "buyer.orders.place"], es: "Licitaciones" }),
      bo("recurring", "Recurring Orders", "Encomendas Recorrentes", "P26", { live: true, es: "Pedidos recurrentes" }),
      bo("rep-orders", "Orders from Sales Reps", "Encomendas dos Vendedores", "P62", { live: true, feature: "REP_ORDERS", perm: ["buyer.orders.place", "buyer.orders.view"], es: "Pedidos de comerciales" }),
      bo("must-stock", "Must-Stock List", "Lista de Stock Obrigatório", "P64", { live: true, feature: "MUST_STOCK", perm: ["buyer.orders.place", "buyer.orders.view"], es: "Lista de surtido obligatorio" }),
      bo("consignment", "Consignment Stock", "Stock à Consignação", "P65", { live: true, feature: "CONSIGNMENT_BUY", perm: ["buyer.orders.place", "buyer.orders.view"], es: "Stock en depósito" }),
      bo("van", "Bought from Vans", "Compras à Carrinha", "P63", { live: true, feature: "VAN_PURCHASES", perm: ["buyer.orders.place", "buyer.orders.view"], es: "Compras en furgoneta" }),
      bo("substitutions", "Replacements", "Substituições", "P60", { live: true, perm: ["buyer.orders.place", "buyer.orders.view"], es: "Sustituciones" }),
      bo("lists", "Order Lists", "Listas de Encomenda", "P26", { live: true, es: "Listas de pedidos" }),
      bo("approvals", "Approvals", "Aprovações", "P26", { live: true, perm: ["buyer.orders.place", "buyer.orders.view", "buyer.orders.approve"], es: "Aprobaciones" }),
      bo("returns", "Returns", "Devoluções", "P6", { live: true, perm: "buyer.orders.view", es: "Devoluciones" }),
      bo("reviews", "My Reviews", "As Minhas Avaliações", "P53", { live: true, href: `${B}/reviews`, feature: "REVIEWS", perm: ["buyer.reviews.write", "buyer.orders.view"], es: "Mis valoraciones" }),
      bo("claims", "Quality Claims", "Reclamações de Qualidade", "P31", { live: true, perm: ["buyer.claims.manage", "buyer.orders.view"], es: "Reclamaciones de calidad" }),
      bo("messages", "Messages", "Mensagens", "P35", { live: true, perm: ["buyer.orders.view", "buyer.orders.place"], es: "Mensajes", feature: "CHAT" }),
    ],
  },
  {
    key: "finance", icon: "Receipt", label: { en: "Invoices & Payments", pt: "Faturas e Pagamentos", es: "Facturas y pagos" },
    items: [
      bf("invoices", "Invoices", "Faturas", "P5", { live: true, es: "Facturas" }),
      bf("payments", "Payments", "Pagamentos", "P5", { live: true, perm: "buyer.payments.view", es: "Pagos" }),
      bf("bank", "Bank", "Banco", "P37", { live: true, perm: ["company.bank.view", "company.bank.manage"], es: "Banco" }),
      bf("pay-later", "Pay Later", "Pagar Mais Tarde", "P50", { live: true, perm: ["buyer.invoices.view", "buyer.orders.place"], es: "Pagar más tarde" }),
      bf("direct-debit", "Direct Debit", "Débito Direto", "P20", { live: true, perm: ["buyer.payments.make", "buyer.payments.view"], es: "Domiciliación bancaria" }),
      bf("exports", "Exports", "Exportações", "P21", { live: true, perm: ["buyer.invoices.view", "buyer.payments.view"], es: "Exportaciones" }),
    ],
  },
  {
    key: "shops", icon: "Store", label: { en: "My Shops", pt: "As Minhas Lojas", es: "Mis tiendas" },
    items: [
      bsh("", "Shops", "Lojas", "P27", { live: true, href: `${B}/branches`, es: "Tiendas" }),
      bsh("budgets", "Budgets", "Orçamentos de Compras", "P27", { live: true, es: "Presupuestos de compras" }),
      bsh("reports", "Shop Reports", "Relatórios por Loja", "P27", { live: true, perm: ["buyer.reports.view", "buyer.branches.manage"], es: "Informes por tienda" }),
    ],
  },
  { key: "pos", icon: "Calculator", label: { en: "Till (POS)", pt: "Caixa (POS)", es: "Caja (TPV)" }, items: POS_ITEMS(bpos, true) },
  {
    key: "kitchen", icon: "ChefHat", label: { en: "Kitchen", pt: "Cozinha", es: "Cocina" },
    items: [
      bk("", "Kitchen Overview", "Resumo da Cozinha", "P54", { live: true, href: `${B}/kitchen`, feature: "KITCHEN", es: "Resumen de cocina" }),
      bk("recipes", "Recipes & Costing", "Receitas e Custos", "P54", { live: true, feature: "KITCHEN_MGR", perm: "buyer.kitchen.manage", es: "Recetas y costes" }),
      bk("ingredients", "Ingredients", "Ingredientes", "P54", { live: true, feature: "KITCHEN_MGR", perm: "buyer.kitchen.manage", es: "Ingredientes" }),
      bk("engineering", "Menu Engineering", "Engenharia de Menu", "P54", { live: true, feature: "KITCHEN_MGR", perm: "buyer.kitchen.manage", es: "Ingeniería de menú" }),
      bk("waste", "Waste Log", "Registo de Desperdício", "P54", { live: true, feature: "KITCHEN", es: "Registro de desperdicio" }),
      bk("waste/reports", "Waste Reports", "Relatórios de Desperdício", "P54", { live: true, feature: "KITCHEN_MGR", perm: "buyer.kitchen.manage", es: "Informes de desperdicio" }),
      bk("use-first", "Use First", "Usar Primeiro", "P54", { live: true, feature: "KITCHEN_MGR", perm: "buyer.kitchen.manage", es: "Usar primero" }),
      bk("donations", "Donations", "Doações", "P54", { live: true, feature: "KITCHEN", es: "Donaciones" }),
    ],
  },
  {
    key: "services", icon: "Recycle", label: { en: "Services", pt: "Serviços", es: "Servicios" },
    items: [
      bsv("", "My Services", "Os Meus Serviços", "P68", { live: true, href: `${B}/services`, feature: "SERVICES", es: "Mis servicios" }),
      bsv("oil", "Fryers & Oil", "Fritadeiras e Óleo", "P68", { live: true, feature: "SERVICES_OIL", es: "Freidoras y aceite" }),
    ],
  },
  { key: "staff", icon: "CalendarClock", label: { en: "Staff & Time", pt: "Pessoal e Horários", es: "Personal y horarios" }, items: STAFF_ITEMS(bst) },
  { key: "accounting", icon: "BookOpenCheck", label: { en: "Accounting", pt: "Contabilidade", es: "Contabilidad" }, items: ACCOUNTING_ITEMS(bac) },
  { key: "reports", icon: "BarChart3", label: { en: "Reports", pt: "Relatórios", es: "Informes" }, items: [br("spending", "Spending Report", "Relatório de Compras", "P8", { live: true, es: "Informe de compras" }), br("co2", "CO₂ Footprint", "Pegada de CO₂", "P51", { live: true, perm: ["buyer.reports.view", "buyer.orders.view", "buyer.orders.place"], es: "Huella de CO₂" })] },
  { key: "rewards", icon: "Gift", label: { en: "Rewards", pt: "Recompensas", es: "Recompensas" }, items: [bai("rewards", "Rewards", "Recompensas", "P32", { live: true, feature: "LOYALTY", es: "Recompensas" }), bai("rewards/shop", "Rewards Shop", "Loja de Recompensas", "P55", { live: true, feature: "REWARDS_SHOP", es: "Tienda de Recompensas" }), bai("rewards/mine", "My Rewards", "As Minhas Recompensas", "P55", { live: true, feature: "REWARDS_SHOP", es: "Mis Recompensas" }), bai("rewards/bonuses", "My Bonuses", "Os Meus Bónus", "P48", { live: true, perm: ["buyer.orders.view", "buyer.orders.place", "buyer.invoices.view"], es: "Mis bonificaciones" })] },
  { key: "groups", icon: "Users", label: { en: "Buying Groups", pt: "Grupos de Compra", es: "Grupos de compra" }, items: [bai("groups", "Buying Groups", "Grupos de Compra", "P49", { live: true, perm: ["buyer.orders.view", "buyer.orders.place", "company.profile.manage"], es: "Grupos de compra" })] },
  { key: "assistant", icon: "Bot", label: { en: "Assistant", pt: "Assistente", es: "Asistente" }, items: [bai("assistant", "Assistant", "Assistente", "P17", { live: true, feature: "ASSISTANT", es: "Asistente" })] },
  { key: "help", icon: "LifeBuoy", label: { en: "Help & Support", pt: "Ajuda e Suporte", es: "Ayuda y soporte" }, items: [bs("support", "Help & Support", "Ajuda e Suporte", "P13", { live: true, es: "Ayuda y soporte" })] },
  {
    key: "company", icon: "Building2", label: { en: "Company", pt: "Empresa", es: "Empresa" },
    items: [
      bco("profile", "Profile", "Perfil", "P2", { live: true, es: "Perfil" }),
      bco("addresses", "Delivery Addresses", "Moradas de Entrega", "P2", { live: true, perm: ["buyer.addresses.manage", "company.addresses.manage"], es: "Direcciones de entrega" }),
      bco("documents", "Documents", "Documentos", "P2", { live: true, perm: "company.documents.manage", es: "Documentos" }),
      bco("restricted-products", "Tobacco & Alcohol Access", "Acesso a Tabaco e Álcool", "P2", { live: true, perm: "buyer.compliance.manage", es: "Acceso a tabaco y alcohol" }),
      bco("licences", "Licences", "Licenças", "P43", { live: true, perm: ["buyer.compliance.manage", "company.documents.manage", "buyer.orders.place"], es: "Licencias" }),
      bco("users", "Users", "Utilizadores", "P1", { live: true, perm: ["team.users.view", "team.users.manage"], es: "Usuarios" }),
      bco("roles", "Roles & Permissions", "Funções e Permissões", "P1", { live: true, perm: ["team.users.view", "team.roles.manage"], es: "Roles y permisos" }),
      bco("integrations", "Integrations", "Integrações", "P21", { live: true, perm: "company.integrations.manage", es: "Integraciones" }),
      bco("e-invoicing", "E-Invoicing", "Faturação Eletrónica", "P46", { live: true, perm: ["company.profile.manage", "company.accounting.manage", "buyer.invoices.view"], es: "Facturación electrónica" }),
      bco("whatsapp", "Order by WhatsApp", "Encomendar por WhatsApp", "P58", { live: true, perm: ["buyer.orders.view", "buyer.orders.place", "company.profile.manage"], feature: "WHATSAPP_ORDERING", es: "Pedir por WhatsApp" }),
    ],
  },
];

const D = "/driver";
const dr = section(`${D}/deliveries`, "driver.deliveries.view");
export const DRIVER_NAV: NavSection[] = [
  {
    key: "deliveries", icon: "Truck", label: { en: "Deliveries", pt: "Entregas", es: "Entregas" },
    items: [
      dr("today", "Today's Deliveries", "Entregas de Hoje", "P6", { live: true, es: "Entregas de hoy" }),
      dr("history", "History", "Histórico", "P6", { live: true, es: "Historial" }),
      dr("messages", "Messages", "Mensagens", "P35", { live: true, es: "Mensajes" }),
    ],
  },
];
