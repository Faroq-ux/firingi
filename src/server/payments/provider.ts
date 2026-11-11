/**
 * Which payment provider FIRINGI uses:
 *   PAYMENTS_PROVIDER=stripe | sim   (explicit), otherwise
 *   PAYMENTS_SIMULATE=1 → simulated; STRIPE_SECRET_KEY set → Stripe; else none (online payments off).
 */
import type { OnlineMethod, PaymentProvider } from "./types";
import { simProvider } from "./sim";
import { stripeProvider } from "./stripe";

const PROVIDERS: Record<string, PaymentProvider> = { sim: simProvider, stripe: stripeProvider };

export function activeProviderKey(): "sim" | "stripe" | null {
  const p = process.env.PAYMENTS_PROVIDER;
  if (p === "sim" || p === "stripe") return p;
  if (process.env.PAYMENTS_SIMULATE === "1") return "sim";
  if (process.env.STRIPE_SECRET_KEY) return "stripe";
  return null;
}

export function activeProvider(): PaymentProvider | null {
  const k = activeProviderKey();
  return k ? PROVIDERS[k] : null;
}

export function providerByKey(key: string): PaymentProvider | null {
  return PROVIDERS[key] ?? null;
}

/** Online methods the provider supports (the settings page decides which are offered). */
export function providerMethods(): OnlineMethod[] {
  return activeProvider()?.methods ?? [];
}
