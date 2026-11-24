import "server-only";
/**
 * Smart product search — Phase 72.
 *
 *  • Matching: every search word (or one of its synonyms) must be found in the product's search text (names in every
 *    language, brand, codes) — accent-insensitive and, with fuzzy on, despite small typos (pg_trgm word similarity on
 *    an unaccented, indexed copy of Product.searchText). Ranked by how well the words match.
 *  • AI: the query is read once by Claude ("mozarela sem gluten até 8 €" → mozzarella + its names in other languages,
 *    gluten-free, max 8 €); the answer is kept (SearchUnderstanding) and its word lists become synonyms that help every
 *    later search, also without AI. Simulated in development / browser tests.
 *  • Synonyms: FIRINGI's own list (source ADMIN, never overwritten by the AI) plus what the AI learnt.
 * FIRINGI switches each part on or off (Setting "search.settings").
 */
import type Anthropic from "@anthropic-ai/sdk";
import { Prisma } from "@prisma/client";
import { prisma } from "@/server/db";
import type { Ctx } from "@/server/context";
import { can } from "@/server/rbac/guard";
import { ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import { writeAudit } from "@/server/services/audit";
import { aiSettings, aiTransport } from "@/server/ai/assistant";
import { logAi } from "@/server/ai/feed";
import { ALLERGENS, DIETS } from "@/lib/food";
import {
  SEARCH_DEFAULTS, SORTS, Understanding, cleanAlternatives, cleanSearchSettings, normalize, searchWords,
  type SearchSettings,
} from "@/lib/search";

const KEY = "search.settings";
const CACHE_DAYS = 30;

// ── settings ───────────────────────────────────────────────────────────────

export async function searchSettings(): Promise<SearchSettings> {
  const row = await prisma.setting.findFirst({ where: { scope: "GLOBAL", scopeId: "", key: KEY } });
  return cleanSearchSettings({ ...SEARCH_DEFAULTS, ...((row?.value as Partial<SearchSettings>) ?? {}) });
}

function staff(ctx: Ctx, manage = true) {
  if (ctx.company.type !== "ADMIN" || !can(ctx, manage ? "admin.catalogue.manage" : ["admin.catalogue.view", "admin.catalogue.manage"])) throw new ForbiddenError();
}

export async function saveSearchSettings(ctx: Ctx, input: Partial<SearchSettings>) {
  staff(ctx);
  const before = await searchSettings();
  const next = cleanSearchSettings({ ...before, ...input });
  await prisma.setting.upsert({
    where: { scope_scopeId_key: { scope: "GLOBAL", scopeId: "", key: KEY } },
    update: { value: next as unknown as Prisma.InputJsonValue, updatedById: ctx.user.id },
    create: { scope: "GLOBAL", key: KEY, value: next as unknown as Prisma.InputJsonValue, updatedById: ctx.user.id },
  });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "search.settings", entityType: "Setting", entityId: KEY, before, after: next });
  return next;
}

/** Can the AI read queries right now (switched on, an AI connected or simulated, AI governance not stopped)? */
const simulating = () => process.env.ASSISTANT_SIMULATE === "1" && !process.env.ANTHROPIC_API_KEY && process.env.FIRINGI_ENV !== "production";
export async function searchAiStatus() {
  const s = await searchSettings();
  const configured = !!aiTransport() || simulating();
  const governed = (await (await import("@/server/ai/ops/governance")).governance()).enabled;
  return { on: s.ai, configured, ready: s.ai && configured && governed };
}

// ── synonyms ───────────────────────────────────────────────────────────────

/** For each search word: the word plus every synonym it shares a row with (either direction), unless switched off. */
export async function expandWords(words: string[], settings?: SearchSettings): Promise<Map<string, string[]>> {
  const out = new Map(words.map((w) => [w, [w]]));
  if (!words.length || !(settings ?? (await searchSettings())).synonyms) return out;
  const rows = await prisma.searchSynonym.findMany({ where: { hidden: false, OR: [{ term: { in: words } }, { alternatives: { hasSome: words } }] }, select: { id: true, term: true, alternatives: true } });
  const used = new Set<string>();
  for (const w of words) {
    const set = new Set([w]);
    for (const r of rows) if (r.term === w || r.alternatives.includes(w)) { set.add(r.term); r.alternatives.forEach((a) => set.add(a)); used.add(r.id); }
    out.set(w, [...set].slice(0, 24));
  }
  if (used.size) void prisma.searchSynonym.updateMany({ where: { id: { in: [...used] } }, data: { uses: { increment: 1 } } }).catch(() => null);
  return out;
}

