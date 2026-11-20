# Staff shifts & time (Phase 52)

Shifts, clocking in and out, timesheets, payroll export, leave and shift swaps for the staff of **customers**
(restaurants, shops — in the buyer portal), **suppliers** (wholesalers, distributors — in the supplier portal) and
**FIRINGI** itself (in the back office, English). Staff are the business's users (*Company › Users*); their clock PIN
is the same as the till's.

## Pages (each business: *Staff & Time*)

| Page | Who | What |
|---|---|---|
| **My Shifts & Hours** (`/staff/me`) | everyone | clock in / out and breaks from the phone (location checked), this week's hours (worked, overtime, night, public holiday), next shifts (offer one to a colleague), open shifts to take, swaps offered to me, leave requests, my PIN, "send this week" |
| **Who's In** (`/staff`) | managers | in now / on a break, today's shifts (in, not in yet, later), entries to check (late, left early, outside the area, forgot to clock out, no break), waiting requests, labour cost against sales |
| **Rota** (`/staff/rota`) | managers plan; staff see published shifts | week grid per person and open shifts; add (night shifts end the next day), delete, copy last week, publish (staff are told); planned hours against contract, planned cost; warnings: over the weekly maximum, too little rest, no break, overlap, on leave |
| **Clock-in Kiosk** (`/staff/clock`) | managers, cashiers, kiosk role | a PIN pad on the shop / warehouse device: In / Out, break start / end |
| **Timesheets** (`/staff/timesheets`) | managers | each person's week; correct or add entries (a reason is required, kept and audited, flagged "corrected"); approve (locks the week) / reopen; **payroll CSV** and **time-record CSV** |
| **Leave & Swaps** (`/staff/leave`) | managers | approve / turn down (with a reason) leave and swaps |
| **Staff** (`/staff/people`) | managers | role, contract hours a week, hourly rate (managers only), home site, payroll code, active, PIN |

Managers = owners, the **Staff & Rota Manager** role (`company.staff.manage`) or user managers; for FIRINGI
`admin.staff.manage`. The kiosk is also open to cashiers / shop managers (`company.staff.kiosk`).

## Rules

* **Local time:** days, nights and public holidays are read in the business's country zone (every Schengen country).
* **Worked time** = clock-in to clock-out minus breaks, counted to the minute across midnight and DST.
* **Overtime** per week = the larger of (the sum of each day beyond the daily limit) and (the week beyond the weekly limit).
* **Night** hours between *night from* and *night to*; **public-holiday** hours on FIRINGI's public holidays for the country.
* **Flags:** LATE (after the grace), EARLY_LEAVE, OUTSIDE_AREA (phone farther than the distance), NO_BREAK (a long day
  without the shortest break), MISSED_CLOCK_OUT (closed by the job), EDITED (corrected by a manager), NO_SHIFT.
* **Location:** the phone's position against the nearest site (the business's addresses); outside the distance FIRINGI
  chooses *flag* or *refuse*.
* **Working-time warnings** (EU Working Time Directive defaults): 48 h a week, 11 h rest, a break after 6 h.
* **Leave days** = working days (Mon–Fri) without public holidays; a half day = 0.5.
* **Labour share** = hours × rates ÷ sales (the till's sales for shops; delivered sales for suppliers).

## The job (`/api/cron/staff`, every 15 minutes)

Shift reminders before a shift starts; a reminder to staff still clocked in after their shift ended; entries still
open after *close after* hours are closed (at the shift's end, flagged MISSED_CLOCK_OUT) and managers are told;
no-shows (a shift started and nobody clocked in) are told to managers; records older than *keep records* years are
removed (Portugal requires 5 years).

## FIRINGI's switches (*Settings › Staff & Time*)

The feature; who uses it (customers, wholesalers, distributors, FIRINGI's own staff); each part (clock, rota,
timesheets & payroll, leave, swaps, labour vs sales); phone / kiosk / till; the location check, distance and
flag-or-refuse; late grace, reminders, auto close; daily / weekly overtime, weekly maximum, rest, break rules, night
hours; manager approval of timesheets, leave and swaps; whether staff take open shifts and see colleagues; how long
records are kept; **each business on / off** (`STAFF_TIME`); **public holidays** per country and year (*Fill national
holidays* for PT, ES, FR, DE, IT, NL, BE, AT; others and regional days by hand).

## Code

* rules — `src/lib/staff-time.ts` · service — `src/server/staff/service.ts` · actions — `src/server/actions/staff.ts`
* pages — `src/components/staff/pages.tsx` (shared by `/buy/staff`, `/vendor/staff`, `/admin/staff`), settings — `/admin/settings/staff-time`
* export — `src/app/api/staff/export/route.ts` · job — `src/app/api/cron/staff/route.ts`
* tests — `tests/unit/staff-time.test.ts`, `tests/integration/staff-time.test.ts`, `node tests/e2e/staff-time.mjs`
