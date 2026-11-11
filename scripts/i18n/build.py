"""
Build src/messages/<lang>.json from scripts/i18n/<lang>.txt.

<lang>.txt holds one translated line per non-empty English message, in the order printed by
`python3 scripts/i18n/build.py --source` (namespaces flattened, then navLabels). The builder
checks the line count and that every {placeholder} survives, then writes the nested JSON.
  python3 scripts/i18n/build.py fr de it ...
"""
import json, re, sys, pathlib
ROOT = pathlib.Path(__file__).resolve().parents[2]
EN = json.loads((ROOT / "src/messages/en.json").read_text())
NAV = ["Dashboard", "Overview", "Products", "My Products", "Stock", "Price Lists", "Customer Groups", "Promotions",
       "Orders", "Incoming Orders", "Order History", "Finance", "Billing Statements", "My Invoices to FIRINGI", "Payments",
       "Commission", "Delivery & Fleet", "Vehicles", "Drivers", "Service Areas", "Delivery Minimum", "Company", "Profile",
       "Warehouse & Pickup Addresses", "Documents", "Users", "Roles & Permissions", "Shop", "Suppliers", "Cart", "My Orders",
       "Invoices & Payments", "Invoices", "Delivery Addresses", "Tobacco & Alcohol Access", "Deliveries", "Today's Deliveries",
       "History", "Catalogue"]

def flat(d, p=""):
    for k, v in d.items():
        if isinstance(v, dict): yield from flat(v, p + k + ".")
        else: yield p + k, v

# Namespaces / nav labels added after the first translation round are appended at the end,
# in this order, so existing <lang>.txt files only grow at the bottom.
# An entry may name a dotted path (e.g. "notify.order_reallocated"): those keys are left out of
# their namespace's earlier block and appended at that point instead.
LATER = [("delivery", ["Returns"]), ("notify", []), ("notifications", []), ("reports", ["Reports", "Sales Report", "Spending Report"]),
         ("notify.order_reallocated", []), ("notify.allocation_needed", []),
         ("orders.movedFrom", []), ("orders.movedTo", []), ("orders.passedOn", []),
         ("notify.order_supplier_unavailable", []), ("catalogue.firingiMode", []), ("catalogue.soldByFiringi", []),
         ("orders.routedCart", []), ("orders.notAvailableHere", []),
         ("orders.deliveryOrder", []), ("orders.deliveryOrderFromFiringi", []), ("orders.decision", []), ("deliveryOrder", []),
         ("auth.codeTitle", []), ("auth.codeHint", []), ("auth.backupHint", []), ("auth.code", []), ("auth.verify", []), ("auth.useBackup", []), ("auth.useApp", []), ("auth.badCode", []), ("security", []), ("privacy", []), ("finance.howToPay", []), ("finance.payByTransfer", []), ("finance.payByMbWay", []), ("finance.payOnDelivery", []), ("finance.payReference", []), ("orders.creditOverdue", []), ("orders.creditLimit", []), ("orders.openInvoices", []),
         ("routes", ["Routes"]), ("notify.delivery_eta", []), ("notify.route_assigned", []),
         ("orders.freeDelivery", []), ("orders.supplierFlatRate", []), ("orders.belowSupplierUnits", []), ("orders.vendor.minimumBy", []), ("orders.vendor.byAmount", []), ("orders.vendor.byUnits", []), ("orders.vendor.units", []), ("orders.vendor.exclVat", []), ("orders.vendor.flatFee", []), ("orders.vendor.flatFeeHint", []), ("orders.vendor.deliveryMinimumHintDistributor", []), ("orders.vendor.notSetDistributor", []), ("orders.vendor.unitsCount", []), ("orders.vendor.freeFrom", []), ("orders.vendor.flatFeeCurrent", []),
         ("support", ["Help & Support"]), ("notify.support_new", []), ("notify.support_message", []), ("notify.support_reply", []), ("notify.support_resolved", []), ("notify.crm_task_assigned", []),
         ("dashboard.live", []), ("dashboard.today", []), ("dashboard.salesTrend", []), ("dashboard.latestOrders", []), ("dashboard.deliveriesToday", []), ("dashboard.deliveredOf", []), ("dashboard.routesOnRoad", []), ("dashboard.noRoutes", []), ("dashboard.network", []), ("dashboard.newOrders", []), ("dashboard.sales30", []), ("dashboard.payout30", []), ("dashboard.vsPrev", []), ("dashboard.toDeliver", []), ("dashboard.topProducts", []), ("dashboard.inProgress", []), ("dashboard.onTheWay", []), ("dashboard.noneOnTheWay", []), ("dashboard.spend30", []), ("dashboard.openInvoices", []), ("dashboard.overdueAmount", []), ("dashboard.topBought", []), ("dashboard.expected", []), ("dashboard.shopNow", []), ("dashboard.seeAll", []), ("dashboard.noOrders", []), ("dashboard.ordersCount", []), ("routes.stopsDone", []),
         ("dashboard.spendTrend", []), ("dashboard.mapDepot", []), ("dashboard.mapDone", []), ("dashboard.mapTodo", []),
         ("ratings", []), ("dashboard.yourScore", []), ("dashboard.ratingHint", []), ("coupons", []), ("offers", ["My Offers"]), ("notifications.categories.marketing", []), ("marketing", []), ("offerForm", []), ("orders.splitNote", []), ("orders.splitBlocked", []), ("orders.splitPlaced", []), ("notify.order_held", []), ("notify.order_released", []), ("orders.statuses.ON_HOLD", []), ("orders.heldNote", []), ("notify.risk_order_held", []), ("notify.risk_order_flagged", []), ("notify.approval_requested", []), ("notify.approval_decided", []), ("ai", ["AI Assistant", "Buy Again", "Demand & Stock"]), ("notify.ai_stock_low", []), ("finance.statusLabels.beingIssued", []), ("notify.invoicing_failed", []), ("notify.payout_due", []), ("notify.ops_alert", []), ("notify.ops_resolved", []), ("status", []), ("notify.payment_received", []), ("notify.payment_failed", []), ("notify.payment_refunded", []), ("notify.payment_link", []), ("notify.payment_reminder_soon", []), ("notify.payment_reminder_due", []), ("notify.payment_reminder_overdue", []), ("notify.direct_debit_notice", []), ("notify.direct_debit_active", []), ("notify.order_awaiting_payment", []), ("notify.order_cancelled_unpaid", []), ("notify.payment_attention", []), ("status.components.payments", []), ("pay", ["Direct Debit"]),
         ("notify.integration_feed_held", []), ("notify.integration_feed_failed", []), ("notify.integration_webhook_disabled", []), ("integrations", ["Import & Sync", "Integrations", "Exports"]),
         ("orders.vendor.confirmSelected", []), ("dashboard.stockCard", []), ("dashboard.reorderCard", []), ("palette", []), ("table", []), ("dash", []), ("live", []),
         ("inventory", ["Inventory", "Stock & Batches", "Expiry", "Purchase Orders", "My Suppliers", "Reorder", "Stock Counts", "Transfers", "Stock Movements", "Valuation"]), ("notify.inventory_expiring", []), ("notify.inventory_expired", []),
         ("purchased", ["Expiring Purchases"]),
         ("warehouse", ["Warehouse", "Pick & Pack", "Scanner", "Shelves", "Traceability", "Recalls", "Product Recalls"]), ("notify.recall_notice", []), ("notify.recall_started", [])]

