/** Smaller navigations for the vendor (Sell), buyer (Buy) and driver portals. */
import { section, type NavSection } from "./types";

const V = "/vendor";
const vd = section(`${V}/dashboard`, "vendor.dashboard.view");
const vp = section(`${V}/products`, "vendor.products.view");
const vo = section(`${V}/orders`, "vendor.orders.view");
const vf = section(`${V}/finance`, "vendor.invoices.view");
const vfl = section(`${V}/fleet`, "vendor.fleet.view");
const vc = section(`${V}/company`, "company.profile.manage");
const vr = section(`${V}/reports`, "vendor.reports.view");
const vs = section(`${V}`, "company.support.use");

export const VENDOR_NAV: NavSection[] = [
  { key: "dashboard", icon: "LayoutDashboard", label: { en: "Dashboard", pt: "Painel", es: "Panel" }, items: [vd("overview", "Overview", "Visão Geral", "P1", { live: true, es: "Resumen" })] },
  {
    key: "products", icon: "ShoppingBag", label: { en: "Products", pt: "Produtos", es: "Productos" },
    items: [
      vp("catalogue", "My Products", "Os Meus Produtos", "P3", { live: true, es: "Mis productos" }),
      vp("stock", "Stock", "Stock", "P3", { live: true, perm: ["vendor.stock.manage", "vendor.products.view"], es: "Stock" }),
      vp("price-lists", "Price Lists", "Listas de Preços", "P3", { live: true, perm: "vendor.pricing.manage", es: "Listas de precios" }),
      vp("customer-groups", "Customer Groups", "Grupos de Clientes", "P3", { live: true, perm: "vendor.pricing.manage", es: "Grupos de clientes" }),
      vp("promotions", "Promotions", "Promoções", "P5", { live: true, perm: "vendor.promotions.manage", es: "Promociones" }),
    ],
  },
  {
    key: "orders", icon: "Package", label: { en: "Orders", pt: "Encomendas", es: "Pedidos" },
    items: [
      vo("incoming", "Incoming Orders", "Encomendas Recebidas", "P4", { live: true, es: "Pedidos recibidos" }),
      vo("history", "Order History", "Histórico", "P4", { live: true, es: "Historial" }),
      vo("returns", "Returns", "Devoluções", "P6", { live: true, es: "Devoluciones" }),
    ],
  },
  {
    key: "finance", icon: "Receipt", label: { en: "Finance", pt: "Finanças", es: "Finanzas" },
    items: [
      vf("statements", "Billing Statements", "Extratos de Faturação", "P5", { live: true, es: "Extractos de facturación" }),
      vf("invoices", "My Invoices to FIRINGI", "As Minhas Faturas à FIRINGI", "P5", { live: true, perm: ["vendor.invoices.view", "vendor.invoices.submit"], es: "Mis facturas a FIRINGI" }),
      vf("payments", "Payments", "Pagamentos", "P5", { live: true, perm: "vendor.payments.view", es: "Pagos" }),
      vf("commission", "Commission", "Comissão", "P5", { live: true, perm: ["vendor.invoices.view", "vendor.payments.view"], es: "Comisión" }),
    ],
  },
  {
    key: "fleet", icon: "Truck", label: { en: "Delivery & Fleet", pt: "Entregas e Frota", es: "Entregas y flota" },
    items: [
      vfl("deliveries", "Deliveries", "Entregas", "P6", { live: true, perm: ["vendor.orders.view", "vendor.fleet.view"], es: "Entregas" }),
      vfl("routes", "Routes", "Rotas", "P12", { live: true, perm: ["vendor.orders.manage", "vendor.drivers.manage"], es: "Rutas" }),
      vfl("drivers", "Drivers", "Motoristas", "P6", { live: true, perm: ["vendor.fleet.view", "vendor.drivers.manage"], es: "Conductores" }),
      vfl("vehicles", "Vehicles", "Veículos", "P6", { live: true, perm: ["vendor.fleet.view", "vendor.vehicles.manage"], es: "Vehículos" }),
      vfl("service-areas", "Service Areas", "Áreas de Serviço", "P6", { live: true, perm: ["vendor.service_areas.manage", "vendor.fleet.view"], es: "Áreas de servicio" }),
      vfl("delivery-rules", "Delivery Minimum", "Mínimo de Entrega", "P4", { live: true, perm: "vendor.service_areas.manage", es: "Mínimo de entrega" }),
    ],
  },
  { key: "reports", icon: "BarChart3", label: { en: "Reports", pt: "Relatórios", es: "Informes" }, items: [vr("sales", "Sales Report", "Relatório de Vendas", "P8", { live: true, es: "Informe de ventas" })] },
  { key: "help", icon: "LifeBuoy", label: { en: "Help & Support", pt: "Ajuda e Suporte", es: "Ayuda y soporte" }, items: [vs("support", "Help & Support", "Ajuda e Suporte", "P13", { live: true, es: "Ayuda y soporte" })] },
  {
    key: "company", icon: "Building2", label: { en: "Company", pt: "Empresa", es: "Empresa" },
    items: [
      vc("profile", "Profile", "Perfil", "P2", { live: true, es: "Perfil" }),
      vc("addresses", "Warehouse & Pickup Addresses", "Moradas de Armazém e Recolha", "P2", { live: true, perm: "company.addresses.manage", es: "Direcciones" }),
      vc("documents", "Documents", "Documentos", "P2", { live: true, perm: "company.documents.manage", es: "Documentos" }),
      vc("users", "Users", "Utilizadores", "P1", { live: true, perm: ["team.users.view", "team.users.manage"], es: "Usuarios" }),
      vc("roles", "Roles & Permissions", "Funções e Permissões", "P1", { live: true, perm: ["team.users.view", "team.roles.manage"], es: "Roles y permisos" }),
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

export const BUY_NAV: NavSection[] = [
  { key: "dashboard", icon: "LayoutDashboard", label: { en: "Dashboard", pt: "Painel", es: "Panel" }, items: [bd("overview", "Overview", "Visão Geral", "P1", { live: true, es: "Resumen" })] },
  {
    key: "catalogue", icon: "ShoppingBag", label: { en: "Catalogue", pt: "Catálogo", es: "Catálogo" },
    items: [
      bc("browse", "Shop", "Loja", "P3", { live: true, es: "Tienda" }),
      bc("suppliers", "Suppliers", "Fornecedores", "P3", { live: true, es: "Proveedores" }),
    ],
  },
  {
    key: "orders", icon: "Package", label: { en: "Orders", pt: "Encomendas", es: "Pedidos" },
    items: [
      bo("cart", "Cart", "Carrinho", "P4", { live: true, perm: "buyer.orders.place", es: "Carrito" }),
      bo("history", "My Orders", "As Minhas Encomendas", "P4", { live: true, es: "Mis pedidos" }),
      bo("returns", "Returns", "Devoluções", "P6", { live: true, perm: "buyer.orders.view", es: "Devoluciones" }),
    ],
  },
  {
    key: "finance", icon: "Receipt", label: { en: "Invoices & Payments", pt: "Faturas e Pagamentos", es: "Facturas y pagos" },
    items: [
      bf("invoices", "Invoices", "Faturas", "P5", { live: true, es: "Facturas" }),
      bf("payments", "Payments", "Pagamentos", "P5", { live: true, perm: "buyer.payments.view", es: "Pagos" }),
    ],
  },
  { key: "reports", icon: "BarChart3", label: { en: "Reports", pt: "Relatórios", es: "Informes" }, items: [br("spending", "Spending Report", "Relatório de Compras", "P8", { live: true, es: "Informe de compras" })] },
  { key: "help", icon: "LifeBuoy", label: { en: "Help & Support", pt: "Ajuda e Suporte", es: "Ayuda y soporte" }, items: [bs("support", "Help & Support", "Ajuda e Suporte", "P13", { live: true, es: "Ayuda y soporte" })] },
  {
    key: "company", icon: "Building2", label: { en: "Company", pt: "Empresa", es: "Empresa" },
    items: [
      bco("profile", "Profile", "Perfil", "P2", { live: true, es: "Perfil" }),
      bco("addresses", "Delivery Addresses", "Moradas de Entrega", "P2", { live: true, perm: ["buyer.addresses.manage", "company.addresses.manage"], es: "Direcciones de entrega" }),
      bco("documents", "Documents", "Documentos", "P2", { live: true, perm: "company.documents.manage", es: "Documentos" }),
      bco("restricted-products", "Tobacco & Alcohol Access", "Acesso a Tabaco e Álcool", "P2", { live: true, perm: "buyer.compliance.manage", es: "Acceso a tabaco y alcohol" }),
      bco("users", "Users", "Utilizadores", "P1", { live: true, perm: ["team.users.view", "team.users.manage"], es: "Usuarios" }),
      bco("roles", "Roles & Permissions", "Funções e Permissões", "P1", { live: true, perm: ["team.users.view", "team.roles.manage"], es: "Roles y permisos" }),
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
    ],
  },
];
