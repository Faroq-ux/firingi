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
         ("ratings", []), ("dashboard.yourScore", []), ("dashboard.ratingHint", []), ("coupons", []), ("offers", ["My Offers"]), ("notifications.categories.marketing", []), ("marketing", []), ("offerForm", []), ("orders.splitNote", []), ("orders.splitBlocked", []), ("orders.splitPlaced", []), ("notify.order_held", []), ("notify.order_released", []), ("orders.statuses.ON_HOLD", []), ("orders.heldNote", []), ("notify.risk_order_held", []), ("notify.risk_order_flagged", []), ("notify.approval_requested", []), ("notify.approval_decided", []), ("ai", ["Assistant", "Buy Again", "Demand & Stock"]), ("notify.ai_stock_low", []), ("finance.statusLabels.beingIssued", []), ("notify.invoicing_failed", []), ("notify.payout_due", []), ("notify.ops_alert", []), ("notify.ops_resolved", []), ("status", []), ("notify.payment_received", []), ("notify.payment_failed", []), ("notify.payment_refunded", []), ("notify.payment_link", []), ("notify.payment_reminder_soon", []), ("notify.payment_reminder_due", []), ("notify.payment_reminder_overdue", []), ("notify.direct_debit_notice", []), ("notify.direct_debit_active", []), ("notify.order_awaiting_payment", []), ("notify.order_cancelled_unpaid", []), ("notify.payment_attention", []), ("status.components.payments", []), ("pay", ["Direct Debit"]),
         ("notify.integration_feed_held", []), ("notify.integration_feed_failed", []), ("notify.integration_webhook_disabled", []), ("integrations", ["Import & Sync", "Integrations", "Exports"]),
         ("orders.vendor.confirmSelected", []), ("dashboard.stockCard", []), ("dashboard.reorderCard", []), ("palette", []), ("table", []), ("dash", []), ("live", []),
         ("inventory", ["Inventory", "Stock & Batches", "Expiry", "Purchase Orders", "My Suppliers", "Reorder", "Stock Counts", "Transfers", "Stock Movements", "Valuation"]), ("notify.inventory_expiring", []), ("notify.inventory_expired", []),
         ("purchased", ["Expiring Purchases"]),
         ("warehouse", ["Warehouse", "Pick & Pack", "Scanner", "Shelves", "Traceability", "Recalls", "Product Recalls"]), ("notify.recall_notice", []), ("notify.recall_started", []), ("warehouse.featureOff", []),
         ("buying", ["Quotes", "Recurring Orders", "Order Lists", "Approvals", "Quote Requests"]), ("notify.quote_requested", []), ("notify.quote_answered", []), ("notify.quote_declined", []), ("notify.buyer_approval_pending", []), ("notify.buyer_approval_approved", []), ("notify.buyer_approval_rejected", []), ("notify.recurring_reminder", []), ("notify.recurring_placed", []), ("notify.recurring_failed", []),
         ("multisite", ["My Shops", "Shops", "Budgets", "Shop Reports"]), ("accounting", ["Accounting", "Accounting Dashboard", "Daily Sales", "Expenses", "Profit & Loss"]), ("notify.budget_threshold", []),
         ("compliance", ['Certificates & Compliance']), ("onboarding.docTypes.POS_INVOICE", []), ("onboarding.docs.invoiceDate", []), ("onboarding.docs.posHint", []), ("onboarding.form.legalForm", []), ("onboarding.form.certificateCode", []), ("onboarding.form.certificateCodeHint", []), ("onboarding.form.certificateCodeHintPt", []), ("onboarding.legalForms.COMPANY", []), ("onboarding.legalForms.SOLE_TRADER", []), ("onboarding.hub.recommended", []), ("onboarding.hub.missing.CERTIFICATE_CODE_MISSING", []), ("onboarding.hub.missing.POS_INVOICE_MISSING", []), ("notify.compliance_expiring", []), ("notify.compliance_expired", []), ("notify.compliance_paused", []), ("notify.compliance_resumed", []), ("notify.compliance_approved", []), ("notify.compliance_rejected", []), ("notify.compliance_review", []), ("notify.compliance_recheck", []),
         ("priceIntel", ['Price Insights', 'Price Changes']), ("notify.price_change_requested", []), ("notify.price_change_approved", []), ("notify.price_change_rejected", []), ("notify.price_review_requested", []), ("notify.price_increase_notice", []), ("notify.price_alerts", []),
         ("planning", ["Planning", "Planning Overview", "Demand Forecast", "Restock", "Overstock & Expiry", "Lead Times", "Demand Events", "Planning Settings"]), ("notify.planning_restock", []), ("notify.planning_flagged", []),
         ("claims", ["Quality Claims", "Quality Score"]), ("notify.claim_opened", []), ("notify.claim_message", []), ("notify.claim_supplier_responded", []), ("notify.claim_answer_needed", []), ("notify.claim_decided", []), ("notify.claim_replaced", []), ("notify.claim_chargeback", []), ("notify.claim_chargeback_disputed", []), ("notify.claim_chargeback_resolved", []), ("notify.claim_overdue", []), ("notify.quality_alert", []),
         ("voice", []), ("ai.agent", []), ("loyalty", ["Rewards"]), ("onboarding.form.referral", []), ("notify.loyalty_tier_up", []), ("notify.loyalty_expiring", []), ("notify.loyalty_referral", []), ("launch", []), ("inventory.move.MOVE", []), ("inventory.move.RECALL", []), ("finance.beingIssued", []), ("ads", ["Advertising", "My Ads", "New Ad", "Ad Billing"]), ("notify.ads_approved", []), ("notify.ads_rejected", []), ("notify.ads_stopped", []), ("notify.ads_low_balance", []), ("chat", ["Messages"]), ("notify.chat_message", []), ("routes.driverFullOne", []), ("routes.driverFullMax", []), ("plans", ["Plan & Billing", "Early Payout"]), ("notify.plan_trial_ending", []), ("notify.plan_trial_ended", []), ("notify.plan_changed", []), ("notify.earlypay_paid", []), ("notify.earlypay_rejected", []), ("notify.earlypay_requested", []), ("bank", ["Bank"]), ("notify.bank_to_review", []), ("notify.bank_feed_expiring", []), ("notify.bank_feed_failed", []), ("deals", ["Clearance Deals"]), ("notify.deal_review", []), ("notify.deal_approved", []), ("notify.deal_rejected", []), ("notify.deal_bid", []), ("notify.deal_bid_accepted", []), ("notify.deal_bid_rejected", []), ("notify.deal_bid_countered", []), ("notify.deal_alert", []), ("notify.deal_digest", []), ("app", ["Scan to Reorder"]), ("returnables", ["Returnables", "Empties & Deposits"]), ("notify.returnables_collected", []), ("notify.returnables_confirmed", []), ("notify.returnables_disputed", []), ("notify.returnables_resolved", []), ("notify.returnables_pickup_requested", []), ("notify.returnables_pickup_planned", []), ("notify.returnables_overdue", []), ("notify.returnables_kept", []), ("catchWeight", ["Sold by Weight", "Weighing"]), ("notify.catchweight_over_limit", []), ("notify.catchweight_over_accepted", []), ("coldChain", ["Temperature", "Cold Chain", "Receiving Log"]), ("delivery.reasons.TEMPERATURE", []), ("app.reason.TEMPERATURE", []), ("notify.coldchain_breach", []), ("notify.coldchain_logger_alert", []), ("notify.coldchain_equipment_due", []), ("excise", ["Licensed Goods", "Excise Report", "Licences"]), ("notify.excise_licence_review", []), ("notify.excise_licence_decided", []), ("notify.excise_licence_expiring", []), ("app.licenceCheck", []), ("food", ["Food Information", "Allergens & Food Info"]), ("notify.food_review", []), ("notify.food_decided", []), ("notify.food_recipe_changed", []), ("notify.food_cert_expiring", []), ("currency", []), ("notify.fx_alert", []), ("einvoice", ["E-Invoicing"]), ("notify.einvoice_failed", []), ("notify.einvoice_rejected", []), ("notify.einvoice_invalid", []), ("notify.einvoice_received", []), ("notify.einvoice_selfbilled", []), ("einvoicePack", []), ("pos", ["Till (POS)", "Till", "Till Overview", "Till Items", "Menu & Recipes", "Till Sales", "Shifts (X/Z)", "Till Reports", "Ingredient Stock", "Guests & Loyalty", "Till Settings"]), ("notify.pos_fiscal_failed", []), ("app.tab.till", []), ("notify.pos_till_requested", []), ("notify.pos_till_decided", []), ("posStaff", ["Till Staff"]), ("posReceipt", []), ("addressRequests", []), ("onboarding.profile.registrationLocked", []), ("onboarding.form.activityCode", []), ("onboarding.form.activityCodeHint", []), ("onboarding.form.activityCodeOnce", []), ("notify.address_change_requested", []), ("notify.address_change_decided", []), ("specialAccess", []), ("onboarding.form.activityCodesSecondary", []), ("onboarding.form.activityCodesHint", []), ("onboarding.form.activityCodesAdd", []), ("rebates", ["Rebates & Bonuses", "My Bonuses"]), ("notify.rebate_review", []), ("notify.rebate_approved", []), ("notify.rebate_rejected", []), ("notify.rebate_settled", []), ("notify.rebate_available", []), ("notify.rebate_close", []), ("notify.rebate_earned", []), ("notify.rebate_free_goods", []), ("groups", ["Buying Groups"]), ("rebates.audience.BUYING_GROUP", []), ("rebates.f.buyingGroup", []), ("rebates.f.buyingGroupHint", []), ("rebates.groupProgress", []), ("notify.group_review", []), ("notify.group_decided", []), ("notify.group_invited", []), ("notify.group_join_request", []), ("notify.group_join_decided", []), ("notify.group_prices", []), ("notify.group_round_opened", []), ("notify.group_round_placed", []), ("notify.group_round_failed", []), ("notify.group_round_supplier", []), ("groups.notForYou", []), ("payLater", ["Pay Later"]), ("tenders", ["Tenders"]), ("notify.paylater_due_soon", []), ("notify.paylater_overdue", []), ("notify.tender_review", []), ("notify.tender_decided", []), ("notify.tender_opened", []), ("notify.tender_bid", []), ("notify.tender_closed", []), ("notify.tender_awarded", []), ("notify.tender_lost", []), ("co2", ["Sustainability & CO₂", "CO₂ & Packaging", "CO₂ Footprint"]), ("notify.co2_review", []), ("notify.co2_decided", []), ("staff", ["Staff & Time", "My Shifts & Hours", "Who's In", "Rota", "Clock-in Kiosk", "Timesheets", "Leave & Swaps", "Staff"]), ("notify.staff_rota_published", []), ("notify.staff_shift_changed", []), ("notify.staff_shift_reminder", []), ("notify.staff_clock_out_reminder", []), ("notify.staff_timesheet_approved", []), ("notify.staff_leave_decided", []), ("notify.staff_swap_requested", []), ("notify.staff_swap_decided", []), ("notify.staff_shift_claimed", []), ("notify.staff_no_show", []), ("notify.staff_missed_clock_out", []), ("notify.staff_leave_requested", []), ("notify.staff_swap_to_approve", []), ("notify.staff_timesheet_submitted", []), ("reviews", ["My Reviews", "Reviews", "Product Questions", "Review Insights"]), ("notify.review_received", []), ("notify.review_question", []), ("notify.review_reply", []), ("notify.review_answered", []), ("notify.review_reminder", []), ("notify.review_hidden", []), ("notify.review_to_moderate", []), ("kitchen", ["Kitchen", "Kitchen Overview", "Recipes & Costing", "Ingredients", "Menu Engineering", "Waste Log", "Waste Reports", "Use First", "Donations"]), ("notify.kitchen_cost_rise", []), ("notify.kitchen_waste_over", []), ("notify.kitchen_use_first", []), ("rewardsShop", ["Rewards Shop", "My Rewards", "Reward Products", "Rewards to Hand Over"]), ("loyalty.kinds.REDEEM_REWARD", []), ("notify.rewards_supplier_redeemed", []), ("notify.rewards_to_review", []), ("notify.rewards_approved", []), ("notify.rewards_rejected", []), ("notify.rewards_gift_to_send", []), ("notify.rewards_gift_shipped", []), ("notify.rewards_voucher_expiring", []), ("notify.rewards_refunded", []), ("notify.rewards_low_stock", []), ("landing", []), ("notify.website_contact", []), ("notify.website_vendor_interest", []), ("onboarding.form.whatsapp", []), ("onboarding.form.whatsappHint", []), ("onboarding.form.whatsappSame", []), ("trade", ["Customs Codes", "EU Trade Report"]), ("notify.trade_deadline", []), ("notify.trade_threshold", []), ("notify.trade_code_review", []), ("notify.trade_code_accepted", []), ("notify.trade_code_rejected", []), ("waOrder", ["Order by WhatsApp"]), ("adminDash", []), ("substitutions", ["Replacements"]), ("notify.substitution_proposed", []), ("notify.substitution_accepted", []), ("notify.substitution_auto_accepted", []), ("notify.substitution_rejected", []), ("notify.substitution_expired", []), ("storefront", ["Storefront"]), ("notify.storefront_review", []), ("notify.storefront_decided", []), ("notify.storefront_signup", [])]

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
