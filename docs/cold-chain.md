# Cold chain & HACCP (Phase 42)

Temperatures of chilled and frozen goods recorded from the supplier's door to the customer's kitchen, with the
customer able to refuse warm goods, alerts, scores, and the HACCP paperwork (certificates, monthly report, equipment
logs, receiving log).

## Temperature classes

FIRINGI manages the classes in *Catalogue › Temperature Classes* (English):

| Class | Range | Tolerance |
|---|---|---|
| Ambient | — (no cold chain) | — |
| Chilled | 0 – 4 °C | 1 °C |
| Fresh fish | 0 – 2 °C | 1 °C |
| Frozen | ≤ −18 °C | 3 °C |
| Deep frozen | ≤ −25 °C | 3 °C |

A reading is **In range** (`OK`), within the **tolerance** (`WARN` — e.g. 4,8 °C for Chilled) or **Out of range**
(`OUT`). Each **category** gets a default class (cheese & dairy → Chilled, kebab meat → Frozen); a product without one
inherits the nearest parent category's. The supplier can choose another class per product in *Products ›
Temperature* (`VendorOffer.tempClassId`). At checkout every order line keeps its class (`OrderLine.tempClassId`), so
later changes don't rewrite old orders. Customers see a badge ("Refrigerado (0–4 °C)") on the product page and cards.

## Who records, and when

FIRINGI switches each on or off in *Settings › Cold Chain* (`Setting coldchain.settings`, defaults in
`src/lib/cold-chain.ts`):

| Stage | Who | Where |
|---|---|---|
| `DISPATCH` | supplier | order page, while the order is being prepared / ready / dispatched |
| `LOADING` | driver | delivery page, before leaving |
| `HANDOVER` | driver | proof-of-delivery form (online and in the offline app); can be made **required** |
| `RECEIPT` | customer | order page, after delivery (its own HACCP check) |
| `LOGGER` | vehicle / cold-room data logger | `POST /api/coldchain/readings` |

One temperature per class on the order (the warmest product of a class is what you measure). Every reading is a
`TempReading` (stage, °C, status, probe, who, vehicle, accepted).

### Data loggers (API)

Suppliers (*Fleet › Cold Chain*) and FIRINGI (*Delivery › Cold Chain*) add a logger for a vehicle or a cold room. Its key
(`fcl_…`) is shown **once**; only a SHA-256 hash is stored.

```
POST /api/coldchain/readings
Authorization: Bearer fcl_…
{ "readings": [{ "at": "2026-11-18T10:00:00Z", "value": 3.4 }, …] }     or     { "value": 3.4 }   (now)
```

Up to 1000 readings per call; repeated timestamps are ignored (`TempLoggerReading` is unique per logger + time). A
logger out of range for longer than *Logger alert after* (default 15 minutes) alerts its owner, at most once an hour.
On an order, the readings of the delivery vehicle's logger between pickup and handover show as the **trip** (min, max,
average, minutes out of range, a small chart) to the supplier and FIRINGI.

## Out of range at the handover

Each action is a FIRINGI switch:

- **The customer can refuse** the products of a class that is out of range or in tolerance (a tick per class in the
  driver's form). The rest is delivered. If everything would be refused, the delivery fails with the reason
  *Temperature out of range* (and nothing is invoiced).
- **Block the handover** (off by default): out-of-range classes are refused automatically; the driver sees why.
- **Alert the supplier and FIRINGI** (`coldchain.breach` notification, 25 languages).
- **Score**: breaches count in the supplier's and FIRINGI drivers' quality scores (*Orders › Claims › Quality*).

Every refused or blocked class becomes a `ColdIncident` (`CC-…`) and an **approved temperature claim with its credit
note, at once** — the customer doesn't have to file anything. The claim goes through the Phase 31 machinery (credit
note from FIRINGI, supplier charge-back when it is the supplier's fault) but skips the four-eyes review, because the
temperature is the evidence. Whose fault (`inferFault`):

- warm at dispatch or at loading → **supplier**;
- cold at loading (or at dispatch) and warm at the handover → the **carrier**: the FIRINGI **driver** on FIRINGI's fleet,
  the supplier on its own fleet;
- nothing recorded → **FIRINGI** on its fleet (nobody checked), else the supplier.

Readings in tolerance or out of range that the customer accepts are kept as incidents too (`NOTED` / `ACCEPTED`).
Refused goods are **not** put back into stock — they must be disposed of.

## HACCP records

- **Temperature certificate per delivery** (`/api/coldchain/certificate/:orderId`, PDF): classes, products, every
  reading with time and who, the logger trip, incidents. Customer, supplier and FIRINGI.
- **Monthly HACCP report** (`/api/coldchain/report?month=YYYY-MM`, PDF or `&format=csv`): every temperature reading of
  the month (order, counterpart, product, stage, class, range, °C, status, accepted) and the number of incidents.
  Suppliers see their own orders, customers their deliveries and receiving checks, FIRINGI everything.
- **Vehicle & equipment logs**: fridge units, cold rooms, freezers and probes (`ColdEquipment`) with check / cleaning /
  calibration intervals; each task logged (`EquipmentLog`, OK or not, °C, note). Due and overdue tasks show as badges,
  and a daily job reminds the owner once a week (`coldchain.equipment_due`).
- **Customer receiving log** (*Orders › Receiving Log*): the customer's HACCP goods-in record — FIRINGI handovers and
  receipts automatically, plus goods from **other suppliers** typed in (supplier, product, class, °C, accepted).

## Scheduled job

`coldchain` (`/api/cron/coldchain`, in `src/server/ops/jobs.ts`): equipment reminders and a re-check of loggers that
are still out of range (alert after the configured minutes, at most once an hour).

## Code

- Rules: `src/lib/cold-chain.ts` (settings, `classify`, `rangeLabel`, `parseC`, `inferFault`, `tripStats`, `nextDue`).
- Service: `src/server/coldchain/service.ts`; claim: `systemTemperatureClaim` in `src/server/claims/service.ts`.
- Handover hook: `completeDelivery` (`src/server/delivery/deliveries.ts`) and the offline sync op.
- PDFs: `src/server/pdf/coldchain.tsx`. UI: `src/components/coldchain/`.
- Schema: `prisma/schema/coldchain.prisma`.
- Tests: `tests/unit/cold-chain.test.ts`, `tests/integration/cold-chain.test.ts`, browser `tests/e2e/cold-chain.mjs`.
