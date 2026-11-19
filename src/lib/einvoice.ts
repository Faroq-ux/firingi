/**
 * Phase 46 — e-invoicing rules (pure, shared by server and pages).
 *
 * FIRINGI decides per country (the recipient's country) how its documents go out electronically:
 *   • the FORMAT (Peppol BIS Billing 3.0, XRechnung, Factur-X, Poland's KSeF FA(3), Italy's FatturaPA,
 *     Spain's Verifactu record) and
 *   • the SERVICE that carries it: one EU-wide e-invoicing service for any country and format, or a
 *     direct connection (Peppol access point, KSeF, SDI, AEAT), or e-mail (XRechnung / Factur-X files).
 * A route is "mandatory" (every B2B document, e.g. KSeF, SDI) or "on request" (only customers who gave a
 * Peppol id / chose e-invoices). Everything can be switched off per country and per document type.
 */

export const FORMATS = ["PEPPOL_BIS3", "XRECHNUNG", "FACTURX", "KSEF_FA3", "FATTURAPA", "VERIFACTU"] as const;
export type EFormat = (typeof FORMATS)[number];

export const FORMAT_LABEL: Record<EFormat, string> = {
  PEPPOL_BIS3: "Peppol BIS Billing 3.0 (UBL)",
  XRECHNUNG: "XRechnung 3.0 (UBL)",
  FACTURX: "Factur-X / ZUGFeRD (PDF + CII XML)",
  KSEF_FA3: "KSeF FA(3) (Poland)",
  FATTURAPA: "FatturaPA 1.2 via SDI (Italy)",
  VERIFACTU: "Verifactu record (Spain, AEAT)",
};

/** Short names for customers' pages (no country in brackets). */
export const FORMAT_SHORT: Record<EFormat, string> = {
  PEPPOL_BIS3: "Peppol BIS 3.0", XRECHNUNG: "XRechnung", FACTURX: "Factur-X", KSEF_FA3: "KSeF FA(3)", FATTURAPA: "FatturaPA / SDI", VERIFACTU: "Verifactu",
};

export const PROVIDERS = ["eu-hub", "peppol-ap", "ksef", "sdi", "aeat", "email"] as const;
export type EProvider = (typeof PROVIDERS)[number];

/** What each service can carry. The EU-wide service covers every country and format. */
export const PROVIDER_INFO: Record<EProvider, { label: string; formats: readonly EFormat[]; countries: "ALL" | readonly string[]; channel: string }> = {
  "eu-hub": { label: "EU-wide e-invoicing service (all countries, all formats)", formats: FORMATS, countries: "ALL", channel: "HUB" },
  "peppol-ap": { label: "Peppol access point (direct)", formats: ["PEPPOL_BIS3", "XRECHNUNG"], countries: "ALL", channel: "PEPPOL" },
  ksef: { label: "KSeF — Krajowy System e-Faktur (direct)", formats: ["KSEF_FA3"], countries: ["PL"], channel: "KSEF" },
  sdi: { label: "SDI — Sistema di Interscambio (direct)", formats: ["FATTURAPA"], countries: ["IT"], channel: "SDI" },
  aeat: { label: "AEAT Verifactu (direct)", formats: ["VERIFACTU"], countries: ["ES"], channel: "VERIFACTU" },
  email: { label: "E-mail (XML / PDF with XML attached)", formats: ["XRECHNUNG", "FACTURX", "PEPPOL_BIS3"], countries: "ALL", channel: "EMAIL" },
};

/** Formats that belong to one country's tax system: only for documents issued by FIRINGI's entity there. */
export const ISSUER_BOUND: Partial<Record<EFormat, string>> = { KSEF_FA3: "PL", FATTURAPA: "IT", VERIFACTU: "ES" };

export type CountryRoute = {
  enabled: boolean;
  format: EFormat;
  provider: EProvider;
  /** every B2B document goes this way (clearance / reporting countries); else only customers who asked */
  mandatory: boolean;
  /** also e-mail the PDF to the recipient */
  emailCopy: boolean;
};

