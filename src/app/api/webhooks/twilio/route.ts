import { after } from "next/server";
import { handleTwilio, twilioSignatureValid } from "@/server/services/notifications";

/** Twilio delivery status callbacks + inbound SMS / WhatsApp. Signed with the auth token. */
export async function POST(req: Request) {
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!token) return new Response("Twilio is not configured", { status: 503 });
  const params = Object.fromEntries(new URLSearchParams(await req.text())) as Record<string, string>;
  const url = process.env.TWILIO_WEBHOOK_URL ?? req.url; // the public URL Twilio calls (behind proxies)
  if (!twilioSignatureValid(url, params, req.headers.get("x-twilio-signature") ?? "", token)) return new Response("Invalid signature", { status: 403 });
  const id = await handleTwilio(params);
  // Phase 58: answer Twilio at once; the ordering AI handles the message right after (the job catches any left over)
  if (id) after(async () => { await (await import("@/server/whatsapp/ordering")).processInbound(id).catch(() => null); });
  return new Response("<Response/>", { headers: { "content-type": "text/xml" } });
}