/** What the AI learnt becomes synonyms — never touching rows FIRINGI wrote or hid. */
async function learn(words: { word: string; alternatives: string[] }[]) {
  for (const w of words) {
    const term = normalize(w.word);
    const alts = cleanAlternatives(term, w.alternatives);
    if (term.length < 2 || !alts.length) continue;
    const cur = await prisma.searchSynonym.findUnique({ where: { term } });
    if (!cur) await prisma.searchSynonym.create({ data: { term, alternatives: alts, source: "AI" } }).catch(() => null);
    else if (cur.source === "AI" && !cur.hidden) {
      const merged = [...new Set([...cur.alternatives, ...alts])].slice(0, 30);
      if (merged.length !== cur.alternatives.length) await prisma.searchSynonym.update({ where: { id: cur.id }, data: { alternatives: merged } });
    }
  }
}

export async function synonymList(ctx: Ctx, f: { q?: string; source?: string } = {}) {
  staff(ctx, false);
  const q = normalize(f.q ?? "");
  return prisma.searchSynonym.findMany({
    where: { ...(q ? { OR: [{ term: { contains: q } }, { alternatives: { has: q } }] } : {}), ...(f.source === "AI" || f.source === "ADMIN" ? { source: f.source } : {}) },
    orderBy: [{ uses: "desc" }, { term: "asc" }], take: 300,
  });
}

/** FIRINGI adds or corrects a synonym row ("tomato" → tomate, pomodoro …). It becomes FIRINGI's (the AI won't change it). */
export async function saveSynonym(ctx: Ctx, input: { id?: string | null; term: string; alternatives: string[]; hidden?: boolean }) {
  staff(ctx);
  const term = normalize(input.term);
  if (term.length < 2 || term.length > 40) throw new ValidationError("Write the word (2–40 letters).");
  const alternatives = cleanAlternatives(term, input.alternatives.flatMap((a) => a.split(",")));
  if (!alternatives.length) throw new ValidationError("Add at least one word that means the same.");
  const clash = await prisma.searchSynonym.findUnique({ where: { term } });
  if (clash && clash.id !== input.id) throw new ValidationError(`"${term}" already has a row — edit that one.`);
  const data = { term, alternatives, source: "ADMIN", hidden: !!input.hidden };
  const row = input.id ? await prisma.searchSynonym.update({ where: { id: input.id }, data }) : await prisma.searchSynonym.create({ data });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: input.id ? "search.synonym_update" : "search.synonym_create", entityType: "SearchSynonym", entityId: row.id, after: data });
  return row;
}

export async function deleteSynonym(ctx: Ctx, id: string) {
  staff(ctx);
  const row = await prisma.searchSynonym.findUnique({ where: { id } });
  if (!row) throw new NotFoundError("Synonym");
  await prisma.searchSynonym.delete({ where: { id } });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "search.synonym_delete", entityType: "SearchSynonym", entityId: id, before: { term: row.term, alternatives: row.alternatives } });
  return { ok: true };
}

// ── the AI reads the query ─────────────────────────────────────────────────

const TOOL = {
  name: "record_search",
  description: "Record what the buyer is looking for: the product words (with their alternatives) and any filters they asked for.",
  input_schema: {
    type: "object" as const,
    properties: {
      words: {
        type: "array", maxItems: 8,
        description: "Only words that describe the product itself (type, name, brand, variety, size such as 2kg / 33cl), corrected if misspelt — never usage ('for pizza', 'for my restaurant') and never filter words (prices, 'gluten free', 'cheap').",
        items: {
          type: "object",
          properties: {
            word: { type: "string", description: "The product word, corrected, in the buyer's language, lower case." },
            alternatives: { type: "array", maxItems: 25, items: { type: "string" }, description: "The same thing in English, Portuguese, Spanish, French, German, Italian, Dutch, Polish and other EU languages; common synonyms and trade names; singular and plural. Lower case, one or two words each." },
          },
          required: ["word", "alternatives"],
        },
      },
      free: { type: "array", items: { type: "string", enum: [...ALLERGENS] }, description: "Allergens the buyer wants to avoid ('gluten free' → GLUTEN, 'lactose free' / 'without milk' → MILK)." },
      diet: { type: ["string", "null"], enum: [...DIETS, null], description: "A diet asked for (vegan, vegetarian, halal, kosher, gluten-free, lactose-free, organic) or null." },
      maxPrice: { type: ["number", "null"], description: "Highest price per item the buyer mentioned ('under 5 €' → 5), or null." },
      onDeal: { type: "boolean", description: "True only if the buyer asked for offers / promotions / deals." },
      sort: { type: ["string", "null"], enum: [...SORTS, null], description: "'price' if they want the cheapest, 'rating' for the best rated, 'distance' for the nearest; otherwise null." },
      corrected: { type: ["string", "null"], description: "If the query was clearly misspelt, the corrected query; otherwise null." },
    },
    required: ["words", "free", "diet", "maxPrice", "onDeal", "sort", "corrected"],
  },
};

