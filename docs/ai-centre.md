# AI Centre (Phase 66)

FIRINGI's back office (English) has one AI Centre. **AI suggests; people decide.** Nothing changes orders, prices or stock by itself; accepting a suggestion does one small, safe step.

| Section | Address | What it does |
| --- | --- | --- |
| **AI Dashboard** | `/admin/ai` | KPIs, the most important actions across every area ("Do these first"), alerts, savings waiting on delivery routes (km, fuel or energy, €, CO₂), the sales forecast, AI activity, the latest reports, the AI Centre settings |
| **Recommendations** | `/admin/ai/recommendations?area=` | Six areas, paged, by kind and status, with each area's detail table |
| **Forecasting** | `/admin/ai/forecasting?tab=` | Demand, sales, orders, inventory, cash flow, delivery |
| **AI Reports** | `/admin/ai/reports?tab=` | Executive, sales, suppliers, stock, finance, delivery risks, fraud & risk alerts — summary, KPIs, tables, PDF, CSV, history |
| **AI Assistant** | `/admin/ai/assistant` | Ask about FIRINGI's data (Claude, read-only tools, your access rights) |
| **AI Activity Log** | `/admin/ai/activity-log` | Everything the AI did (refreshes, answers, decisions, reports) |

Coming next (Phase 67): Automation (workflows, rules, approvals, schedules, run logs), AI Agents (FIRINGI creates its own agents — job, instructions, tools, data, schedule, approval — plus ready-made specialist agents) and AI Governance (approvals, permissions, audit trail, model settings).

Rights: `admin.ai.view` to open the AI Centre, plus the right to each page's data (e.g. finance for cash flow, risk for fraud). `admin.settings.manage` to change the settings.

## Recommendations: six areas

Refreshed every hour (and when a page finds them older than an hour). One suggestion per situation; a situation that goes away expires.

| Area | Kinds | Accept does |
| --- | --- | --- |
| Sales | Demand rising, **sales dropping** (a supplier's last 4 weeks a third or more below the 4 before) | Task to talk to the supplier |
| Pricing | Margin below the rules, **price to review** (far above / below the market median), **commission to review** (margin under the margin rule) | Task for the supplier's account manager |
| Suppliers | Better supplier (cheaper with stock, or more reliable) | — (noted) |
| Stock | Running out, low cover | Stock notice to the supplier |
| Customers | Reorder due, **going quiet** (no order for 2 × the usual gap), **overdue invoices** | CRM call / chase task |
| Delivery routes | Delivery at risk, **shorter route**, **combine routes** | Shorter route: the stops are put in the shorter order (FIRINGI's own routes; a supplier's fleet is told and can do it from its own suggestion) |

**Route savings** — for every planned route of the next 8 days: the stops in their planned order against the shortest order found (pickup before drop kept). Worth suggesting from 3 km *and* 8 % shorter (FIRINGI's thresholds). Two small routes of the same fleet on the same day within 15 km of each other are suggested as one. Each shows km, minutes, fuel (litres) or energy (kWh), euros and kg CO₂, from the vehicle's fuel (diesel, petrol, hybrid, LPG, electric) and FIRINGI's rates: use per 100 km, price per litre / kWh, kg CO₂ per litre / kWh (defaults: diesel 9 L, €1.65, 2.68 kg).

## Forecasts

Trend-following smoothing (Holt) over the last 16 weeks, 8 weeks ahead (demand: 12 → 4).

- **Demand** — units per product. **Sales** — net sales, total and by supplier. **Orders** — total, by country, next week by weekday.
- **Inventory** — days of stock left per product at the current rate. **Cash flow** — what customers owe by due date, less what FIRINGI owes suppliers and running costs; lowest point. **Delivery** — deliveries per week, the share late, drivers needed next week.

## Reports

Built from FIRINGI's own numbers for the last 7, 30 or 90 days against the period before, kept as a snapshot (history, PDF, CSV). The summary is FIRINGI's own wording from the numbers, or Claude's when the AI is connected and FIRINGI allows it ("Summary by Claude"). Every Monday from 07:00 (Lisbon) the executive report is emailed to FIRINGI's admins (job `/api/cron/ai-reports`, hourly; switchable).

## Settings (on the AI Dashboard)

Each area, forecast and report on / off (off: not computed, not shown); the weekly email; Claude summaries; route thresholds (km, %, combine within km); "going quiet" factor; overdue days; fuel and energy rates; the fuel for vehicles without one.

## Code

- Rules: `src/lib/ai-centre.ts`. Engine: `src/server/ai/centre/` (`settings`, `recs`, `forecasts`, `reports`, `dashboard`, `schema`), hooked into `src/server/ai/feed.ts`.
- Pages: `src/app/admin/ai/` (Phase 17's separate pages redirect to the new ones). PDF: `src/server/pdf/ai-report.tsx`; download `/api/admin/ai/reports/[id]` (`?format=csv`).
- Tests: `tests/unit/ai-centre.test.ts`, `tests/integration/ai-centre.test.ts`, `tests/e2e/ai-centre.mjs`.
