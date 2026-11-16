/**
 * Bank reconciliation (Phase 37): bank accounts, statement imports (CAMT.053 / MT940 / CSV / Excel),
 * the daily bank feed, rules and remembered payers. Matching lives in ./match.ts.
 *
 * Owners: FIRINGI's finance team ("FIRINGI") and each supplier / customer for its own books.
 */
import "server-only";
import { randomBytes } from "node:crypto";
import type { BankFormat, BankMatchKind, Prisma } from "@prisma/client";
import { prisma } from "@/server/db";
import type { Ctx } from "@/server/context";
import { can } from "@/server/rbac/guard";
import { AppError, ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import { writeAudit } from "@/server/services/audit";
import { cleanIban, dedupeKeys, detectFormat, isIban, round2, StatementError, type ParsedLine, type ParsedStatement } from "@/lib/bank/common";
import { parseCamt } from "@/lib/bank/camt";
import { parseMt940 } from "@/lib/bank/mt940";
import { guessMapping, linesFromRows, type CsvMapping } from "@/lib/bank/csv";
import { DEFAULT_BANK_SETTINGS, type BankSettings } from "@/lib/bank/settings";
import { feedProvider } from "./feed";

export type Owner = { key: string; companyId: string | null; side: "FIRINGI" | "VENDOR" | "BUYER" };
export const FIRINGI: Owner = { key: "FIRINGI", companyId: null, side: "FIRINGI" };
const MAX_BYTES = 10 * 1024 * 1024;
const appUrl = () => (process.env.APP_URL ?? process.env.BETTER_AUTH_URL ?? "http://localhost:3000").replace(/\/$/, "");

// ── who ─────────────────────────────────────────────────────────────────────

/** The books this user works on: FIRINGI's (finance staff) or their own company's. */
export function ownerOf(ctx: Ctx, manage = false): Owner {
  if (ctx.company.type === "ADMIN") {
    if (!can(ctx, manage ? "admin.finance.manage" : ["admin.finance.view", "admin.finance.manage"])) throw new ForbiddenError();
    return FIRINGI;
  }
  if (ctx.company.status !== "APPROVED") throw new ForbiddenError();
  if (!ctx.membership.isOwner && !can(ctx, manage ? "company.bank.manage" : ["company.bank.view", "company.bank.manage"])) throw new ForbiddenError();
  const vendor = ctx.company.type === "DISTRIBUTOR" || ctx.company.type === "WHOLESALER";
  return { key: ctx.company.id, companyId: ctx.company.id, side: vendor ? "VENDOR" : "BUYER" };
}

/** Owner of an account row (for jobs). */
export async function ownerOfAccount(accountId: string): Promise<Owner> {
  const a = await prisma.bankAccount.findUniqueOrThrow({ where: { id: accountId }, include: { company: { select: { type: true } } } });
  if (!a.companyId) return FIRINGI;
  const vendor = a.company?.type === "DISTRIBUTOR" || a.company?.type === "WHOLESALER";
  return { key: a.companyId, companyId: a.companyId, side: vendor ? "VENDOR" : "BUYER" };
}

// ── settings ────────────────────────────────────────────────────────────────

const KEY = "bank.settings";
export async function bankSettings(): Promise<BankSettings> {
  const row = await prisma.setting.findFirst({ where: { scope: "GLOBAL", scopeId: "", key: KEY } });
  const v = (row?.value as Partial<BankSettings>) ?? {};
  return { ...DEFAULT_BANK_SETTINGS, ...v, feed: { ...DEFAULT_BANK_SETTINGS.feed, ...(v.feed ?? {}) } };
}

export async function saveBankSettings(ctx: Ctx, input: BankSettings) {
  if (ctx.company.type !== "ADMIN" || !can(ctx, ["admin.finance.manage", "admin.settings.manage"])) throw new ForbiddenError();
  const n = (x: number, lo: number, hi: number, label: string) => { if (!Number.isFinite(x) || x < lo || x > hi) throw new ValidationError(`${label} must be between ${lo} and ${hi}.`); return x; };
  const v: BankSettings = {
    firingiMode: input.firingiMode === "AUTO" ? "AUTO" : "CONFIRM",
    autoConfidence: n(input.autoConfidence, 50, 100, "The confidence for booking by itself"),
    companiesMayAuto: !!input.companiesMayAuto,
    companyAutoConfidence: n(input.companyAutoConfidence, 50, 100, "The suppliers' and customers' confidence"),
    toleranceAmount: n(input.toleranceAmount, 0, 100, "The tolerance"),
    tolerancePct: n(input.tolerancePct, 0, 10, "The tolerance (%)"),
    windowDays: Math.round(n(input.windowDays, 1, 90, "The date window")),
    feed: { enabled: !!input.feed?.enabled, provider: input.feed?.provider === "GOCARDLESS" ? "GOCARDLESS" : "SIMULATED", companiesMayLink: !!input.feed?.companiesMayLink },
  };
  const before = await bankSettings();
  const row = await prisma.setting.findFirst({ where: { scope: "GLOBAL", scopeId: "", key: KEY } });
  if (row) await prisma.setting.update({ where: { id: row.id }, data: { value: v } });
  else await prisma.setting.create({ data: { scope: "GLOBAL", scopeId: "", key: KEY, value: v } });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "bank.settings_saved", entityType: "Setting", entityId: KEY, before, after: v });
  return v;
}

