import { timingSafeEqual } from "node:crypto";
import { receiveSupplierXml } from "@/server/einvoice/service";

/**
 * Phase 46 — an e-invoicing service pushes a received supplier e-invoice (UBL / CII / KSeF XML) here.
 * "Authorization: Bearer $EINVOICE_INBOUND_SECRET", body = the XML, headers X-Provider / X-Document-Id / X-File-Name.
 */
export async function POST(req: Request) {
  const secret = process.env.EINVOICE_INBOUND_SECRET ?? "";
  const got = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const ok = secret.length >= 16 && got.length === secret.length && timingSafeEqual(Buffer.from(got), Buffer.from(secret));
  if (!ok) return new Response("Unauthorized", { status: 401 });
  const xml = await req.text();
  if (!xml.trim().startsWith("<") || xml.length > 5_000_000) return new Response("Expected an XML document", { status: 400 });
  const doc = await receiveSupplierXml(xml, { provider: req.headers.get("x-provider") ?? "eu-hub", externalId: req.headers.get("x-document-id"), fileName: req.headers.get("x-file-name") });
  if (!doc) return Response.json({ accepted: false, reason: "Receiving supplier e-invoices is switched off." }, { status: 202 });
  return Response.json({ accepted: true, id: doc.id, status: doc.status });
}
