import { handleMeta, metaSignatureValid } from "@/server/services/notifications";

/** Meta WhatsApp Cloud API: subscription check (GET) and events (POST, signed with the app secret). */
export async function GET(req: Request) {
  const u = new URL(req.url);
  const verify = process.env.WHATSAPP_VERIFY_TOKEN;
  if (verify && u.searchParams.get("hub.mode") === "subscribe" && u.searchParams.get("hub.verify_token") === verify)
    return new Response(u.searchParams.get("hub.challenge") ?? "", { status: 200 });
  return new Response("Forbidden", { status: 403 });
}

export async function POST(req: Request) {
  const secret = process.env.WHATSAPP_APP_SECRET;
  if (!secret) return new Response("WhatsApp is not configured", { status: 503 });
  const raw = await req.text();
  if (!metaSignatureValid(raw, req.headers.get("x-hub-signature-256") ?? "", secret)) return new Response("Invalid signature", { status: 403 });
  try {
    await handleMeta(JSON.parse(raw));
  } catch {
    return new Response("Bad request", { status: 400 });
  }
  return new Response("OK");
}