export type LanguageSource = "CUSTOMER_COUNTRY" | "CUSTOMER_CHOICE" | "ENTITY";

export type EInvoiceSettings = {
  /** master switch: off = documents are e-mailed as PDF only, as before */
  enabled: boolean;
  documents: { customerInvoices: boolean; creditNotes: boolean; serviceInvoices: boolean; selfBilling: boolean; receiveSupplier: boolean };
  countries: Record<string, CountryRoute>;
  /** check every document against the format's rules first; errors stop it until fixed */
  validateBeforeSend: boolean;
  /** warnings (not errors) also stop the document */
  blockOnWarnings: boolean;
  /** the e-mail copy also carries the XML (for the recipient's accountant / accounting software) */
  emailXml: boolean;
  /** each month, on this day, the previous month's documents go to each company's accountant (if it gave one) */
  monthlyPack: { enabled: boolean; day: number; includeXml: boolean; includeSummary: boolean; includeInvoicePdfs: boolean; includeTillSales: boolean };
  /** years each country keeps documents (archive) */
  retention: Record<string, number>;
  /** document language: the first source that gives one wins */
  languagePriority: LanguageSource[];
  /** customers / suppliers may choose their invoice language */
  allowCustomerLanguage: boolean;
  /** customers / suppliers may add a second language */
  allowBilingual: boolean;
  /** Poland: "mechanizm podzielonej płatności" text from this gross amount in PLN (0 = off) */
  plSplitPaymentFrom: number;
  /** received supplier e-invoices matched to a statement within this tolerance (EUR) are approved for payment */
  autoMatchTolerance: number;
};

export const SCHENGEN = ["AT", "BE", "BG", "CH", "CZ", "DE", "DK", "EE", "ES", "FI", "FR", "GR", "HR", "HU", "IS", "IT", "LI", "LT", "LU", "LV", "MT", "NL", "NO", "PL", "PT", "RO", "SE", "SI", "SK"] as const;

/** Sensible starting routes (FIRINGI changes them on the settings page). */
export function defaultRoute(cc: string): CountryRoute {
  switch (cc) {
    case "PL": return { enabled: true, format: "KSEF_FA3", provider: "ksef", mandatory: true, emailCopy: true };
    case "IT": return { enabled: true, format: "FATTURAPA", provider: "sdi", mandatory: true, emailCopy: true };
    case "ES": return { enabled: true, format: "VERIFACTU", provider: "aeat", mandatory: true, emailCopy: true };
    case "DE": return { enabled: true, format: "XRECHNUNG", provider: "peppol-ap", mandatory: false, emailCopy: true };
    case "FR": return { enabled: true, format: "FACTURX", provider: "eu-hub", mandatory: false, emailCopy: true };
    default: return { enabled: true, format: "PEPPOL_BIS3", provider: "peppol-ap", mandatory: false, emailCopy: true };
  }
}

/** Legal minimum years to keep invoices (common practice per country; FIRINGI can raise them). */
export const DEFAULT_RETENTION: Record<string, number> = {
  AT: 7, BE: 10, BG: 10, CH: 10, CZ: 10, DE: 10, DK: 5, EE: 7, ES: 6, FI: 10, FR: 10, GR: 5, HR: 11, HU: 8, IS: 7, IT: 10, LI: 10,
  LT: 10, LU: 10, LV: 5, MT: 6, NL: 7, NO: 5, PL: 5, PT: 10, RO: 10, SE: 7, SI: 10, SK: 10,
};

