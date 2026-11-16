/**
 * Daily bank feed (open banking). Two providers:
 *   • SIMULATED — BANKFEED_SIMULATE=1 (tests, demos): consent is given at once and transactions are
 *     whatever was queued for the IBAN (POST /api/bank/sim, or the simulator panel).
 *   • GOCARDLESS — GoCardless Bank Account Data (free PSD2 access to most EU banks):
 *     GOCARDLESS_SECRET_ID + GOCARDLESS_SECRET_KEY. The account holder picks the bank and approves
 *     access on the bank's site (90 days, then again).
 */
import "server-only";
import { prisma } from "@/server/db";
import { AppError } from "@/server/errors";
import { cleanIban, parseAmount, type ParsedLine } from "@/lib/bank/common";

export type FeedStart = { requisition: string; link: string };
export type FeedStatus = { status: "PENDING" | "LINKED" | "EXPIRED" | "ERROR"; accountId?: string | null; consentUntil?: Date | null; error?: string | null };
export type FeedFetch = { lines: ParsedLine[]; balance?: number | null; balanceDate?: string | null };
export type FeedInstitution = { id: string; name: string; logo?: string | null };

export interface FeedProvider {
  key: "SIMULATED" | "GOCARDLESS";
  ready(): boolean;
  institutions(country: string): Promise<FeedInstitution[]>;
  start(i: { accountRowId: string; iban: string; institutionId: string; redirect: string }): Promise<FeedStart>;
  status(requisition: string, iban: string): Promise<FeedStatus>;
  fetch(feedAccountId: string, from: string): Promise<FeedFetch>;
}

const appUrl = () => (process.env.APP_URL ?? process.env.BETTER_AUTH_URL ?? "http://localhost:3000").replace(/\/$/, "");

// ── simulated ───────────────────────────────────────────────────────────────

const SIM_KEY = (iban: string) => `bank.sim.${cleanIban(iban)}`;

/** Queue transactions for a simulated bank account (tests / demos only). */
export async function simQueue(iban: string, lines: ParsedLine[], balance?: number | null) {
  const key = SIM_KEY(iban);
  const row = await prisma.setting.findFirst({ where: { scope: "GLOBAL", scopeId: "", key } });
  const cur = (row?.value as { lines?: ParsedLine[]; balance?: number | null }) ?? {};
  const value = { lines: [...(cur.lines ?? []), ...lines].slice(-500), balance: balance ?? cur.balance ?? null };
  if (row) await prisma.setting.update({ where: { id: row.id }, data: { value } });
  else await prisma.setting.create({ data: { scope: "GLOBAL", scopeId: "", key, value } });
  return value.lines.length;
}

export const simProvider: FeedProvider = {
  key: "SIMULATED",
  ready: () => process.env.BANKFEED_SIMULATE === "1",
  institutions: async () => [{ id: "SIM_BANK", name: "Simulated bank (test)" }],
  start: async ({ accountRowId }) => ({ requisition: `sim-${accountRowId}`, link: `${appUrl()}/api/bank/feed/callback?account=${encodeURIComponent(accountRowId)}` }),
  status: async (_req, iban) => ({ status: "LINKED", accountId: `sim:${cleanIban(iban)}`, consentUntil: new Date(Date.now() + 90 * 86_400_000) }),
  fetch: async (feedAccountId, from) => {
    const iban = feedAccountId.replace(/^sim:/, "");
    const row = await prisma.setting.findFirst({ where: { scope: "GLOBAL", scopeId: "", key: SIM_KEY(iban) } });
    const v = (row?.value as { lines?: ParsedLine[]; balance?: number | null }) ?? {};
    return { lines: (v.lines ?? []).filter((l) => l.bookingDate >= from), balance: v.balance ?? null, balanceDate: new Date().toISOString().slice(0, 10) };
  },
};

// ── GoCardless Bank Account Data ───────────────────────────────────────────

const GC = "https://bankaccountdata.gocardless.com/api/v2";
let gcToken: { access: string; until: number } | null = null;

async function gc<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  if (!gcToken || gcToken.until < Date.now() + 60_000) {
    const r = await fetch(`${GC}/token/new/`, { method: "POST", headers: { "content-type": "application/json", accept: "application/json" }, body: JSON.stringify({ secret_id: process.env.GOCARDLESS_SECRET_ID, secret_key: process.env.GOCARDLESS_SECRET_KEY }) });
    if (!r.ok) throw new AppError("FEED_AUTH", `The bank feed provider refused the keys (${r.status}).`, 502);
    const j = (await r.json()) as { access: string; access_expires: number };
    gcToken = { access: j.access, until: Date.now() + j.access_expires * 1000 };
  }
  const r = await fetch(`${GC}${path}`, { method: init.method ?? "GET", headers: { authorization: `Bearer ${gcToken.access}`, "content-type": "application/json", accept: "application/json" }, body: init.body ? JSON.stringify(init.body) : undefined });
  if (!r.ok) {
    const t = await r.text().catch(() => "");
    throw new AppError("FEED_ERROR", `Bank feed: ${r.status} ${t.slice(0, 200)}`, 502);
  }
  return (await r.json()) as T;
}