// ── accounts ────────────────────────────────────────────────────────────────

export async function listAccounts(owner: Owner) {
  const rows = await prisma.bankAccount.findMany({ where: { ownerKey: owner.key }, orderBy: [{ active: "desc" }, { createdAt: "asc" }] });
  const counts = await prisma.bankLine.groupBy({ by: ["accountId", "status"], where: { accountId: { in: rows.map((r) => r.id) } }, _count: true });
  const last = await prisma.bankStatement.groupBy({ by: ["accountId"], where: { accountId: { in: rows.map((r) => r.id) } }, _max: { createdAt: true, toDate: true } });
  return rows.map((a) => {
    const c = (s: string) => counts.find((x) => x.accountId === a.id && x.status === s)?._count ?? 0;
    const l = last.find((x) => x.accountId === a.id);
    return { ...a, toReview: c("OPEN") + c("SUGGESTED"), suggested: c("SUGGESTED"), matched: c("MATCHED"), ignored: c("IGNORED"), lastImport: l?._max.createdAt ?? null, lastDate: l?._max.toDate ?? null };
  });
}

export async function accountFor(owner: Owner, id: string) {
  const a = await prisma.bankAccount.findFirst({ where: { id, ownerKey: owner.key } });
  if (!a) throw new NotFoundError("Bank account");
  return a;
}

export async function saveAccount(ctx: Ctx, i: { id?: string | null; name: string; iban: string; bic?: string | null; currencyCode?: string; legalEntityId?: string | null; active?: boolean }) {
  const owner = ownerOf(ctx, true);
  const iban = cleanIban(i.iban);
  if (!isIban(iban)) throw new ValidationError("Enter a valid IBAN.");
  const name = i.name.trim().slice(0, 80);
  if (!name) throw new ValidationError("Give the account a name.");
  const data = { name, iban, bic: i.bic?.trim().toUpperCase().slice(0, 11) || null, currencyCode: (i.currencyCode ?? "EUR").toUpperCase().slice(0, 3), legalEntityId: owner.side === "FIRINGI" ? i.legalEntityId || null : null, active: i.active ?? true };
  const clash = await prisma.bankAccount.findFirst({ where: { ownerKey: owner.key, iban, ...(i.id ? { id: { not: i.id } } : {}) } });
  if (clash) throw new ValidationError("This IBAN is already one of your accounts.");
  const a = i.id
    ? await prisma.bankAccount.update({ where: { id: (await accountFor(owner, i.id)).id }, data })
    : await prisma.bankAccount.create({ data: { ...data, ownerKey: owner.key, companyId: owner.companyId } });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: i.id ? "bank.account_updated" : "bank.account_added", entityType: "BankAccount", entityId: a.id, after: { name, iban, owner: owner.key } });
  return a;
}

