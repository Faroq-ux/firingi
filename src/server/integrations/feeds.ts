/**
 * Saved import profiles and scheduled feeds: a supplier publishes its price / stock file at a
 * URL; FIRINGI fetches it every N hours and applies it like an upload — unless it looks wrong
 * (many bad rows, or prices changing by more than 50 %), then the run is held for the supplier
 * to check and apply by hand. Fetching is guarded: http(s) only (https in production), no
 * private / internal addresses, 30 s, 10 MB.
 */
import "server-only";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/server/db";
import { loadContext, type Ctx } from "@/server/context";
import { can } from "@/server/rbac/guard";
import { ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import { writeAudit } from "@/server/services/audit";
import { notify } from "@/server/notify/dispatch";
import { FIELDS, MAX_BYTES, applyImport, parseFile, previewImport, type Mapping, type Summary } from "./catalogue-import";

function requireManager(ctx: Ctx) {
  if ((ctx.company.type !== "DISTRIBUTOR" && ctx.company.type !== "WHOLESALER") || ctx.company.status !== "APPROVED" || !can(ctx, ["vendor.products.manage", "vendor.pricing.manage", "vendor.stock.manage"])) throw new ForbiddenError();
}

// ── safe fetching (SSRF guard) ──────────────────────────────────────────────

/** Private, loopback, link-local, CGNAT, multicast and other non-public addresses. */
export function isPrivateAddress(ip: string): boolean {
  if (isIP(ip) === 4) {
    const [a, b] = ip.split(".").map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  const v = ip.toLowerCase();
  if (v.startsWith("::ffff:")) return isPrivateAddress(v.slice(7));
  return v === "::1" || v === "::" || v.startsWith("fc") || v.startsWith("fd") || v.startsWith("fe80");
}

export async function assertPublicUrl(raw: string) {
  let u: URL;
  try { u = new URL(raw); } catch { throw new ValidationError("Enter a full address (https://…)."); }
  const prod = process.env.FIRINGI_ENV === "production";
  if (u.protocol !== "https:" && !(u.protocol === "http:" && !prod)) throw new ValidationError("Use an https:// address.");
  if (u.username || u.password) throw new ValidationError("Don't put a password in the address.");
  const host = u.hostname.replace(/^\[|\]$/g, "");
  const allowLocal = process.env.INTEGRATIONS_ALLOW_PRIVATE_URLS === "1" && !prod; // tests / local development only
  if (!allowLocal) {
    if (host === "localhost" || host.endsWith(".local") || host.endsWith(".internal")) throw new ValidationError("This address isn't reachable from the internet.");
    const ips = isIP(host) ? [host] : (await lookup(host, { all: true }).catch(() => [])).map((a) => a.address);
    if (!ips.length) throw new ValidationError(`Can't find ${host}.`);
    if (ips.some(isPrivateAddress)) throw new ValidationError("This address points to a private network.");
  }
  return u;
}

/** GET a file (≤ 10 MB, ≤ 3 redirects, each hop checked). */
export async function safeFetch(raw: string, accept = "*/*"): Promise<{ buf: Buffer; contentType: string | null; finalUrl: string }> {
  let url = (await assertPublicUrl(raw)).toString();
  for (let hop = 0; hop < 4; hop++) {
    const res = await fetch(url, { redirect: "manual", headers: { accept, "user-agent": "FIRINGI-feed/1.0" }, signal: AbortSignal.timeout(30_000) });
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      url = (await assertPublicUrl(new URL(res.headers.get("location")!, url).toString())).toString();
      continue;
    }
    if (!res.ok) throw new Error(`The server answered HTTP ${res.status}`);
    if (Number(res.headers.get("content-length") ?? 0) > MAX_BYTES) throw new Error("The file is larger than 10 MB");
    const reader = res.body?.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (reader) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > MAX_BYTES) { await reader.cancel(); throw new Error("The file is larger than 10 MB"); }
      chunks.push(value);
    }
    return { buf: Buffer.concat(chunks), contentType: res.headers.get("content-type"), finalUrl: url };
  }
  throw new Error("Too many redirects");
}

// ── profiles ───────────────────────────────────────────────────────────────

export async function listProfiles(ctx: Ctx) {
  requireManager(ctx);
  return prisma.importProfile.findMany({ where: { companyId: ctx.company.id }, orderBy: { createdAt: "asc" }, include: { runs: { orderBy: { createdAt: "desc" }, take: 1, select: { status: true, summary: true, heldReason: true, error: true, createdAt: true } } } });
}

function cleanMapping(m: Mapping): Mapping {
  const out: Mapping = {};
  const used = new Set<string>();
  for (const [col, f] of Object.entries(m ?? {})) {
    if (!f) { out[col] = ""; continue; }
    if (!(FIELDS as readonly string[]).includes(f)) throw new ValidationError(`Unknown field ${f}.`);
    if (used.has(f)) throw new ValidationError(`"${f}" is mapped to two columns.`);
    used.add(f); out[col.slice(0, 120)] = f;
  }
  return out;
}