export const DEFAULT_EINVOICE_SETTINGS: EInvoiceSettings = {
  enabled: true,
  documents: { customerInvoices: true, creditNotes: true, serviceInvoices: true, selfBilling: true, receiveSupplier: true },
  countries: Object.fromEntries(SCHENGEN.map((c) => [c, defaultRoute(c)])),
  validateBeforeSend: true,
  blockOnWarnings: false,
  emailXml: true,
  monthlyPack: { enabled: true, day: 1, includeXml: true, includeSummary: true, includeInvoicePdfs: false, includeTillSales: true },
  retention: { ...DEFAULT_RETENTION },
  languagePriority: ["CUSTOMER_COUNTRY", "CUSTOMER_CHOICE", "ENTITY"],
  allowCustomerLanguage: true,
  allowBilingual: true,
  plSplitPaymentFrom: 15000,
  autoMatchTolerance: 0.05,
};

const isFormat = (v: unknown): v is EFormat => typeof v === "string" && (FORMATS as readonly string[]).includes(v);
const isProvider = (v: unknown): v is EProvider => typeof v === "string" && (PROVIDERS as readonly string[]).includes(v);

/** Can this service carry this format for this country? */
export function providerFits(p: EProvider, f: EFormat, cc: string) {
  const i = PROVIDER_INFO[p];
  return i.formats.includes(f) && (i.countries === "ALL" || i.countries.includes(cc));
}

export function mergeEInvoiceSettings(raw: unknown): EInvoiceSettings {
  const r = (raw && typeof raw === "object" ? raw : {}) as Partial<EInvoiceSettings>;
  const d = DEFAULT_EINVOICE_SETTINGS;
  const b = (v: unknown, x: boolean) => (typeof v === "boolean" ? v : x);
  const num = (v: unknown, x: number, lo: number, hi: number) => (typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : x);
  const docs = (r.documents ?? {}) as Partial<EInvoiceSettings["documents"]>;
  const rc = (r.countries ?? {}) as Record<string, Partial<CountryRoute>>;
  const ret = (r.retention ?? {}) as Record<string, unknown>;
  const prio = Array.isArray(r.languagePriority) ? r.languagePriority.filter((x): x is LanguageSource => ["CUSTOMER_COUNTRY", "CUSTOMER_CHOICE", "ENTITY"].includes(x as string)) : [];
  return {
    enabled: b(r.enabled, d.enabled),
    documents: {
      customerInvoices: b(docs.customerInvoices, true), creditNotes: b(docs.creditNotes, true), serviceInvoices: b(docs.serviceInvoices, true),
      selfBilling: b(docs.selfBilling, true), receiveSupplier: b(docs.receiveSupplier, true),
    },
    countries: Object.fromEntries(SCHENGEN.map((c) => {
      const x = rc[c] ?? {};
      const def = defaultRoute(c);
      const format = isFormat(x.format) ? x.format : def.format;
      let provider = isProvider(x.provider) ? x.provider : def.provider;
      if (!providerFits(provider, format, c)) provider = "eu-hub"; // the EU-wide service carries anything
      return [c, { enabled: b(x.enabled, def.enabled), format, provider, mandatory: b(x.mandatory, def.mandatory), emailCopy: b(x.emailCopy, def.emailCopy) }];
    })),
    validateBeforeSend: b(r.validateBeforeSend, d.validateBeforeSend),
    blockOnWarnings: b(r.blockOnWarnings, d.blockOnWarnings),
    emailXml: b(r.emailXml, d.emailXml),
    monthlyPack: (() => {
      const m = (r.monthlyPack ?? {}) as Partial<EInvoiceSettings["monthlyPack"]>;
      const dm = d.monthlyPack;
      return { enabled: b(m.enabled, dm.enabled), day: Math.round(num(m.day, dm.day, 1, 28)), includeXml: b(m.includeXml, dm.includeXml), includeSummary: b(m.includeSummary, dm.includeSummary), includeInvoicePdfs: b(m.includeInvoicePdfs, dm.includeInvoicePdfs), includeTillSales: b(m.includeTillSales, dm.includeTillSales) };
    })(),
    retention: Object.fromEntries(SCHENGEN.map((c) => [c, Math.round(num(ret[c], DEFAULT_RETENTION[c] ?? 10, 1, 30))])),
    languagePriority: [...new Set([...prio, ...d.languagePriority])],
    allowCustomerLanguage: b(r.allowCustomerLanguage, d.allowCustomerLanguage),
    allowBilingual: b(r.allowBilingual, d.allowBilingual),
    plSplitPaymentFrom: Math.round(num(r.plSplitPaymentFrom, d.plSplitPaymentFrom, 0, 10_000_000)),
    autoMatchTolerance: Math.round(num(r.autoMatchTolerance, d.autoMatchTolerance, 0, 100) * 100) / 100,
  };
}