export async function deleteAccount(ctx: Ctx, id: string) {
  const owner = ownerOf(ctx, true);
  const a = await accountFor(owner, id);
  const matched = await prisma.bankLine.count({ where: { accountId: a.id, status: "MATCHED" } });
  if (matched) { // keep the history: switch it off instead
    await prisma.bankAccount.update({ where: { id: a.id }, data: { active: false } });
    return { deactivated: true };
  }
  await prisma.bankAccount.delete({ where: { id: a.id } });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "bank.account_deleted", entityType: "BankAccount", entityId: a.id, before: { name: a.name, iban: a.iban } });
  return { deactivated: false };
}

/** FIRINGI's invoicing entities (an account belongs to one). */
export async function bankEntities(owner: Owner) {
  if (owner.side !== "FIRINGI") return [];
  return prisma.legalEntity.findMany({ where: { isActive: true }, select: { id: true, legalName: true } });
}

// ── importing ───────────────────────────────────────────────────────────────

export type ImportPreview = { needsMapping: true; fileToken: string; fileName: string; rows: string[][]; guess: CsvMapping };
export type ImportResult = { needsMapping: false; statementId: string; lines: number; newLines: number; duplicates: number; autoMatched: number; suggested: number; balanceOk: boolean | null; skipped: number };

/** Files waiting for their CSV mapping (kept 1 hour). */
const pending = new Map<string, { owner: string; accountId: string; buf: Buffer; name: string; at: number }>();

async function sheetRows(buf: Buffer, name: string): Promise<string[][]> {
  const { parseCsv, parseXlsx } = await import("@/server/integrations/catalogue-import");
  const isZip = buf[0] === 0x50 && buf[1] === 0x4b;
  const s = isZip || /\.xlsx$/i.test(name) ? await parseXlsx(buf) : parseCsv(decodeText(buf));
  return [s.headers, ...s.rows];
}

/** UTF-8, or Windows-1252 / Latin-1 (many banks still export that). */
function decodeText(buf: Buffer) {
  const utf = buf.toString("utf8");
  return utf.includes("�") ? new TextDecoder("windows-1252").decode(buf) : utf;
}

export async function importStatement(ctx: Ctx, accountId: string, file: { name: string; buf: Buffer } | { token: string }, mapping?: CsvMapping | null, opts: { saveMapping?: boolean; remap?: boolean } = {}): Promise<ImportPreview | ImportResult> {
  const owner = ownerOf(ctx, true);
  const account = await accountFor(owner, accountId);
  for (const [k, v] of pending) if (Date.now() - v.at > 3_600_000) pending.delete(k);
  let buf: Buffer, name: string;
  if ("token" in file) {
    const p = pending.get(file.token);
    if (!p || p.owner !== owner.key || p.accountId !== account.id) throw new ValidationError("Upload the file again.");
    buf = p.buf; name = p.name;
  } else { buf = file.buf; name = file.name.slice(0, 200); }
  if (!buf.length) throw new ValidationError("The file is empty.");
  if (buf.length > MAX_BYTES) throw new ValidationError("The file is larger than 10 MB.");
  const text = buf[0] === 0x50 && buf[1] === 0x4b ? "PK" : decodeText(buf);
  const format = detectFormat(text, name);
  if (!format) throw new ValidationError("This doesn't look like a bank statement (CAMT.053, MT940, CSV or Excel).");

  let stmt: ParsedStatement;
  let skipped = 0;
  try {
    if (format === "CAMT053" || format === "MT940") {
      const all = format === "CAMT053" ? parseCamt(text) : parseMt940(text);
      const mine = all.filter((s) => !s.iban || cleanIban(s.iban) === account.iban);
      if (!mine.length) throw new ValidationError(`This statement is for ${all.map((s) => s.iban).filter(Boolean).join(", ")}, not ${account.iban}.`);
      stmt = mine.length === 1 ? mine[0] : { ...mine[0], lines: mine.flatMap((s) => s.lines), closingBalance: mine.at(-1)!.closingBalance, toDate: mine.at(-1)!.toDate };
    } else {
      const rows = await sheetRows(buf, name);
      const m = opts.remap ? mapping : mapping ?? (account.csvMapping as CsvMapping | null);
      let r: ReturnType<typeof linesFromRows> | null = null;
      if (m) {
        try { r = linesFromRows(rows, m); } catch (e) { if (mapping || !(e instanceof StatementError)) throw e; } // the saved columns don't fit this file: ask again
      }
      if (!r || (!mapping && !r.lines.length)) {
        const token = randomBytes(12).toString("base64url");
        pending.set(token, { owner: owner.key, accountId: account.id, buf, name, at: Date.now() });
        return { needsMapping: true, fileToken: token, fileName: name, rows: rows.slice(0, 25), guess: (account.csvMapping as CsvMapping | null) ?? guessMapping(rows) };
      }
      skipped = r.skipped;
      if (!r.lines.length) throw new ValidationError("No lines with a date and an amount were found — check the columns.");
      stmt = { format, lines: r.lines, fromDate: r.lines.map((l) => l.bookingDate).sort()[0], toDate: r.lines.map((l) => l.bookingDate).sort().at(-1) };
      if (mapping && (opts.saveMapping ?? true)) await prisma.bankAccount.update({ where: { id: account.id }, data: { csvMapping: mapping as unknown as Prisma.InputJsonValue } });
    }
  } catch (e) {
    if (e instanceof StatementError) throw new ValidationError(e.message);
    throw e;
  }
  if ("token" in file) pending.delete(file.token);
  const res = await storeLines(owner, account.id, stmt, { fileName: name, userId: ctx.user.id, raw: buf });
  return { needsMapping: false, ...res, skipped };
}

