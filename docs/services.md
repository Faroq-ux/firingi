# Services & Used Cooking Oil (Phase 68)

Used cooking oil collection and other kitchen services (grease trap cleaning, pest control, hood & duct cleaning, and
any service FIRINGI adds) — on a schedule or when the customer asks.

## Who does what

| Who | Where | What |
| --- | --- | --- |
| Customer / wholesaler (`buyer.services.manage`, `buyer.services.log`) | `/buy/services` | Take a service with a schedule (every week, every 2 weeks, twice a month, every month, only when requested), day, time, address, containers; change, pause, end; request a collection / visit; skip or move a visit; history with the visit document (PDF). Never sees FIRINGI's commission or the provider's amount. |
| Customer | `/buy/services/oil` | Fryers and their log (oil changed, topped up, tested — polar compounds %, filtered); when each fryer's oil is due; used oil waiting and how full the containers are; litres and cost per fryer; oil collected and paid; CO₂ avoided; tips. A collection is asked for by itself when the containers are nearly full (if the plan says so). |
| Supplier (distributor / wholesaler, `vendor.services.manage`, `vendor.services.visit`) | `/vendor/services` | Offer a service (licence, countries) → FIRINGI approves; requests and coming visits: confirm, move, record (quantity, containers taken / left, who signed, waste document no. such as the e-GAR, its own invoice no. when it invoices), or say it couldn't be done; customers on a plan; recent visits and PDFs. |
| FIRINGI (`admin.services.view` / `.manage`) | `/admin/services` | Overview, Catalogue (add / edit services: unit, waste code, schedules, prices, **who invoices the customer**, commission), Providers (approve, reject, suspend, per-provider invoicing and commission override, FIRINGI itself as provider), Plans & Visits (reassign a plan), Money, Settings. English. |

## Who invoices the customer

FIRINGI decides per service, and can override it per provider:

* **FIRINGI invoices** — when a visit is done FIRINGI issues its invoice to the customer (if there is a charge), pays the
  customer for used oil (buy-back) and pays the provider its amount (per visit + per unit). FIRINGI keeps the
  difference. Money tab: "Oil buy-back to pay", "Owed to providers", mark paid (Finance right).
* **The provider invoices** — the provider enters its own invoice number when recording the visit; FIRINGI earns a
  commission only (% of the customer charge + per visit + per unit), invoiced to the provider on the 1st of each month
  (or "Invoice commissions now").

When FIRINGI is the provider, FIRINGI always invoices.

## Schedules

`visitDates` (src/lib/services.ts): weekly on the chosen weekday; every 2 weeks counted from the plan's start; twice a
month on days A and B; monthly on day A (days above the month's length move to its last day); "only when requested"
has no planned visits. Visits are planned `daysAhead` (35) days ahead by the hourly job and re-planned when the plan
changes, pauses or resumes.

## The job (hourly, `services`)

Plans visits ahead, resumes paused plans, reminds customer and provider before a visit, marks visits nobody recorded
as missed (customer told), asks for a collection when used-oil containers are full, "change the oil" alerts, licence
running out (provider + FIRINGI), FIRINGI's monthly commission invoices.

## Switches (Settings tab)

On / off; who uses services (customers, wholesalers); who may provide them (distributors, wholesalers, FIRINGI); parts
(scheduled plans, requests, fryers & oil, FIRINGI invoices, oil buy-back, documents, AI); oil rules (change after N
days, "soon" / "now" at polar %, containers full at %); reminder / missed hours, days ahead, request lead days; per
business: Always on / Off.

## AI

* AI Centre suggestions: visits missed this week, oil schedule to adjust (containers mostly empty or full at
  collection), containers overflowing with no collection planned, provider licence ending with active plans.
* Customer Assistant: "my services" and "request a collection".
* Automations: triggers `SERVICE_REQUESTED`, `SERVICE_MISSED`; template "Missed service visit". Agents: tool
  `services_overview`; template "Services Coordinator".

## Notifications

`service.provider_review`, `service.provider_decided`, `service.plan_new`, `service.request_new`,
`service.visit_changed`, `service.visit_confirmed`, `service.visit_reminder`, `service.visit_done`,
`service.visit_missed`, `service.container_full`, `service.oil_change_due`, `service.licence_expiring` — texts in 25
languages.

## Tests

`tests/unit/services.test.ts`, `tests/integration/services.test.ts`, `node tests/e2e/services.mjs <baseUrl> [shots]`.
