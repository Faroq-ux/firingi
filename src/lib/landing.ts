/**
 * Phase 56 — the public landing page: pure rules (FIRINGI's settings, text lookup with FIRINGI's own wording over the
 * translations, numbered lists, plan bullets, form checks). No database; unit-tested.
 */

export const LANDING_SECTIONS = [
  "stats", "cats", "buy", "till", "manage", "save", "start", "faq", "contact", "newsletter", "final", "vendors", "plans",
] as const;
export type LandingSection = (typeof LANDING_SECTIONS)[number];
export const LEGAL_PAGES = ["terms", "privacy", "cookies"] as const;
export type LegalPage = (typeof LEGAL_PAGES)[number];
export const SOCIALS = ["instagram", "facebook", "linkedin", "youtube", "tiktok"] as const;
/** FIRINGI's own pages linked from the footer (FIRINGI only — not suppliers' shops): sustainability and careers. */
export const ABOUT_PAGES = ["sustainability", "careers"] as const;
export type AboutPage = (typeof ABOUT_PAGES)[number];
export const JOB_TYPES = ["FULL_TIME", "PART_TIME", "INTERNSHIP", "TEMPORARY", "FREELANCE"] as const;
export type JobType = (typeof JOB_TYPES)[number];
/** A job opening at FIRINGI (written in one language by FIRINGI). */
export type Job = { id: string; title: string; location: string; type: JobType; text: string; on: boolean };
export type Social = (typeof SOCIALS)[number];

export type LandingSettings = {
  /** "/" shows the landing page to visitors (off: visitors go to the login page, as before). */
  enabled: boolean;
  sections: Record<LandingSection, boolean>;
  /** WhatsApp number in international form, digits only (e.g. 351912345678); empty = no WhatsApp button. */
  /** WhatsApp for wholesale customers (main page); empty = no WhatsApp buttons there. */
  whatsapp: string;
  /** WhatsApp for suppliers (the /sell page); empty = the customers' number is used there. */
  whatsappVendors: string;
  email: string;
  phone: string;
  company: { legalName: string; nif: string; address: string };
  social: Record<Social, string>;
  livroUrl: string;
  /** FIRINGI's own wording, per language and text key (over the built-in translations). */
  texts: Record<string, Record<string, string>>;
  /** Text keys of list items FIRINGI hid (e.g. "faq.items.4"). */
  hidden: string[];
  legal: Record<LegalPage, Record<string, string>>;
  legalUpdated: Record<LegalPage, string | null>;
  /** Sustainability and careers pages: shown (and linked in the footer) when on; FIRINGI's text per language (empty = the starting text). */
  about: Record<AboutPage, { on: boolean; text: Record<string, string> }>;
  /** FIRINGI's job openings on the careers page. */
  jobs: Job[];
  /** Applications are also e-mailed here (optional; they are always kept in the admin list). */
  careersEmail: string;
};

export const DEFAULT_LANDING: LandingSettings = {
  enabled: true,
  sections: Object.fromEntries(LANDING_SECTIONS.map((s) => [s, true])) as Record<LandingSection, boolean>,
  whatsapp: "",
  whatsappVendors: "",
  email: "",
  phone: "",
  company: { legalName: "", nif: "", address: "" },
  social: { instagram: "", facebook: "", linkedin: "https://www.linkedin.com/company/firingi", youtube: "", tiktok: "" },
  livroUrl: "https://www.livroreclamacoes.pt",
  texts: {},
  hidden: [],
  legal: { terms: {}, privacy: {}, cookies: {} },
  legalUpdated: { terms: null, privacy: null, cookies: null },
  about: { sustainability: { on: true, text: {} }, careers: { on: true, text: {} } },
  jobs: [],
  careersEmail: "",
};

const str = (v: unknown, d = "") => (typeof v === "string" ? v : d);
const obj = (v: unknown) => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const strMap = (v: unknown) => Object.fromEntries(Object.entries(obj(v)).filter(([, x]) => typeof x === "string")) as Record<string, string>;