/** Save a statement's lines (duplicates dropped), then suggest / book matches. */
export async function storeLines(owner: Owner, accountId: string, stmt: ParsedStatement, o: { fileName?: string | null; userId?: string | null; raw?: Buffer } = {}) {
  const account = await prisma.bankAccount.findUniqueOrThrow({ where: { id: accountId } });
  const lines = stmt.lines.filter((l) => !l.currency || l.currency === account.currencyCode);
  const keys = dedupeKeys(lines);
  const sum = round2(stmt.lines.reduce((a, l) => a + l.amount, 0));
  const balanceOk = stmt.openingBalance != null && stmt.closingBalance != null ? Math.abs(round2(stmt.openingBalance + sum) - stmt.closingBalance) < 0.005 : null;
  const st = await prisma.bankStatement.create({
    data: {
      accountId, format: stmt.format as BankFormat, fileName: o.fileName ?? null, bankStatementId: stmt.bankStatementId ?? null,
      fromDate: stmt.fromDate ? new Date(stmt.fromDate) : null, toDate: stmt.toDate ? new Date(stmt.toDate) : null,
      openingBalance: stmt.openingBalance ?? null, closingBalance: stmt.closingBalance ?? null, balanceOk, lineCount: lines.length, importedById: o.userId ?? null,
    },
  });
  const created = await prisma.bankLine.createManyAndReturn({
    data: lines.map((l, i) => ({
      accountId, statementId: st.id, bookingDate: new Date(l.bookingDate), valueDate: l.valueDate ? new Date(l.valueDate) : null, amount: l.amount.toFixed(2), currencyCode: l.currency || account.currencyCode,
      counterparty: l.counterparty?.slice(0, 140) ?? null, counterpartyIban: cleanIban(l.counterpartyIban) || null, remittance: l.remittance?.slice(0, 500) ?? null,
      endToEndId: l.endToEndId?.slice(0, 80) ?? null, bankRef: l.bankRef?.slice(0, 80) ?? null, dedupeKey: keys[i],
    })),
    skipDuplicates: true, select: { id: true },
  });
  if (o.raw) {
    try { await (await import("@/server/services/storage")).putObject(`bank/${owner.key}/${st.id}`, o.raw, "application/octet-stream"); } catch { /* the lines are what matters */ }
  }
  // the account's balance from the newest statement that states one
  if (stmt.closingBalance != null && stmt.toDate && (!account.balanceAt || new Date(stmt.toDate) >= account.balanceAt))
    await prisma.bankAccount.update({ where: { id: accountId }, data: { balance: stmt.closingBalance.toFixed(2), balanceAt: new Date(stmt.toDate) } });
  const { matchLines } = await import("./match");
  const r = await matchLines(owner, created.map((c) => c.id));
  await prisma.bankStatement.update({ where: { id: st.id }, data: { newLines: created.length, duplicates: lines.length - created.length, autoMatched: r.booked } });
  if (o.userId) await writeAudit({ actorUserId: o.userId, actorCompanyId: owner.companyId, action: "bank.statement_imported", entityType: "BankStatement", entityId: st.id, after: { account: account.iban, format: stmt.format, lines: lines.length, new: created.length, autoMatched: r.booked } });
  return { statementId: st.id, lines: lines.length, newLines: created.length, duplicates: lines.length - created.length, autoMatched: r.booked, suggested: r.suggested, balanceOk };
}