export async function saveProfile(ctx: Ctx, input: { id?: string; name: string; mapping: Mapping; feedUrl?: string | null; everyHours?: number | null; enabled?: boolean }) {
  requireManager(ctx);
  const name = input.name?.trim();
  if (!name) throw new ValidationError("Give the import a name.");
  const mapping = cleanMapping(input.mapping);
  const feedUrl = input.feedUrl?.trim() || null;
  if (feedUrl) await assertPublicUrl(feedUrl);
  const everyHours = feedUrl ? Math.min(168, Math.max(1, Number(input.everyHours) || 6)) : null;
  const data = { name, mapping: mapping as Prisma.InputJsonValue, feedUrl, everyHours, enabled: input.enabled ?? true };
  const row = input.id
    ? await prisma.importProfile.update({ where: { id: (await ownProfile(ctx, input.id)).id }, data })
    : await prisma.importProfile.create({ data: { ...data, companyId: ctx.company.id, createdById: ctx.user.id } });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: input.id ? "import_profile.updated" : "import_profile.created", entityType: "ImportProfile", entityId: row.id, after: { name, feedUrl, everyHours } });
  return row;
}

async function ownProfile(ctx: Ctx, id: string) {
  const p = await prisma.importProfile.findFirst({ where: { id, companyId: ctx.company.id } });
  if (!p) throw new NotFoundError("Import");
  return p;
}

export async function deleteProfile(ctx: Ctx, id: string) {
  requireManager(ctx);
  const p = await ownProfile(ctx, id);
  await prisma.importProfile.delete({ where: { id: p.id } });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "import_profile.deleted", entityType: "ImportProfile", entityId: p.id });
}

// ── running feeds ──────────────────────────────────────────────────────────

const HOLD_ERROR_SHARE = 0.2;

/** Fetch a profile's feed now (job, or "Run now"). Applies it unless it looks wrong. */
export async function runFeed(profileId: string, by?: Ctx) {
  const p = await prisma.importProfile.findUnique({ where: { id: profileId } });
  if (!p?.feedUrl) throw new NotFoundError("Feed");
  if (by && by.company.id !== p.companyId) throw new NotFoundError("Feed");
  await prisma.importProfile.update({ where: { id: p.id }, data: { lastRunAt: new Date() } });
  // The feed acts as the person who set it up (their permissions, their audit trail).
  const ctx = by ?? (await loadContext(p.createdById, "feed", p.companyId));
  const previousFailed = (await prisma.importRun.findFirst({ where: { profileId: p.id }, orderBy: { createdAt: "desc" }, select: { status: true } }))?.status === "FAILED";
  let fileName = p.feedUrl.split("/").pop()?.split("?")[0] || "feed";
  try {
    if (!ctx) throw new Error("The person who set up this feed no longer has access — set it up again.");
    const { buf, finalUrl } = await safeFetch(p.feedUrl);
    fileName = finalUrl.split("/").pop()?.split("?")[0] || fileName;
    const sheet = await parseFile(buf, fileName);
    const run = await previewImport(ctx, { sheet, mapping: p.mapping as Mapping, source: "URL", fileName, profileId: p.id });
    const s = run.summary as unknown as Summary;
    const hold = s.bigChanges > 0 ? `${s.bigChanges} prices change by more than 50 %` : s.total && s.errors / s.total > HOLD_ERROR_SHARE ? `${s.errors} of ${s.total} rows have errors` : null;
    if (hold) {
      await prisma.importRun.update({ where: { id: run.id }, data: { heldReason: hold } });
      await notify("integration.feed_held", [{ companyId: p.companyId, link: `/vendor/products/import/${run.id}` }], { name: p.name, reason: hold }, { ref: { type: "ImportRun", id: run.id } });
      return { status: "HELD" as const, runId: run.id, reason: hold };
    }
    const result = await applyImport(ctx, run.id);
    return { status: "APPLIED" as const, runId: run.id, ...result };
  } catch (e) {
    const message = (e instanceof Error ? e.message : String(e)).slice(0, 500);
    const run = await prisma.importRun.create({ data: { companyId: p.companyId, profileId: p.id, source: "URL", fileName, status: "FAILED", rows: [], summary: {}, error: message } });
    if (!previousFailed) await notify("integration.feed_failed", [{ companyId: p.companyId, link: "/vendor/products/import" }], { name: p.name, reason: message }, { ref: { type: "ImportRun", id: run.id } });
    return { status: "FAILED" as const, runId: run.id, error: message };
  }
}

/** The integrations job: feeds that are due. */
export async function processFeeds(now = new Date()) {
  const due = await prisma.importProfile.findMany({ where: { enabled: true, feedUrl: { not: null }, everyHours: { not: null } }, select: { id: true, everyHours: true, lastRunAt: true } });
  const out = { ran: 0, applied: 0, held: 0, failed: 0 };
  for (const p of due) {
    if (p.lastRunAt && now.getTime() - p.lastRunAt.getTime() < p.everyHours! * 3600_000 - 60_000) continue;
    const r = await runFeed(p.id);
    out.ran++;
    if (r.status === "APPLIED") out.applied++; else if (r.status === "HELD") out.held++; else out.failed++;
  }
  return out;
}