export function mergeLanding(v: Partial<LandingSettings> | null | undefined): LandingSettings {
  const d = DEFAULT_LANDING, x = obj(v) as Partial<LandingSettings>;
  const sec = obj(x.sections), co = obj(x.company), so = obj(x.social), lg = obj(x.legal), lu = obj(x.legalUpdated);
  return {
    enabled: typeof x.enabled === "boolean" ? x.enabled : d.enabled,
    sections: Object.fromEntries(LANDING_SECTIONS.map((s) => [s, typeof sec[s] === "boolean" ? (sec[s] as boolean) : d.sections[s]])) as Record<LandingSection, boolean>,
    whatsapp: str(x.whatsapp), whatsappVendors: str(x.whatsappVendors), email: str(x.email), phone: str(x.phone),
    company: { legalName: str(co.legalName), nif: str(co.nif), address: str(co.address) },
    social: Object.fromEntries(SOCIALS.map((s) => [s, typeof so[s] === "string" ? (so[s] as string) : d.social[s]])) as Record<Social, string>, // not saved yet → default; cleared on purpose → stays empty
    livroUrl: str(x.livroUrl, d.livroUrl) || d.livroUrl,
    texts: Object.fromEntries(Object.entries(obj(x.texts)).map(([l, m]) => [l, strMap(m)])),
    hidden: Array.isArray(x.hidden) ? (x.hidden as unknown[]).filter((h): h is string => typeof h === "string") : [],
    legal: Object.fromEntries(LEGAL_PAGES.map((p) => [p, strMap(lg[p])])) as Record<LegalPage, Record<string, string>>,
    legalUpdated: Object.fromEntries(LEGAL_PAGES.map((p) => [p, typeof lu[p] === "string" ? (lu[p] as string) : null])) as Record<LegalPage, string | null>,
    about: Object.fromEntries(ABOUT_PAGES.map((p) => { const a = obj(obj(x.about)[p]); return [p, { on: typeof a.on === "boolean" ? a.on : d.about[p].on, text: strMap(a.text) }]; })) as LandingSettings["about"],
    jobs: (Array.isArray(x.jobs) ? (x.jobs as unknown[]) : []).map((j) => obj(j)).filter((j) => typeof j.id === "string" && typeof j.title === "string").map((j) => ({
      id: str(j.id), title: str(j.title), location: str(j.location), type: (JOB_TYPES as readonly string[]).includes(str(j.type)) ? (str(j.type) as JobType) : "FULL_TIME", text: str(j.text), on: j.on !== false,
    })),
    careersEmail: str(x.careersEmail),
  };
}

const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[a-z]{2,24}$/i;
export const isEmail = (s: string) => EMAIL.test(s.trim()) && s.trim().length <= 254;
const isHttps = (s: string) => /^https:\/\/[^\s]{3,500}$/i.test(s);
const KEY = /^[A-Za-z0-9_]+(\.[A-Za-z0-9_]+){0,5}$/;