export async function listStatements(owner: Owner, accountId?: string) {
  return prisma.bankStatement.findMany({ where: { account: { ownerKey: owner.key }, ...(accountId ? { accountId } : {}) }, include: { account: { select: { name: true, iban: true } } }, orderBy: { createdAt: "desc" }, take: 50 });
}

// ── bank feed ───────────────────────────────────────────────────────────────

async function feedAllowed(owner: Owner) {
  const s = await bankSettings();
  if (!s.feed.enabled) throw new AppError("FEED_OFF", "The bank feed isn't switched on.", 409);
  if (owner.side !== "FIRINGI" && !s.feed.companiesMayLink) throw new AppError("FEED_OFF", "The bank feed isn't available for companies yet.", 409);
  const p = feedProvider(s.feed.provider);
  if (!p.ready()) throw new AppError("FEED_NOT_READY", "The bank feed provider isn't set up.", 409);
  return p;
}

export async function feedInstitutions(ctx: Ctx, country: string) {
  const p = await feedAllowed(ownerOf(ctx, true));
  return p.institutions(country.toUpperCase().slice(0, 2));
}

/** Start the bank's consent: returns the link the user opens. */
export async function linkFeed(ctx: Ctx, accountId: string, institutionId: string, returnTo: string) {
  const owner = ownerOf(ctx, true);
  const a = await accountFor(owner, accountId);
  const p = await feedAllowed(owner);
  const back = `${appUrl()}/api/bank/feed/callback?account=${encodeURIComponent(a.id)}&return=${encodeURIComponent(returnTo)}`;
  const r = await p.start({ accountRowId: a.id, iban: a.iban, institutionId, redirect: back });
  await prisma.bankAccount.update({ where: { id: a.id }, data: { feedProvider: p.key, feedRequisition: r.requisition, feedStatus: "PENDING", feedError: null } });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "bank.feed_link_started", entityType: "BankAccount", entityId: a.id, after: { provider: p.key, institutionId } });
  // the simulated bank approves at once: go straight to the callback
  return { link: p.key === "SIMULATED" ? back : r.link };
}

/** The bank sent the user back: check the consent, then fetch. */
export async function feedCallback(accountId: string) {
  const a = await prisma.bankAccount.findUnique({ where: { id: accountId } });
  if (!a?.feedRequisition) throw new NotFoundError("Bank account");
  const st = await feedProvider(a.feedProvider).status(a.feedRequisition, a.iban);
  await prisma.bankAccount.update({ where: { id: a.id }, data: { feedStatus: st.status, feedAccountId: st.accountId ?? a.feedAccountId, feedConsentUntil: st.consentUntil ?? a.feedConsentUntil, feedError: st.error ?? null } });
  if (st.status === "LINKED") await syncFeed(a.id).catch(() => null);
  return st;
}

export async function unlinkFeed(ctx: Ctx, accountId: string) {
  const owner = ownerOf(ctx, true);
  const a = await accountFor(owner, accountId);
  await prisma.bankAccount.update({ where: { id: a.id }, data: { feedProvider: null, feedRequisition: null, feedAccountId: null, feedStatus: null, feedConsentUntil: null, feedError: null } });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "bank.feed_unlinked", entityType: "BankAccount", entityId: a.id });
}