// ── language ────────────────────────────────────────────────────────────────

/** Languages documents can be printed in (the 25 UI languages). */
export const DOC_LANGUAGES = ["en", "pt-PT", "es", "fr", "de", "it", "nl", "pl", "ro", "cs", "sk", "hu", "hr", "sl", "bg", "el", "da", "sv", "fi", "et", "lv", "lt", "mt", "nb", "is"] as const;
export const isDocLanguage = (v: unknown): v is string => typeof v === "string" && (DOC_LANGUAGES as readonly string[]).includes(v);

/**
 * The language(s) of a document.
 *   primary: the first of FIRINGI's priority list that gives a language (default: the customer's country, then the
 *            customer's own choice, then the issuing entity's language)
 *   second:  the issuing entity's language when it must always be on its documents and isn't the primary; else the
 *            customer's second language, or its chosen language when that lost to its country; else the entity's
 *            second language. Never the same as the primary.
 */
export function documentLanguages(s: Pick<EInvoiceSettings, "languagePriority" | "allowCustomerLanguage" | "allowBilingual">, x: {
  customerCountryLanguage: string | null; customerChoice: string | null; customerSecond: string | null;
  entityLanguage: string; entitySecond: string | null; requireOwnLanguage: boolean;
}): { primary: string; second: string | null } {
  const choice = s.allowCustomerLanguage && isDocLanguage(x.customerChoice) ? x.customerChoice : null;
  const source: Record<LanguageSource, string | null> = {
    CUSTOMER_COUNTRY: isDocLanguage(x.customerCountryLanguage) ? x.customerCountryLanguage : null,
    CUSTOMER_CHOICE: choice,
    ENTITY: isDocLanguage(x.entityLanguage) ? x.entityLanguage : "en",
  };
  const primary = s.languagePriority.map((k) => source[k]).find(Boolean) ?? source.ENTITY ?? "en";
  const candidates = [
    x.requireOwnLanguage ? source.ENTITY : null,
    s.allowBilingual && s.allowCustomerLanguage && isDocLanguage(x.customerSecond) ? x.customerSecond : null,
    s.allowBilingual && choice && choice !== primary ? choice : null,
    s.allowBilingual && isDocLanguage(x.entitySecond) ? x.entitySecond : null,
  ];
  const second = candidates.find((c) => c && c !== primary) ?? null;
  return { primary, second };
}

// ── statuses ────────────────────────────────────────────────────────────────

export const OUT_DONE = ["DELIVERED", "ACCEPTED"] as const;
export const STATUS_TONE: Record<string, "success" | "warning" | "destructive" | "secondary" | "default"> = {
  INVALID: "destructive", QUEUED: "secondary", SENT: "default", DELIVERED: "success", ACCEPTED: "success", REJECTED: "destructive", FAILED: "destructive", RECEIVED: "default", MATCHED: "success",
};

/** Peppol participant id: "scheme:identifier" with a 4-digit ICD scheme. */
export const PEPPOL_ID = /^\d{4}:[A-Za-z0-9.\-_]{2,50}$/;

/** "2026-10" for the month before `now` (the month a pack on day N covers). */
export function previousPeriod(now = new Date()) {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}
export function periodRange(period: string) {
  const [y, m] = period.split("-").map(Number);
  return { from: new Date(Date.UTC(y, m - 1, 1)), to: new Date(Date.UTC(y, m, 1)) };
}
export const PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/;