/** Checks FIRINGI's settings; throws a message for the first problem. */
export function cleanLanding(v: LandingSettings, locales: readonly string[]): LandingSettings {
  const s = mergeLanding(v);
  s.whatsapp = s.whatsapp.replace(/[^\d]/g, "");
  s.whatsappVendors = s.whatsappVendors.replace(/[^\d]/g, "");
  if (s.whatsappVendors && (s.whatsappVendors.length < 8 || s.whatsappVendors.length > 15)) throw new Error("Suppliers' WhatsApp number: 8 to 15 digits with the country code, e.g. 351912345678.");
  if (s.whatsapp && (s.whatsapp.length < 8 || s.whatsapp.length > 15)) throw new Error("WhatsApp number: 8 to 15 digits with the country code, e.g. 351912345678.");
  s.email = s.email.trim();
  if (s.email && !isEmail(s.email)) throw new Error("Contact email is not valid.");
  s.phone = s.phone.trim().slice(0, 40);
  for (const k of ["legalName", "nif", "address"] as const) s.company[k] = s.company[k].trim().slice(0, 300);
  for (const k of SOCIALS) { s.social[k] = s.social[k].trim(); if (s.social[k] && !isHttps(s.social[k])) throw new Error(`${k} link must start with https://`); }
  if (!isHttps(s.livroUrl)) throw new Error("Livro de Reclamações link must start with https://");
  for (const [l, m] of Object.entries(s.texts)) {
    if (!locales.includes(l)) throw new Error(`Unknown language: ${l}`);
    for (const [k, txt] of Object.entries(m)) {
      if (!KEY.test(k)) throw new Error(`Unknown text: ${k}`);
      if (txt.length > 4000) throw new Error(`Text too long: ${k}`);
    }
  }
  s.hidden = [...new Set(s.hidden.filter((h) => KEY.test(h)))];
  for (const p of LEGAL_PAGES) for (const [l, txt] of Object.entries(s.legal[p])) {
    if (!locales.includes(l)) throw new Error(`Unknown language: ${l}`);
    if (txt.length > 60000) throw new Error(`${p}: text too long.`);
  }
  for (const p of ABOUT_PAGES) for (const [l, txt] of Object.entries(s.about[p].text)) {
    if (!locales.includes(l)) throw new Error(`Unknown language: ${l}`);
    if (txt.length > 30000) throw new Error(`${p}: text too long.`);
  }
  if (s.jobs.length > 50) throw new Error("At most 50 job openings.");
  const ids = new Set<string>();
  for (const j of s.jobs) {
    j.title = j.title.trim().slice(0, 120); j.location = j.location.trim().slice(0, 120); j.text = j.text.trim().slice(0, 8000);
    if (!j.title) throw new Error("Each job opening needs a title.");
    if (!/^[a-z0-9-]{1,40}$/.test(j.id) || ids.has(j.id)) throw new Error("Job opening ids must be unique.");
    ids.add(j.id);
  }
  s.careersEmail = s.careersEmail.trim();
  if (s.careersEmail && !isEmail(s.careersEmail)) throw new Error("Careers e-mail is not valid.");
  return s;
}

// ── texts ───────────────────────────────────────────────────────────────────

export const flatten = (o: Record<string, unknown>, p = ""): Record<string, string> =>
  Object.fromEntries(Object.entries(o).flatMap(([k, v]) => (typeof v === "string" ? [[p + k, v]] : v && typeof v === "object" ? Object.entries(flatten(v as Record<string, unknown>, `${p}${k}.`)) : [])));

export type TextSources = { own: Record<string, string>; ownEn: Record<string, string>; msgs: Record<string, string>; msgsEn: Record<string, string> };

/** FIRINGI's wording in this language → the translation → FIRINGI's English wording → the English text. */
export function lookup(src: TextSources, key: string): string {
  const pick = (v: string | undefined) => (v != null && v.trim() !== "" ? v : undefined);
  return pick(src.own[key]) ?? pick(src.msgs[key]) ?? pick(src.ownEn[key]) ?? src.msgsEn[key] ?? "";
}

export const fill = (s: string, v: Record<string, string | number> = {}) => s.replace(/\{(\w+)\}/g, (_, k: string) => String(v[k] ?? `{${k}}`));

/** The numbers of a numbered list ("faq.items.1.q", …) present in any source, without the hidden ones, in order. */
export function listItems(src: TextSources, prefix: string, hidden: string[]): string[] {
  const nums = new Set<number>();
  const re = new RegExp(`^${prefix.replace(/\./g, "\\.")}\\.(\\d+)(\\.|$)`);
  for (const m of [src.own, src.ownEn, src.msgs, src.msgsEn]) for (const k of Object.keys(m)) { const x = re.exec(k); if (x) nums.add(Number(x[1])); }
  return [...nums].sort((a, b) => a - b).map(String).filter((n) => !hidden.includes(`${prefix}.${n}`));
}

// ── plans ───────────────────────────────────────────────────────────────────

export type PlanLite = { code: string; name: string; monthlyPrice: number; features: string[]; maxProducts: number | null; maxUsers: number | null; maxWarehouses: number | null; maxDrivers: number | null; earlyPayModel: string; earlyPayRate: number; freeEarlyPays: number };

