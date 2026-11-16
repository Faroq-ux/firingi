# Supplier plans & early payout (Phase 36)

## Plans

`SupplierPlan`: code, name, description, `monthlyPrice` (excl. VAT), `commissionPct` (null = keep each supplier's
agreed rate), `features` (subset of `PLAN_FEATURES`), limits `maxProducts` / `maxUsers` / `maxWarehouses` /
`maxDrivers` (null = unlimited), early payout `earlyPayModel` (OFF | PER_DAY | FLAT), `earlyPayRate` (% per day
early, or % of the amount), `earlyPayMinFee`, `freeEarlyPays` (per month), `active` (offered), `sortOrder`.
Three plans are created the first time plans are looked at: Free (0 €, no ERP features, 50 products, 2 users,
1 warehouse, 1 driver, no early payout), Pro (49 €, inventory, planning, price insights, advertising, routes,
assistant; 500 / 10 / 3 / 5; 0.05 %/day, min 5 €) and Business (149 €, everything, no limits; 0.03 %/day, min 3 €,
2 free a month). FIRINGI edits them all; Planning requires Inventory in the same plan.

Settings (`plans.settings`): `enabled` (nothing applies while off), `trialDays` (60), `trialPlanCode` (BUSINESS),
`defaultPlanCode` (FREE), `billing` for new subscriptions (PAYOUT | INVOICE), `invoiceDueDays`, `reminderDays`
(14, 7, 1), `earlyPay` { `enabled`, `defaultLimit` (5 000 €), `minDaysEarly` (3) }.

## Subscriptions

`PlanSubscription` per supplier (wholesalers and distributors, not FIRINGI's own warehouse): created on first use once
plans are on (and by the daily job for everyone) as a TRIAL of the trial plan. Fields: plan, status (TRIAL | ACTIVE |
CANCELLED), trial end, current period, pending plan (chosen in the trial, or a downgrade at period end), billing,
`commissionLocked` (FIRINGI fixed this supplier's commission — plan changes don't touch it), early-payout switch and
limit.

- Choosing during the trial → `pendingPlanId`, starts when the trial ends.
- Upgrade (dearer plan) while ACTIVE → now; `UPGRADE` invoice for the price difference × the share of the period left.
- Cheaper plan → at period end. Staying on the current plan undoes a pending change.
- FIRINGI can set any plan now or from the next period, add trial days, change billing, lock the commission, switch
  early payout off or set its limit.

Daily job (`runPlansJob`, `/api/cron/plans`): trial reminders, trial endings (chosen plan or default), period renewals
(apply the pending plan, invoice the next month), settling open plan invoices of PAYOUT suppliers against what FIRINGI
owes them (inbound + outbound "Compensação" payments, like advertising).

## What a plan controls

- Features: the vendor menu hides items tagged with the feature (`PLAN_NAV_KEYS`), section layouts under
  `src/app/vendor/...` render `<PlanGate>` (upgrade card) instead of the page, `companyFeatureOn` returns false for ADS /
  ASSISTANT outside the plan, and the v2 API refuses suppliers without INTEGRATIONS (`PLAN_FEATURE`, 403).
- Limits: `assertWithinLimit` before creating / resuming an offer, adding a user, a warehouse or pickup address, a driver
  (`PLAN_LIMIT`, message in the user's language).
- Commission: when a subscription becomes ACTIVE on a plan with a commission (and the supplier isn't locked), the
  supplier's `CommissionRule` is closed and a new one opened ("Plan <name>"). Editing a plan's commission goes through
  four-eyes (`COMMISSION` approval with a `plan` payload) and then applies to its active suppliers.

## Early payout

`earlyPayOptions(companyId)`: approved supplier invoices (not credit notes) with an open amount, not already in a
REQUESTED / PAID early payout; due date = the invoice's, else issue date + supplier payout days; eligible when at
least `minDaysEarly` days early. Fee per invoice: PER_DAY = amount × rate % × days, FLAT = amount × rate %; the total is
at least the minimum fee (never more than the amount); a free one (plan allowance, per calendar month) has no fee.
Limit: the supplier's (or the default) on what is outstanding — requested, or paid early and not yet at its normal date.

`requestEarlyPay` → `EarlyPayout` REQUESTED (`EP-YYYY-NNNNNN`), FIRINGI finance is notified. `payEarlyPayout`
(admin.finance.manage; four-eyes `EARLY_PAYOUT` above the payment threshold) re-checks the invoices, issues a FIRINGI
service invoice for the fee (VAT as for any FIRINGI service to that supplier), records the bank transfer (amount − fee
with VAT) against the supplier's invoices and settles the fee invoice against the rest. `rejectEarlyPayout` needs a
reason; the supplier can cancel while it waits. Notifications: `earlypay.requested` (FIRINGI), `earlypay.paid`,
`earlypay.rejected`, `plan.trial_ending`, `plan.trial_ended`, `plan.changed` (25 languages).

Note for the accountant: the early-payout fee is invoiced like FIRINGI's other services (standard VAT of the supplier's
country entity, or reverse charge). Confirm the VAT treatment of this fee for your entities before going live.