/** A fixed reading for development / browser tests (no AI connected): a small dictionary and a few filter phrases. */
const SIM_WORDS: Record<string, string[]> = {
  tomato: ["tomate", "tomates", "pomodoro", "tomaten", "tomatoes"], tomate: ["tomato", "tomatoes", "pomodoro", "tomaten"],
  cheese: ["queijo", "queso", "fromage", "kase", "formaggio"], queijo: ["cheese", "queso", "fromage", "formaggio"],
  mozzarella: ["mozarela", "mozzarela", "mozarella"], water: ["agua", "eau", "wasser", "acqua"], agua: ["water", "eau", "wasser", "acqua"],
  beer: ["cerveja", "cerveza", "biere", "bier", "birra", "lager"], cerveja: ["beer", "cerveza", "bier", "birra", "lager"],
  wine: ["vinho", "vino", "vin", "wein"], vinho: ["wine", "vino", "vin", "wein"], garlic: ["alho", "ajo", "ail", "knoblauch", "aglio"],
  alho: ["garlic", "ajo", "ail", "knoblauch", "aglio"], sauce: ["molho", "salsa", "sosse", "salsa"], molho: ["sauce", "salsa"],
  box: ["caixa", "caja", "boite", "karton", "scatola"], caixa: ["box", "caja", "boite", "scatola"],
};
const SIM_FIX: Record<string, string> = { mozarela: "mozzarella", mozarella: "mozzarella", mozzarela: "mozzarella", tomatoe: "tomato", chese: "cheese" };
export function simulatedUnderstanding(q: string): Understanding {
  let t = normalize(q);
  const free: Understanding["free"] = [];
  let diet: Understanding["diet"] = null, maxPrice: number | null = null, onDeal = false, sort: Understanding["sort"] = null;
  const take = (re: RegExp, fn: (m: RegExpMatchArray) => void) => { const m = t.match(re); if (m) { fn(m); t = t.replace(re, " "); } };
  take(/\b(gluten free|sem gluten|sin gluten|glutenfrei|sans gluten)\b/, () => free.push("GLUTEN"));
  take(/\b(lactose free|sem lactose|sin lactosa|without milk)\b/, () => free.push("MILK"));
  take(/\b(vegan|vegano|vegana)\b/, () => { diet = "VEGAN"; });
  take(/\b(organic|biologico|bio)\b/, () => { diet = "ORGANIC"; });
  take(/\b(under|below|ate|menos de|hasta|max|unter)\s+(\d+(?:\.\d+)?)\s*(eur|euro|euros)?\b/, (m) => { maxPrice = Number(m[2]); });
  take(/\b(cheapest|cheap|barato|barata|mais barato)\b/, () => { sort = "price"; });
  take(/\b(deal|deals|promo|promocao|promocoes|oferta|offer)\b/, () => { onDeal = true; });
  take(/\bfor (pizza|my restaurant|restaurant|cafe)\b|\bpara (pizza|restaurante)\b/, () => null);
  const words = searchWords(t).map((w) => SIM_FIX[w] ?? w);
  const corrected = searchWords(q).some((w) => SIM_FIX[w]) ? normalize(q).split(" ").map((w) => SIM_FIX[w] ?? w).join(" ") : null;
  return { words: words.map((w) => ({ word: w, alternatives: SIM_WORDS[w] ?? [] })), free, diet, maxPrice, onDeal, sort, corrected };
}

/**
 * What the AI understood from a query — from the cache, else one Claude call (≤ 8 s; any failure → null and the
 * search simply runs on the words). The words it returns are learnt as synonyms.
 */
