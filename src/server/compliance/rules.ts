/**
 * Supplier compliance rules (Phase 28) — pure, no DB. Given a certificate type, a supplier's
 * certificates and waivers of that type, and today's date: is the supplier covered, and if not,
 * what is wrong? The pause decision, the score and every page use this one function.
 */
import type { CompanyType, ReviewStatus } from "@prisma/client";

export type TypeRule = {
  id: string; key: string; appliesTo: CompanyType[]; countryIds: string[]; categoryIds: string[];
  required: boolean; hasExpiry: boolean; graceDays: number; isActive: boolean;
};
export type CertLite = { id: string; typeId: string; status: ReviewStatus; expiresOn: Date | null; reviewedAt: Date | null; createdAt: Date; supersededAt: Date | null };
export type WaiverLite = { typeId: string; until: Date; revokedAt: Date | null };

/**
 * VALID / EXPIRING (≤ 30 days left) / WAIVED (FIRINGI grace) / GRACE (expired, inside the type's grace days)
 * count as covered. EXPIRED, PENDING (uploaded, not reviewed yet), REJECTED and MISSING don't.
 */
export type CertState = "VALID" | "EXPIRING" | "WAIVED" | "GRACE" | "EXPIRED" | "PENDING" | "REJECTED" | "MISSING";
export const COVERED: CertState[] = ["VALID", "EXPIRING", "WAIVED", "GRACE"];
export const EXPIRING_DAYS = 30;
export const REMINDER_DAYS = [30, 14, 7] as const;

const DAY = 86_400_000;
/** UTC midnight of a date. */
export const dayOf = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
export const daysBetween = (from: Date, to: Date) => Math.round((dayOf(to).getTime() - dayOf(from).getTime()) / DAY);

export function applies(t: TypeRule, company: { type: CompanyType; countryId: string }) {
  return t.isActive && t.appliesTo.includes(company.type) && (!t.countryIds.length || t.countryIds.includes(company.countryId));
}

export type Evaluation = { state: CertState; current: CertLite | null; pending: CertLite | null; daysLeft: number | null; graceUntil: Date | null; waiverUntil: Date | null };

export function evaluate(t: Pick<TypeRule, "id" | "hasExpiry" | "graceDays">, certs: CertLite[], waivers: WaiverLite[], today = new Date()): Evaluation {
  const now = dayOf(today);
  const mine = certs.filter((c) => c.typeId === t.id && !c.supersededAt);
  const newest = (xs: CertLite[]) => [...xs].sort((a, b) => (b.reviewedAt ?? b.createdAt).getTime() - (a.reviewedAt ?? a.createdAt).getTime())[0] ?? null;
  const approved = newest(mine.filter((c) => c.status === "APPROVED" || c.status === "EXPIRED"));
  const pending = newest(mine.filter((c) => c.status === "PENDING"));
  const waiver = waivers.filter((w) => w.typeId === t.id && !w.revokedAt && dayOf(w.until) >= now).sort((a, b) => b.until.getTime() - a.until.getTime())[0] ?? null;
  const base = { pending, waiverUntil: waiver ? dayOf(waiver.until) : null };
  if (approved) {
    const exp = t.hasExpiry && approved.expiresOn ? dayOf(approved.expiresOn) : null;
    if (!exp || exp >= now) {
      const left = exp ? daysBetween(now, exp) : null;
      return { ...base, state: left !== null && left <= EXPIRING_DAYS ? "EXPIRING" : "VALID", current: approved, daysLeft: left, graceUntil: null };
    }
    const graceUntil = new Date(exp.getTime() + t.graceDays * DAY);
    if (waiver) return { ...base, state: "WAIVED", current: approved, daysLeft: daysBetween(now, exp), graceUntil };
    if (graceUntil >= now && t.graceDays > 0) return { ...base, state: "GRACE", current: approved, daysLeft: daysBetween(now, exp), graceUntil };
    return { ...base, state: "EXPIRED", current: approved, daysLeft: daysBetween(now, exp), graceUntil };
  }
  if (waiver) return { ...base, state: "WAIVED", current: null, daysLeft: null, graceUntil: null };
  if (pending) return { ...base, state: "PENDING", current: null, daysLeft: null, graceUntil: null };
  const last = newest(mine);
  return { ...base, state: last && (last.status === "REJECTED" || last.status === "REVOKED") ? "REJECTED" : "MISSING", current: null, daysLeft: null, graceUntil: null };
}

/** Required types weigh 2, optional ones 1; covered = full weight. 100 when nothing applies. */
export function score(rows: { required: boolean; state: CertState }[]) {
  const total = rows.reduce((a, r) => a + (r.required ? 2 : 1), 0);
  if (!total) return 100;
  return Math.round((100 * rows.filter((r) => COVERED.includes(r.state)).reduce((a, r) => a + (r.required ? 2 : 1), 0)) / total);
}

/**
 * What to pause: required types the supplier isn't covered for. Types without categories pause the
 * whole supplier; types with categories pause only the offers in those categories (and below).
 */
export function pausePlan(rows: { type: Pick<TypeRule, "key" | "required" | "categoryIds">; state: CertState }[]) {
  const failing = rows.filter((r) => r.type.required && !COVERED.includes(r.state));
  const whole = failing.filter((r) => !r.type.categoryIds.length).map((r) => r.type.key);
  const byCategory = failing.filter((r) => r.type.categoryIds.length).map((r) => ({ key: r.type.key, categoryIds: r.type.categoryIds }));
  return { whole, byCategory };
}

/** Which reminder (30 / 14 / 7 days before expiry) is due now, and every threshold it covers (so a late first run sends one message, not three). */
export function reminderDue(daysLeft: number, sent: number[]): { day: number; mark: number[] } | null {
  if (daysLeft < 0) return null;
  const due = REMINDER_DAYS.filter((d) => daysLeft <= d);
  if (!due.length) return null;
  const smallest = Math.min(...due);
  if (sent.includes(smallest)) return null;
  return { day: smallest, mark: due.filter((d) => !sent.includes(d)) };
}