def get(path):
    d = EN
    for p in path.split("."): d = d[p]
    return d

def source():
    later = [ns for ns, _ in LATER]
    def skip(k, own):
        return any(k == l or k.startswith(l + ".") for l in later if l != own and not own.startswith(l + ".") and l.count(".") > own.count("."))
    items = [(k, v) for k, v in flat({k: v for k, v in EN.items() if k != "navLabels" and k not in later}) if v != "" and not skip(k, "")]
    items += [("navLabels." + n, n) for n in NAV]
    for ns, nav in LATER:
        node = get(ns)
        pairs = flat({ns: node}) if isinstance(node, dict) else [(ns, node)]
        if "." in ns and isinstance(node, dict):
            pairs = list(flat(node, ns + "."))
        items += [(k, v) for k, v in pairs if v != "" and not skip(k, ns)]
        items += [("navLabels." + n, n) for n in nav]
    return items

def setp(d, key, v):
    parts = key.split(".", 1) if key.startswith("navLabels.") else key.split(".")
    for p in parts[:-1]: d = d.setdefault(p, {})
    d[parts[-1]] = v

def build(lang):
    src = source()
    lines = [l.rstrip("\n") for l in (ROOT / f"scripts/i18n/{lang}.txt").read_text(encoding="utf-8").split("\n")]
    while lines and lines[-1] == "": lines.pop()
    if len(lines) != len(src): sys.exit(f"{lang}: {len(lines)} lines, expected {len(src)}")
    out, bad = {}, []
    for (k, v), t in zip(src, lines):
        if sorted(re.findall(r"\{\w+\}", v)) != sorted(re.findall(r"\{\w+\}", t)): bad.append(f"{k}: {v!r} -> {t!r}")
        if "FIRINGI" in v and "FIRINGI" not in t: bad.append(f"{k}: lost FIRINGI -> {t!r}")
        setp(out, k, t.strip())
    for k, v in flat(EN):
        if v == "": setp(out, k, "")
    if bad: sys.exit(f"{lang}:\n  " + "\n  ".join(bad))
    (ROOT / f"src/messages/{lang}.json").write_text(json.dumps(out, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"{lang}: {len(lines)} messages ok")

if __name__ == "__main__":
    if sys.argv[1:] == ["--source"]:
        for k, v in source(): print(v)
    else:
        for lang in sys.argv[1:]: build(lang)
