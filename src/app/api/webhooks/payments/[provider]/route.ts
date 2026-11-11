import { receiveWebhook } from "@/server/payments/service";
import { WebhookError } from "@/server/payments/types";

/**
 * Payment provider notifications (Stripe: https://<domain>/api/webhooks/payments/stripe).
 * 400 when the signature is wrong (the provider gives up); 500 when applying failed (it retries).
 */
export async function POST(req: Request, { params }: { params: Promise<{ provider: string }> }) {
  const { provider } = await params;
  const raw = await req.text();
  try {
    const r = await receiveWebhook(provider, raw, req.headers);
    return Response.json(r);
  } catch (e) {
    if (e instanceof WebhookError) return Response.json({ error: e.message }, { status: 400 });
    return Response.json({ error: "Not applied, retry" }, { status: 500 });
  }
}