type GcTx = {
  transactionId?: string; internalTransactionId?: string; bookingDate?: string; valueDate?: string;
  transactionAmount: { amount: string; currency: string };
  debtorName?: string; debtorAccount?: { iban?: string }; creditorName?: string; creditorAccount?: { iban?: string };
  remittanceInformationUnstructured?: string; remittanceInformationUnstructuredArray?: string[]; remittanceInformationStructured?: string; endToEndId?: string; additionalInformation?: string;
};

export const gocardlessProvider: FeedProvider = {
  key: "GOCARDLESS",
  ready: () => !!(process.env.GOCARDLESS_SECRET_ID && process.env.GOCARDLESS_SECRET_KEY),
  institutions: async (country) => (await gc<{ id: string; name: string; logo?: string }[]>(`/institutions/?country=${encodeURIComponent(country)}`)).map((i) => ({ id: i.id, name: i.name, logo: i.logo ?? null })),
  start: async ({ accountRowId, institutionId, redirect }) => {
    const agreement = await gc<{ id: string }>("/agreements/enduser/", { method: "POST", body: { institution_id: institutionId, max_historical_days: 90, access_valid_for_days: 90, access_scope: ["balances", "details", "transactions"] } });
    const req = await gc<{ id: string; link: string }>("/requisitions/", { method: "POST", body: { redirect, institution_id: institutionId, reference: `${accountRowId}-${Date.now()}`, agreement: agreement.id, user_language: "EN" } });
    return { requisition: req.id, link: req.link };
  },
  status: async (requisition, iban) => {
    const r = await gc<{ status: string; accounts: string[] }>(`/requisitions/${requisition}/`);
    if (r.status === "EX" || r.status === "RJ") return { status: "EXPIRED" };
    if (r.status !== "LN") return { status: "PENDING" };
    // the requisition may hold several accounts: pick the one with this IBAN
    for (const id of r.accounts) {
      const d = await gc<{ iban?: string }>(`/accounts/${id}/`);
      if (cleanIban(d.iban) === cleanIban(iban)) return { status: "LINKED", accountId: id, consentUntil: new Date(Date.now() + 90 * 86_400_000) };
    }
    return { status: "ERROR", error: "The bank didn't share an account with this IBAN." };
  },
  fetch: async (feedAccountId, from) => {
    const t = await gc<{ transactions: { booked: GcTx[] } }>(`/accounts/${feedAccountId}/transactions/?date_from=${from}`);
    const lines: ParsedLine[] = t.transactions.booked.map((x) => {
      const amount = parseAmount(x.transactionAmount.amount, ".") ?? 0;
      const inbound = amount > 0;
      return {
        bookingDate: (x.bookingDate ?? x.valueDate ?? "").slice(0, 10), valueDate: x.valueDate?.slice(0, 10) ?? null, amount, currency: x.transactionAmount.currency,
        counterparty: (inbound ? x.debtorName : x.creditorName) ?? null,
        counterpartyIban: cleanIban((inbound ? x.debtorAccount : x.creditorAccount)?.iban) || null,
        remittance: [x.remittanceInformationUnstructured, ...(x.remittanceInformationUnstructuredArray ?? []), x.remittanceInformationStructured, x.additionalInformation].filter(Boolean).join(" ") || null,
        endToEndId: x.endToEndId && x.endToEndId !== "NOTPROVIDED" ? x.endToEndId : null,
        bankRef: x.transactionId ?? x.internalTransactionId ?? null,
      };
    }).filter((l) => l.bookingDate);
    let balance: number | null = null;
    try {
      const b = await gc<{ balances: { balanceAmount: { amount: string }; balanceType: string }[] }>(`/accounts/${feedAccountId}/balances/`);
      const pick = b.balances.find((x) => x.balanceType === "closingBooked") ?? b.balances.find((x) => x.balanceType === "interimBooked") ?? b.balances[0];
      balance = pick ? parseAmount(pick.balanceAmount.amount, ".") : null;
    } catch { /* balances are optional */ }
    return { lines, balance, balanceDate: new Date().toISOString().slice(0, 10) };
  },
};

export function feedProvider(key: string | null | undefined): FeedProvider {
  return key === "GOCARDLESS" ? gocardlessProvider : simProvider;
}