/** Short bullets for a vendor plan from its limits (texts by key). */
export function planBullets(p: PlanLite, t: (key: string, v?: Record<string, string | number>) => string, locale: string): string[] {
  const nf = new Intl.NumberFormat(locale, { maximumFractionDigits: 2 });
  const out: string[] = [];
  out.push(p.maxProducts == null ? t("plans.productsAll") : t("plans.products", { n: nf.format(p.maxProducts) }));
  out.push(p.maxUsers == null && p.maxWarehouses == null && p.maxDrivers == null
    ? t("plans.teamAll")
    : t("plans.team", { users: p.maxUsers ?? "∞", wh: p.maxWarehouses ?? "∞", drivers: p.maxDrivers ?? "∞" }));
  const feats = p.features.map((f) => t(`plans.feature.${f}`)).filter((f) => f && !f.startsWith("plans."));
  out.push(feats.length ? t("plans.includes", { list: feats.join(", ") }) : t("plans.basics"));
  if (p.earlyPayModel !== "OFF" && p.earlyPayRate > 0) out.push(t("plans.earlyPay", { rate: nf.format(p.earlyPayRate) }));
  if (p.freeEarlyPays > 0) out.push(t("plans.freeEarly", { n: p.freeEarlyPays }));
  return out;
}

// ── forms ───────────────────────────────────────────────────────────────────

export type ContactIn = { kind: "QUESTION" | "VENDOR"; name: string; company: string; email: string; phone: string; nif: string; type: string; message: string; consent: boolean; website: string; startedAt: number; vendorType?: "WHOLESALER" | "DISTRIBUTOR" };
export type FormProblem = "REQUIRED" | "EMAIL" | "CONSENT" | "SPAM";

/** The honeypot ("website") must stay empty and a person needs a few seconds to fill the form. */
export function looksLikeSpam(i: { website?: string; startedAt?: number; message?: string }, now = Date.now()) {
  if (i.website && i.website.trim()) return true;
  if (!i.startedAt || now - i.startedAt < 2500 || now - i.startedAt > 24 * 3600_000) return true;
  const links = (i.message ?? "").match(/https?:\/\//gi)?.length ?? 0;
  return links > 2;
}

export function checkContact(i: ContactIn, now = Date.now()): FormProblem | null {
  if (looksLikeSpam(i, now)) return "SPAM";
  if (!i.name.trim() || !i.company.trim() || !i.email.trim()) return "REQUIRED";
  if (!isEmail(i.email)) return "EMAIL";
  if (!i.consent) return "CONSENT";
  return null;
}

/** Messages per visitor in a sliding window. */
export function underLimit(times: number[], now: number, max: number, windowMs: number) {
  const recent = times.filter((t) => now - t < windowMs);
  return { ok: recent.length < max, recent };
}

// ── careers (FIRINGI's job applications) ────────────────────────────────────

export type ApplicationIn = { jobId: string; name: string; email: string; phone: string; link: string; message: string; consent: boolean; website: string; startedAt: number };
export const APPLICATION_STATUSES = ["NEW", "REVIEWING", "REJECTED", "HIRED"] as const;
export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];
export const APPLICATION_STATUS_LABEL: Record<ApplicationStatus, string> = { NEW: "New", REVIEWING: "In review", REJECTED: "Rejected", HIRED: "Hired" };
/** An application: a person's name, a valid e-mail and consent; an optional CV / LinkedIn link must be https. */
export function checkApplication(i: ApplicationIn, now = Date.now()): FormProblem | "LINK" | null {
  if (looksLikeSpam(i, now)) return "SPAM";
  if (!i.name.trim() || !i.email.trim()) return "REQUIRED";
  if (!isEmail(i.email)) return "EMAIL";
  if (i.link.trim() && !/^https:\/\/[^\s]{3,500}$/i.test(i.link.trim())) return "LINK";
  if (!i.consent) return "CONSENT";
  return null;
}
/** A job id from its title ("Sales manager – Lisbon" → "sales-manager-lisbon"), unique among `taken`. */
export function jobId(title: string, taken: string[]) {
  const base = title.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 34) || "job";
  let id = base, n = 2;
  while (taken.includes(id)) id = `${base}-${n++}`;
  return id;
}