/** Fetch new transactions for a linked account (from a few days before the last fetch). */
export async function syncFeed(accountId: string) {
  const a = await prisma.bankAccount.findUniqueOrThrow({ where: { id: accountId } });
  if (a.feedStatus !== "LINKED" || !a.feedAccountId) throw new AppError("FEED_NOT_LINKED", "This account isn't linked to the bank feed.", 409);
  if (a.feedConsentUntil && a.feedConsentUntil < new Date()) {
    await prisma.bankAccount.update({ where: { id: a.id }, data: { feedStatus: "EXPIRED" } });
    throw new AppError("FEED_EXPIRED", "The bank's consent ended — link the account again.", 409);
  }
  const from = new Date((a.feedLastAt ?? new Date(Date.now() - 90 * 86_400_000)).getTime() - 5 * 86_400_000).toISOString().slice(0, 10);
  try {
    const r = await feedProvider(a.feedProvider).fetch(a.feedAccountId, from);
    const owner = await ownerOfAccount(a.id);
    const res = r.lines.length ? await storeLines(owner, a.id, { format: "FEED", lines: r.lines, fromDate: from, toDate: r.balanceDate ?? null }) : null;
    await prisma.bankAccount.update({ where: { id: a.id }, data: { feedLastAt: new Date(), feedError: null, ...(r.balance != null ? { balance: r.balance.toFixed(2), balanceAt: new Date(r.balanceDate ?? new Date().toISOString().slice(0, 10)) } : {}) } });
    return res ?? { statementId: null, lines: 0, newLines: 0, duplicates: 0, autoMatched: 0, suggested: 0, balanceOk: null };
  } catch (e) {
    await prisma.bankAccount.update({ where: { id: a.id }, data: { feedError: (e as Error).message.slice(0, 300) } });
    throw e;
  }
}

export async function syncFeedNow(ctx: Ctx, accountId: string) {
  const owner = ownerOf(ctx, true);
  const a = await accountFor(owner, accountId);
  return syncFeed(a.id);
}

// ── rules and remembered payers ─────────────────────────────────────────────

export async function listRules(owner: Owner) {
  return prisma.bankRule.findMany({ where: { ownerKey: owner.key }, orderBy: { createdAt: "asc" } });
}

export async function saveRule(ctx: Ctx, i: { id?: string | null; name: string; contains: string; direction?: "IN" | "OUT" | null; kind: "FEE" | "OTHER"; category?: string | null; active?: boolean }) {
  const owner = ownerOf(ctx, true);
  const contains = i.contains.trim().slice(0, 80);
  if (contains.length < 3) throw new ValidationError("The text to look for needs at least 3 characters.");
  const data = { name: (i.name.trim() || contains).slice(0, 80), contains, direction: i.direction === "IN" || i.direction === "OUT" ? i.direction : null, kind: (i.kind === "FEE" ? "FEE" : "OTHER") as BankMatchKind, category: i.category?.slice(0, 40) || null, active: i.active ?? true };
  const r = i.id
    ? await prisma.bankRule.update({ where: { id: (await prisma.bankRule.findFirstOrThrow({ where: { id: i.id, ownerKey: owner.key } })).id }, data })
    : await prisma.bankRule.create({ data: { ...data, ownerKey: owner.key } });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "bank.rule_saved", entityType: "BankRule", entityId: r.id, after: data });
  // apply it to the lines waiting now
  const waiting = await prisma.bankLine.findMany({ where: { account: { ownerKey: owner.key }, status: { in: ["OPEN", "SUGGESTED"] } }, select: { id: true } });
  if (waiting.length) await (await import("./match")).matchLines(owner, waiting.map((w) => w.id));
  return r;
}

export async function deleteRule(ctx: Ctx, id: string) {
  const owner = ownerOf(ctx, true);
  await prisma.bankRule.deleteMany({ where: { id, ownerKey: owner.key } });
}

export async function listPayerLinks(owner: Owner) {
  const rows = await prisma.bankPayerLink.findMany({ where: { ownerKey: owner.key }, orderBy: { updatedAt: "desc" }, take: 300 });
  const names = await prisma.company.findMany({ where: { id: { in: rows.map((r) => r.companyId).filter((x): x is string => !!x) } }, select: { id: true, legalName: true } });
  return rows.map((r) => ({ ...r, company: names.find((n) => n.id === r.companyId)?.legalName ?? null }));
}

