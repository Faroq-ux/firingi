/**
 * Phase 46 — the services that carry e-invoices. FIRINGI picks one per country on the settings page:
 *   eu-hub     one EU-wide e-invoicing service (Peppol + KSeF + SDI + Verifactu + Factur-X …) — EINVOICE_HUB_URL / EINVOICE_HUB_KEY
 *   peppol-ap  a Peppol access point                                                — PEPPOL_AP_URL / PEPPOL_AP_KEY
 *   ksef       Poland's KSeF                                                        — KSEF_URL / KSEF_TOKEN
 *   sdi        Italy's SDI (through an accredited intermediary)                     — SDI_URL / SDI_KEY
 *   aeat       Spain's AEAT Verifactu                                               — AEAT_URL / AEAT_KEY
 *   email      e-mail with the XML (and PDF) attached — always available
 * Live services are called through one small REST contract (POST /documents, GET /documents/:id, GET /inbox);
 * the adapter for the service FIRINGI signs with maps onto it. Without keys, EINVOICE_SIMULATE=1 (and tests)
 * use a built-in network that behaves like the real one: sent → delivered/cleared → accepted, rejects and outages.
 */
import { randomBytes } from "node:crypto";
import type { EFormat, EProvider } from "@/lib/einvoice";

export type SendInput = {
  docId: string; format: EFormat; kind: string; number: string; fileName: string; xml: Buffer; pdf: Buffer | null;
  sender: { peppolId: string | null; vatId: string | null; countryCode: string; name: string };
  receiver: { peppolId: string | null; email: string | null; countryCode: string; sdiCode?: string | null; pec?: string | null; name: string };
  language: string;
};
export type NetStatus = "SENT" | "DELIVERED" | "ACCEPTED" | "REJECTED";
export type SendResult = { externalId: string; networkRef: string | null; status: NetStatus; note?: string | null };
export type StatusResult = { status: NetStatus; networkRef?: string | null; note?: string | null };
export type InboxItem = { externalId: string; format: string; fileName: string; xml: string; sender: { peppolId?: string | null; vatId?: string | null } };

export class EInvoiceError extends Error {
  constructor(message: string, public retryable: boolean) { super(message); }
}

export type Mode = "live" | "simulated" | "off";

type Adapter = {
  mode(): Mode;
  send(i: SendInput): Promise<SendResult>;
  status(externalId: string, current: NetStatus, i: { format: string; receiver: string | null }): Promise<StatusResult>;
  inbox?(): Promise<InboxItem[]>;
};

const ENV: Record<Exclude<EProvider, "email">, [string, string]> = {
  "eu-hub": ["EINVOICE_HUB_URL", "EINVOICE_HUB_KEY"],
  "peppol-ap": ["PEPPOL_AP_URL", "PEPPOL_AP_KEY"],
  ksef: ["KSEF_URL", "KSEF_TOKEN"],
  sdi: ["SDI_URL", "SDI_KEY"],
  aeat: ["AEAT_URL", "AEAT_KEY"],
};

export const simulating = () => process.env.EINVOICE_SIMULATE === "1" || process.env.NODE_ENV === "test";

export function providerMode(p: EProvider): Mode {
  if (p === "email") return "live";
  const [u, k] = ENV[p];
  if (process.env[u] && process.env[k]) return "live";
  return simulating() ? "simulated" : "off";
}

// ── the built-in network (simulation) ───────────────────────────────────────

const hex = (n: number) => randomBytes(n).toString("hex").toUpperCase();
function simRef(format: string, number: string) {
  const day = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  if (format === "KSEF_FA3") return `${day}-EE-${hex(5)}-${hex(5)}-${hex(1)}`;
  if (format === "FATTURAPA") return String(1_000_000_000 + Math.floor(Math.random() * 899_999_999));
  if (format === "VERIFACTU") return `A-${hex(7)}`;
  return `peppol-${hex(8).toLowerCase()}-${number.replace(/\W+/g, "").slice(-6)}`;
}
const CLEARANCE = new Set(["KSEF_FA3", "FATTURAPA", "VERIFACTU"]);

