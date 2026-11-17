/**
 * Returnables & deposits (Phase 40) — settings and the pure rules (tested in tests/unit/returnables.test.ts).
 *   DEPOSIT  — every unit delivered carries a deposit; empties brought back are credited.
 *   EXCHANGE — refill / swap: each full unit needs an empty back; units with no empty to swap carry a deposit.
 */
export type DepositVatMode = "NONE" | "PRODUCT" | "FIXED";
export type OverdueAction = "REMIND" | "KEEP";

export type ReturnableSettings = {
  enabled: boolean;
  /** VAT on deposits per country (ISO code). NONE = outside VAT, PRODUCT = the goods' rate, FIXED = `rate`. */
  vat: Record<string, { mode: DepositVatMode; rate?: number }>;
  /** Empties held longer than `days`: REMIND (open balance, reminder every `remindEveryDays`) or KEEP (deposit kept as the price). */
  overdue: { days: number; action: OverdueAction; remindEveryDays: number };
  /** Per-supplier exceptions to the overdue rule. */
  suppliers: Record<string, { days: number; action: OverdueAction }>;
  /** Damaged empties taken back are refunded too (otherwise no refund). */
  creditDamaged: boolean;
  /** Customers can ask for a collection of empties (pickup) without an order. */
  pickups: boolean;
  /** Smallest number of units a pickup request must have. */
  pickupMinUnits: number;
};

/** Defaults: deposits outside VAT in Portugal (returned packaging is not part of the taxable amount), the goods' rate elsewhere. */
export const DEFAULT_RETURNABLE_SETTINGS: ReturnableSettings = {
  enabled: true,
  vat: { PT: { mode: "NONE" } },
  overdue: { days: 90, action: "REMIND", remindEveryDays: 14 },
  suppliers: {},
  creditDamaged: false,
  pickups: true,
  pickupMinUnits: 1,
};

export function mergeReturnableSettings(v: Partial<ReturnableSettings> | null | undefined): ReturnableSettings {
  const d = DEFAULT_RETURNABLE_SETTINGS;
  const x = v ?? {};
  return { ...d, ...x, vat: { ...d.vat, ...(x.vat ?? {}) }, overdue: { ...d.overdue, ...(x.overdue ?? {}) }, suppliers: { ...(x.suppliers ?? {}) } };
}

/** The deposit's VAT rate in a country, given the rates of the goods it comes with. */
export function depositVatRate(s: ReturnableSettings, countryCode: string, goodsRates: number[]): number {
  const rule = s.vat[countryCode] ?? { mode: "PRODUCT" as const };
  if (rule.mode === "NONE") return 0;
  if (rule.mode === "FIXED") return Math.max(0, Number(rule.rate ?? 0));
  return goodsRates.length ? Math.max(...goodsRates) : 0;
}

export const overdueRule = (s: ReturnableSettings, supplierId: string) => s.suppliers[supplierId] ?? { days: s.overdue.days, action: s.overdue.action };

/** Returnable units an order carries: Σ qty × qtyPerUnit per type. */
export function unitsFor(lines: { offerId: string; qty: number }[], links: { offerId: string; typeId: string; qtyPerUnit: number }[]) {
  const out = new Map<string, number>();
  for (const l of lines) for (const k of links) if (k.offerId === l.offerId && l.qty > 0) out.set(k.typeId, (out.get(k.typeId) ?? 0) + l.qty * k.qtyPerUnit);
  return out;
}

/**
 * Empties counted at a delivery stop, split per type: EXCHANGE empties first swap the full units of this
 * order (no deposit, no refund); the rest — and every DEPOSIT empty — becomes a return to be credited.
 */
export function splitEmpties(
  counted: Record<string, number>,
  order: { typeId: string; kind: "DEPOSIT" | "EXCHANGE"; qtyOut: number }[],
) {
  const swaps: Record<string, number> = {};
  const returns: Record<string, number> = {};
  for (const [typeId, raw] of Object.entries(counted)) {
    const n = Math.max(0, Math.floor(Number(raw) || 0));
    if (!n) continue;
    const o = order.find((x) => x.typeId === typeId);
    const swap = o && o.kind === "EXCHANGE" ? Math.min(n, o.qtyOut) : 0;
    if (swap) swaps[typeId] = swap;
    if (n - swap > 0) returns[typeId] = n - swap;
  }
  return { swaps, returns };
}

/** Deposit units charged on the invoice: DEPOSIT = every unit out; EXCHANGE = units out without an empty swapped. */
export const chargedUnits = (kind: "DEPOSIT" | "EXCHANGE", qtyOut: number, swapped: number) => (kind === "EXCHANGE" ? Math.max(0, qtyOut - Math.min(swapped, qtyOut)) : qtyOut);

/**
 * Ageing of what a customer holds (first in, first out): the dates of the units still out.
 * `moves` are the ledger movements (signed qty, + = to the customer) in any order.
 */
export function ageUnits(moves: { qty: number; at: Date }[]): { qty: number; since: Date }[] {
  const lots: { qty: number; since: Date }[] = [];
  let owed = 0; // returns before anything was out (opening balances not recorded) are ignored
  for (const m of [...moves].sort((a, b) => a.at.getTime() - b.at.getTime())) {
    if (m.qty > 0) {
      let q = m.qty;
      if (owed) { const use = Math.min(owed, q); owed -= use; q -= use; }
      if (q) lots.push({ qty: q, since: m.at });
    } else {
      let q = -m.qty;
      while (q && lots.length) {
        const use = Math.min(q, lots[0].qty);
        lots[0].qty -= use; q -= use;
        if (!lots[0].qty) lots.shift();
      }
      owed += q;
    }
  }
  return lots;
}

/** Units held longer than `days` on `now`. */
export const overdueUnits = (lots: { qty: number; since: Date }[], days: number, now = new Date()) =>
  lots.filter((l) => now.getTime() - l.since.getTime() > days * 86_400_000).reduce((a, l) => a + l.qty, 0);

export const RETURNABLE_CATEGORIES = ["CRATE", "KEG", "PALLET", "BOTTLE", "CYLINDER", "BOX", "OTHER"] as const;
export const DEPOSIT_PREFIX = "Depósito";