export async function understand(ctx: Ctx, q: string, locale: string): Promise<(Understanding & { simulated: boolean }) | null> {
  const status = await searchAiStatus();
  const norm = normalize(q);
  if (!status.ready || norm.length < 2 || norm.length > 160) return null;
  const key = `${locale}|${norm}`;
  const hit = await prisma.searchUnderstanding.findUnique({ where: { key } });
  if (hit && hit.createdAt > new Date(Date.now() - CACHE_DAYS * 86_400_000)) {
    const parsed = Understanding.safeParse(hit.result);
    if (parsed.success) return { ...parsed.data, simulated: (hit.result as { simulated?: boolean }).simulated === true };
  }
  const transport = aiTransport();
  let result: Understanding | null = null;
  let tokens: { in?: number; out?: number } = {};
  if (!transport) result = simulatedUnderstanding(q);
  else {
    const settings = await aiSettings();
    const params = {
      model: settings.model, max_tokens: 1500,
      system: "You read what a buyer types into the product search of FIRINGI, a B2B food & drinks wholesale marketplace for restaurants, cafés and shops in Europe, and record it with the record_search tool. Product names in the catalogue can be in any EU language, so give every product word its alternatives in many languages. Only record filters the buyer clearly asked for. Never invent brands or products.",
      tools: [TOOL as unknown as Anthropic.Beta.Messages.BetaTool],
      tool_choice: { type: "tool" as const, name: TOOL.name },
      messages: [{ role: "user" as const, content: `Buyer's language: ${locale}\nSearch: ${q.slice(0, 160)}` }],
    };
    try {
      const res = await Promise.race([transport(params), new Promise<never>((_, rej) => setTimeout(() => rej(new Error("timeout")), 8000))]);
      const call = res.content.find((b) => b.type === "tool_use" && b.name === TOOL.name) as { input: unknown } | undefined;
      const parsed = Understanding.safeParse(call?.input);
      if (parsed.success) result = parsed.data;
      tokens = { in: res.usage?.input_tokens, out: res.usage?.output_tokens };
    } catch { result = null; }
  }
  if (!result) return null;
  result = { ...result, words: result.words.map((w) => ({ word: normalize(w.word), alternatives: cleanAlternatives(w.word, w.alternatives) })).filter((w) => w.word.length >= 2) };
  const simulated = !transport;
  await prisma.searchUnderstanding.upsert({ where: { key }, update: { result: { ...result, simulated } as unknown as Prisma.InputJsonValue, createdAt: new Date() }, create: { key, result: { ...result, simulated } as unknown as Prisma.InputJsonValue } });
  await learn(result.words).catch(() => null);
  if (transport) await logAi({ kind: "SEARCH", ctx, summary: `Search read: "${q.slice(0, 80)}"`, detail: { words: result.words.map((w) => w.word) }, tokensIn: tokens.in, tokensOut: tokens.out }).catch(() => null);
  return { ...result, simulated };
}

/** Old readings out (daily job / on demand). */
export async function pruneUnderstandings() {
  const r = await prisma.searchUnderstanding.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - CACHE_DAYS * 86_400_000) } } });
  return { removed: r.count };
}

// ── matching ───────────────────────────────────────────────────────────────

const esc = (s: string) => s.replace(/[\\%_]/g, "\\$&");
const reEsc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Products matching the word groups (each group: a word and its synonyms), best first. `all`: every group must match;
 * otherwise any group, ranked by how many match (the fallback when nothing has every word).
 */
export async function matchProducts(groups: string[][], opts: { fuzzy: boolean; typo: number; all: boolean; limit?: number }) {
  const gs = groups.map((g) => [...new Set(g.map(normalize).filter((a) => a.length >= 2))]).filter((g) => g.length);
  if (!gs.length) return [] as { id: string; score: number; matched: number }[];
  const t = Prisma.sql`firingi_unaccent(p."searchText")`;
  const hit = (a: string) => (opts.fuzzy && a.length >= 4 && !/\d/.test(a) ? Prisma.sql`(${t} LIKE ${`%${esc(a)}%`} OR ${a} <% ${t})` : Prisma.sql`${t} LIKE ${`%${esc(a)}%`}`);
  const conds = gs.map((g) => Prisma.sql`(${Prisma.join(g.map(hit), " OR ")})`);
  const score = (g: string[]) => Prisma.sql`GREATEST(${Prisma.join(g.map((a) => Prisma.sql`CASE WHEN ${t} ~ ${`(^| )${reEsc(a)}`} THEN 1.2 WHEN ${t} LIKE ${`%${esc(a)}%`} THEN 1.0 ${opts.fuzzy && a.length >= 4 && !/\d/.test(a) ? Prisma.sql`ELSE word_similarity(${a}, ${t})` : Prisma.sql`ELSE 0`} END`), ", ")})`;
  const matched = Prisma.join(conds.map((c) => Prisma.sql`(CASE WHEN ${c} THEN 1 ELSE 0 END)`), " + ");
  const where = opts.all ? Prisma.join(conds, " AND ") : Prisma.join(conds, " OR ");
  const sql = Prisma.sql`SELECT p.id, (${Prisma.join(gs.map(score), " + ")})::float AS score, (${matched})::int AS matched
    FROM "Product" p WHERE p.status = 'APPROVED' AND (${where})
    ORDER BY matched DESC, score DESC, p.id LIMIT ${opts.limit ?? 1500}`;
  const rows = await prisma.$transaction([
    prisma.$executeRaw`SELECT set_config('pg_trgm.word_similarity_threshold', ${String(opts.typo)}, true)`,
    prisma.$queryRaw<{ id: string; score: number; matched: number }[]>(sql),
  ]);
  return rows[1];
}