const simAdapter: Adapter = {
  mode: () => "simulated",
  async send(i) {
    const marker = `${i.receiver.peppolId ?? ""} ${i.receiver.email ?? ""} ${i.receiver.sdiCode ?? ""} ${i.receiver.name}`.toUpperCase();
    if (marker.includes("NETFAIL")) throw new EInvoiceError("The e-invoicing service did not answer (simulated outage).", true);
    if (marker.includes("NOTREG")) throw new EInvoiceError("The recipient is not registered on the network (simulated).", false);
    return { externalId: `sim-${hex(6).toLowerCase()}`, networkRef: CLEARANCE.has(i.format) ? simRef(i.format, i.number) : null, status: "SENT" };
  },
  async status(externalId, current, i) {
    if ((i.receiver ?? "").toUpperCase().includes("REJECT")) return { status: "REJECTED", note: "The recipient rejected the document (simulated): reference unknown." };
    if (current === "SENT") return CLEARANCE.has(i.format) ? { status: "ACCEPTED", note: "Cleared by the tax system (simulated)." } : { status: "DELIVERED", networkRef: simRef(i.format, externalId), note: "Delivered to the recipient's access point (simulated)." };
    if (current === "DELIVERED") return { status: "ACCEPTED", note: "Accepted by the recipient (simulated)." };
    return { status: current };
  },
};

// ── live REST services ──────────────────────────────────────────────────────

function restAdapter(p: Exclude<EProvider, "email">): Adapter {
  const [u, k] = ENV[p];
  const call = async (path: string, init?: RequestInit) => {
    let res: Response;
    try {
      res = await fetch(`${process.env[u]!.replace(/\/$/, "")}${path}`, { ...init, headers: { Authorization: `Bearer ${process.env[k]}`, "Content-Type": "application/json", ...(init?.headers ?? {}) }, signal: AbortSignal.timeout(30_000) });
    } catch (e) {
      throw new EInvoiceError(`The e-invoicing service could not be reached: ${e instanceof Error ? e.message : String(e)}`, true);
    }
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) throw new EInvoiceError(String(body.message ?? body.error ?? `HTTP ${res.status}`), res.status >= 500 || res.status === 429);
    return body;
  };
  const st = (v: unknown): NetStatus => (["SENT", "DELIVERED", "ACCEPTED", "REJECTED"].includes(String(v).toUpperCase()) ? (String(v).toUpperCase() as NetStatus) : "SENT");
  return {
    mode: () => providerMode(p),
    async send(i) {
      const b = await call("/documents", { method: "POST", body: JSON.stringify({
        reference: i.docId, format: i.format, number: i.number, fileName: i.fileName, content: i.xml.toString("base64"), pdf: i.pdf?.toString("base64") ?? null,
        sender: i.sender, receiver: i.receiver, language: i.language,
      }) });
      return { externalId: String(b.id ?? b.externalId), networkRef: (b.reference ?? b.networkRef ?? null) as string | null, status: st(b.status), note: (b.note ?? null) as string | null };
    },
    async status(externalId) {
      const b = await call(`/documents/${encodeURIComponent(externalId)}`);
      return { status: st(b.status), networkRef: (b.reference ?? b.networkRef ?? null) as string | null, note: (b.note ?? b.message ?? null) as string | null };
    },
    async inbox() {
      const b = await call("/inbox");
      return ((b.items ?? []) as Record<string, unknown>[]).map((x) => ({
        externalId: String(x.id), format: String(x.format ?? "UBL"), fileName: String(x.fileName ?? `${x.id}.xml`),
        xml: Buffer.from(String(x.content ?? ""), "base64").toString("utf8"), sender: (x.sender ?? {}) as InboxItem["sender"],
      }));
    },
  };
}

// ── e-mail ──────────────────────────────────────────────────────────────────

const emailAdapter: Adapter = {
  mode: () => "live",
  async send(i) {
    if (!i.receiver.email) throw new EInvoiceError("The recipient has no e-mail address for invoices.", false);
    const { sendMail } = await import("@/server/services/mailer");
    const attachments = [{ filename: i.fileName, content: i.xml }, ...(i.pdf ? [{ filename: `${i.number.replace(/[^\w.-]+/g, "_")}.pdf`, content: i.pdf }] : [])];
    await sendMail({ to: i.receiver.email, subject: `${i.sender.name} — ${i.number}`, text: `${i.number}\n\n${i.sender.name}\n(e-invoice ${i.format})`, attachments });
    return { externalId: `mail-${hex(6).toLowerCase()}`, networkRef: null, status: "DELIVERED", note: `E-mailed to ${i.receiver.email}` };
  },
  async status(_id, current) { return { status: current === "SENT" ? "DELIVERED" : current }; },
};

export function adapter(p: EProvider): Adapter {
  if (p === "email") return emailAdapter;
  const m = providerMode(p);
  if (m === "live") return restAdapter(p);
  if (m === "simulated") return simAdapter;
  return {
    mode: () => "off",
    async send() { throw new EInvoiceError(`Not connected: set ${ENV[p].join(" and ")} on the server (or EINVOICE_SIMULATE=1 for a demo).`, false); },
    async status(_id, current) { return { status: current }; },
  };
}
