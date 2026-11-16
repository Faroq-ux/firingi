/**
 * Order chat (Phase 35) — constants and the contact-detail filter, shared by server and client.
 *
 * The filter keeps business on FIRINGI: phone numbers, e-mail addresses, IBANs and links typed into
 * a message are found and (when FIRINGI's switch is on for the sender's company) replaced by [•••].
 * Order, invoice, route and other FIRINGI document numbers, prices, dates and postcodes are left alone.
 */
export const CHAT_CHANNELS = ["BUYER_SUPPLIER", "BUYER_FIRINGI", "SUPPLIER_FIRINGI", "DRIVER"] as const;
export type ChatChannelKey = (typeof CHAT_CHANNELS)[number];
export const CHAT_FLAGS = ["PHONE", "EMAIL", "IBAN", "LINK"] as const;
export type ChatFlag = (typeof CHAT_FLAGS)[number];
export const HIDDEN = "[•••]";

export const CHANNEL_LABEL: Record<ChatChannelKey, string> = {
  BUYER_SUPPLIER: "Buyer ↔ supplier",
  BUYER_FIRINGI: "Buyer ↔ FIRINGI",
  SUPPLIER_FIRINGI: "Supplier ↔ FIRINGI",
  DRIVER: "Delivery (driver)",
};
export const FLAG_LABEL: Record<ChatFlag, string> = { PHONE: "Phone number", EMAIL: "E-mail", IBAN: "IBAN", LINK: "Link" };

export type ChatSettings = {
  enabled: boolean;
  channels: Record<ChatChannelKey, boolean>;
  /** Hide phone numbers, e-mails, IBANs and links (per company: the CHAT_MASK switch). */
  maskContacts: boolean;
  /** Translate messages into each reader's language with AI (needs the AI key). */
  translate: boolean;
  translateModel: "claude-opus-5-5" | "claude-sonnet-5-5" | "claude-haiku-5-5";
  photos: boolean;
  /** The driver thread stays open this many hours after the delivery ends. */
  driverHoursAfter: number;
  /** Threads become read-only this many days after the order is delivered / cancelled. */
  closeDaysAfter: number;
};
export const DEFAULT_CHAT: ChatSettings = {
  enabled: true,
  channels: { BUYER_SUPPLIER: true, BUYER_FIRINGI: true, SUPPLIER_FIRINGI: true, DRIVER: true },
  maskContacts: true, translate: true, translateModel: "claude-haiku-5-5", photos: true, driverHoursAfter: 2, closeDaysAfter: 30,
};

const DOC_NO = /\b[A-Z]{1,4}(?:[ -][A-Z]{2,4})?[ -/]\d{4}[-/]\d{3,8}\b/g; // FO-2026-000100, RT-2026-000003, FT FIR/2026-12
const EMAIL = /[A-Z0-9._%+-]+\s*(?:@|\(at\)|\[at\])\s*[A-Z0-9-]+(?:\.[A-Z0-9-]+)*\s*(?:\.|\(dot\)|\[dot\])\s*[A-Z]{2,}/gi;
// spelled out: "joao at gmail dot com", "joao arroba gmail ponto pt"
const EMAIL_SPELLED = /[A-Z0-9._%+-]+\s+(?:at|arroba)\s+[A-Z0-9-]+\s+(?:dot|ponto|punto|point|punkt)\s+[A-Z]{2,}\b/gi;
const IBAN = /\b[A-Z]{2}\d{2}(?:[ ]?[A-Z0-9]{4}){2,7}(?:[ ]?[A-Z0-9]{1,4})?\b/g;
const LINK = /\b(?:https?:\/\/|www\.)\S+|\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|net|org|pt|es|fr|de|it|nl|be|eu|io|app|me|info|biz|shop|store|co|ly|gl)\b(?:\/\S*)?/gi;
// 9+ digits, optionally after +/00, with spaces, dots, dashes or brackets between them
const PHONE = /(?:\+|\b00)?\(?\d(?:[\s().-]{0,3}\d){8,14}\b/g;

/** Finds contact details; returns the text with them replaced (when `mask`) and what was found. */
export function screenContacts(text: string, mask = true): { text: string; flags: ChatFlag[] } {
  const flags = new Set<ChatFlag>();
  const keep: string[] = [];
  // protect FIRINGI document numbers first
  let out = text.replace(DOC_NO, (m) => { keep.push(m); return `\u0000${keep.length - 1}\u0000`; });
  const hit = (flag: ChatFlag) => (m: string) => { flags.add(flag); return mask ? HIDDEN : m; };
  out = out.replace(EMAIL, hit("EMAIL")).replace(EMAIL_SPELLED, hit("EMAIL"));
  out = out.replace(IBAN, (m) => (/\d{8,}/.test(m.replace(/\s/g, "")) ? hit("IBAN")(m) : m));
  out = out.replace(LINK, hit("LINK"));
  out = out.replace(PHONE, (m) => ((m.match(/\d/g)?.length ?? 0) >= 9 ? hit("PHONE")(m) : m));
  out = out.replace(/\u0000(\d+)\u0000/g, (_, i) => keep[Number(i)]);
  return { text: out, flags: [...flags] };
}

/** "pt-PT" → "pt" */
export const lang = (locale: string) => locale.toLowerCase().split(/[-_]/)[0];