export async function deletePayerLink(ctx: Ctx, id: string) {
  const owner = ownerOf(ctx, true);
  await prisma.bankPayerLink.deleteMany({ where: { id, ownerKey: owner.key } });
}

// ── lists ───────────────────────────────────────────────────────────────────

export type LineFilter = { accountId?: string; status?: "TODO" | "MATCHED" | "IGNORED" | "ALL"; q?: string; from?: string; to?: string; take?: number };

export async function listLines(owner: Owner, f: LineFilter = {}) {
  const where: Prisma.BankLineWhereInput = {
    account: { ownerKey: owner.key },
    ...(f.accountId ? { accountId: f.accountId } : {}),
    ...(f.status === "MATCHED" ? { status: "MATCHED" } : f.status === "IGNORED" ? { status: "IGNORED" } : f.status === "ALL" ? {} : { status: { in: ["OPEN", "SUGGESTED"] } }),
    ...(f.from || f.to ? { bookingDate: { ...(f.from ? { gte: new Date(f.from) } : {}), ...(f.to ? { lte: new Date(f.to) } : {}) } } : {}),
    ...(f.q ? { OR: [{ counterparty: { contains: f.q, mode: "insensitive" } }, { remittance: { contains: f.q, mode: "insensitive" } }, { counterpartyIban: { contains: cleanIban(f.q) } }] } : {}),
  };
  return prisma.bankLine.findMany({
    where, orderBy: [{ bookingDate: "desc" }, { createdAt: "desc" }], take: Math.min(f.take ?? 200, 500),
    include: { account: { select: { name: true, iban: true } }, matches: { include: { payment: { select: { id: true, amount: true, method: true, reference: true, direction: true, company: { select: { legalName: true } }, allocations: { select: { amount: true, invoice: { select: { fullNumber: true, providerNumber: true } }, vendorInvoice: { select: { externalNumber: true } } } } } } } } },
  });
}

export async function bankOverview(owner: Owner) {
  const [accounts, todo, matched30, autoMatched30, oldest] = await Promise.all([
    listAccounts(owner),
    prisma.bankLine.count({ where: { account: { ownerKey: owner.key }, status: { in: ["OPEN", "SUGGESTED"] } } }),
    prisma.bankLine.count({ where: { account: { ownerKey: owner.key }, status: "MATCHED", matchedAt: { gte: new Date(Date.now() - 30 * 86_400_000) } } }),
    prisma.bankLine.count({ where: { account: { ownerKey: owner.key }, status: "MATCHED", autoMatched: true, matchedAt: { gte: new Date(Date.now() - 30 * 86_400_000) } } }),
    prisma.bankLine.findFirst({ where: { account: { ownerKey: owner.key }, status: { in: ["OPEN", "SUGGESTED"] } }, orderBy: { bookingDate: "asc" }, select: { bookingDate: true } }),
  ]);
  return { accounts, todo, matched30, autoMatched30, oldestTodo: oldest?.bookingDate ?? null };
}

/** Lines to queue for the simulated bank (dev / tests): validated shape. */
export function simLines(input: unknown): ParsedLine[] {
  if (!Array.isArray(input)) throw new ValidationError("lines must be a list");
  return input.slice(0, 200).map((x) => {
    const l = x as Record<string, unknown>;
    const amount = Number(l.amount);
    const bookingDate = String(l.bookingDate ?? new Date().toISOString().slice(0, 10)).slice(0, 10);
    if (!Number.isFinite(amount) || !/^\d{4}-\d{2}-\d{2}$/.test(bookingDate)) throw new ValidationError("each line needs bookingDate (YYYY-MM-DD) and amount");
    const s = (k: string) => (typeof l[k] === "string" ? (l[k] as string).slice(0, 300) : null);
    return { bookingDate, amount: round2(amount), counterparty: s("counterparty"), counterpartyIban: s("counterpartyIban"), remittance: s("remittance"), endToEndId: s("endToEndId"), bankRef: s("bankRef") };
  });
}
