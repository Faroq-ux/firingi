/** Smaller navigations for the vendor (Sell), buyer (Buy) and driver portals. */
import { section, type NavSection } from "./types";

const V = "/vendor";
const vd = section(`${V}/dashboard`, "vendor.dashboard.view");
const vp = section(`${V}/products`, "vendor.products.view");
const vo = section(`${V}/orders`, "vendor.orders.view");
const vf = section(`${V}/finance`, "vendor.invoices.view");
const vfl = section(`${V}/fleet`, "vendor.fleet.view");
const vc = section(`${V}/company`, "company.profile.manage");

export const VENDOR_NAV: NavSection[] = [
  { key: "dashboard", icon: "LayoutDashboard", label: { en: "Dashboard", pt: "Painel", es: "Panel" }, items: [vd("overview", "Overview", "Visão Geral", "P1", { live: true, es: "Resumen" })] },
  {
    key: "products", icon: "ShoppingBag", label: { en: "Products", pt: "Produtos", es: "Productos" },
    items: [
      vp("catalogue", "My Products", "Os Meus Produtos", "P3", { es: "Mis productos" }),
      vp("stock", "Stock", "Stock", "P3", { perm: ["vendor.stock.manage", "vendor.products.view"], es: "Stock" }),
      vp("price-lists", "Price Lists", "Listas de Preços", "P3", { perm: "vendor.pricing.manage", es: "Listas de precios" }),
      vp("customer-groups", "Customer Groups", "Grupos de Clientes", "P3", { perm: "vendor.pricing.manage", es: "Grupos de clientes" }),
      vp("promotions", "Promotions", "Promoções", "P5", { perm: "vendor.promotions.manage", es: "Promociones" }),
    ],
  },
  {
    key: "orders", icon: "Package", label: { en: "Orders", pt: "Encomendas", es: "Pedidos" },
    items: [
      vo("incoming", "Incoming Orders", "Encomendas Recebidas", "P4", { es: "Pedidos recibidos" }),
      vo("history", "Order History", "Histórico", "P4", { es: "Historial" }),
    ],
  },
  {
    key: "finance", icon: "Receipt", label: { en: "Finance", pt: "Finanças", es: "Finanzas" },
    items: [
      vf("statements", "Billing Statements", "Extratos de Faturação", "P5", { es: "Extractos de facturación" }),
      vf("invoices", "My Invoices to FIRINGI", "As Minhas Faturas à FIRINGI", "P5", { perm: ["vendor.invoices.view", "vendor.invoices.submit"], es: "Mis facturas a FIRINGI" }),
      vf("payments", "Payments", "Pagamentos", "P5", { perm: "vendor.payments.view", es: "Pagos" }),
      vf("commission", "Commission", "Comissão", "P5", { es: "Comisión" }),
    ],
  },
  {
    key: "fleet", icon: "Truck", label: { en: "Delivery & Fleet", pt: "Entregas e Frota", es: "Entregas y flota" },
    items: [
      vfl("drivers", "Drivers", "Motoristas", "P6", { es: "Conductores" }),
      vfl("vehicles", "Vehicles", "Veículos", "P6", { es: "Vehículos" }),
      vfl("service-areas", "Service Areas", "Áreas de Serviço", "P6", { perm: "vendor.service_areas.manage", es: "Áreas de servicio" }),
      vfl("delivery-rules", "Delivery Rules", "Regras de Entrega", "P6", { perm: "vendor.service_areas.manage", es: "Reglas de entrega" }),
    ],
  },
  {
    key: "company", icon: "Building2", label: { en: "Company", pt: "Empresa", es: "Empresa" },
    items: [
      vc("profile", "Profile", "Perfil", "P2", { es: "Perfil" }),
      vc("addresses", "Warehouse & Pickup Addresses", "Moradas de Armazém e Recolha", "P2", { perm: "company.addresses.manage", es: "Direcciones" }),
      vc("documents", "Documents", "Documentos", "P2", { perm: "company.documents.manage", es: "Documentos" }),
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

export const BUY_NAV: NavSection[] = [
  { key: "dashboard", icon: "LayoutDashboard", label: { en: "Dashboard", pt: "Painel", es: "Panel" }, items: [bd("overview", "Overview", "Visão Geral", "P1", { live: true, es: "Resumen" })] },
  {
    key: "catalogue", icon: "ShoppingBag", label: { en: "Catalogue", pt: "Catálogo", es: "Catálogo" },
    items: [
      bc("browse", "Browse Products", "Explorar Produtos", "P3", { es: "Explorar productos" }),
      bc("suppliers", "Suppliers", "Fornecedores", "P3", { es: "Proveedores" }),
    ],
  },
  {
    key: "orders", icon: "Package", label: { en: "Orders", pt: "Encomendas", es: "Pedidos" },
    items: [
      bo("cart", "Cart", "Carrinho", "P4", { perm: "buyer.orders.place", es: "Carrito" }),
      bo("history", "My Orders", "As Minhas Encomendas", "P4", { es: "Mis pedidos" }),
    ],
  },
  {
    key: "finance", icon: "Receipt", label: { en: "Invoices & Payments", pt: "Faturas e Pagamentos", es: "Facturas y pagos" },
    items: [
      bf("invoices", "Invoices", "Faturas", "P5", { es: "Facturas" }),
      bf("payments", "Payments", "Pagamentos", "P5", { perm: "buyer.payments.view", es: "Pagos" }),
    ],
  },
  {
    key: "company", icon: "Building2", label: { en: "Company", pt: "Empresa", es: "Empresa" },
    items: [
      bco("profile", "Profile", "Perfil", "P2", { es: "Perfil" }),
      bco("addresses", "Delivery Addresses", "Moradas de Entrega", "P2", { perm: ["buyer.addresses.manage", "company.addresses.manage"], es: "Direcciones de entrega" }),
      bco("documents", "Documents", "Documentos", "P2", { perm: "company.documents.manage", es: "Documentos" }),
      bco("restricted-products", "Tobacco & Alcohol Access", "Acesso a Tabaco e Álcool", "P2", { perm: "buyer.compliance.manage", es: "Acceso a tabaco y alcohol" }),
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
      dr("today", "Today's Deliveries", "Entregas de Hoje", "P6", { es: "Entregas de hoy" }),
      dr("history", "History", "Histórico", "P6", { es: "Historial" }),
    ],
  },
];
