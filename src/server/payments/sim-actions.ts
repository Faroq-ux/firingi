/**
 * What the simulated provider's own pages do (approve / decline a card checkout, pay a
 * Multibanco reference, sign a SEPA mandate). Each outcome is sent through the same signed
 * webhook path a real provider uses. Only when the simulated provider is active.
 */
import "server-only";
import { prisma } from "@/server/db";
import { NotFoundError, ValidationError } from "@/server/errors";
import { activeProviderKey } from "./provider";
import { simEvent, simSign } from "./sim";
import { receiveWebhook } from "./service";

function assertSim() {
  if (activeProviderKey() !== "sim") throw new ValidationError("The simulated payment provider isn't active.");
}

async function deliver(body: string) {
  return receiveWebhook("sim", body, new Headers({ "x-sim-signature": simSign(body) }));
}

/** The hosted card checkout: approve or decline. */
export async function simCheckout(providerRef: string, outcome: "succeeded" | "failed") {
  assertSim();
  const r = await prisma.paymentRequest.findUnique({ where: { provider_providerRef: { provider: "sim", providerRef } } });
  if (!r) throw new NotFoundError("Checkout");
  await deliver(simEvent(outcome === "succeeded" ? "payment.succeeded" : "payment.failed", {
    requestId: r.id, providerRef, providerPaymentRef: `${providerRef}_pi`, amount: (r.amountLocal ?? r.amount).toString(), failureReason: outcome === "failed" ? "Card declined (simulated)" : null,
  }));
  return r;
}

/** Back office (simulation only): the customer paid the Multibanco reference — optionally another amount. */
export async function simMultibancoPaid(requestId: string, amount?: string) {
  assertSim();
  const r = await prisma.paymentRequest.findUnique({ where: { id: requestId } });
  if (!r || r.method !== "MULTIBANCO" || r.status !== "PROCESSING") throw new ValidationError("Not a Multibanco reference waiting for payment.");
  await deliver(simEvent("payment.succeeded", { requestId: r.id, providerRef: r.providerRef, providerPaymentRef: `${r.providerRef}_paid`, amount: amount ?? (r.amountLocal ?? r.amount).toString() }));
}

/** The hosted mandate page: the customer signs with their IBAN. */
export async function simSignMandate(setupRef: string, holderName: string, iban: string) {
  assertSim();
  const clean = iban.replace(/\s+/g, "").toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(clean)) throw new ValidationError("Enter a valid IBAN.");
  if (!holderName.trim()) throw new ValidationError("Enter the account holder's name.");
  const m = await prisma.sepaMandate.findFirst({ where: { provider: "sim", setupRef } });
  if (!m) throw new NotFoundError("Mandate");
  const last4 = clean.slice(-4);
  await deliver(simEvent("mandate.active", {
    mandateId: m.id, setupRef, mandate: { customerRef: m.providerCustomerRef ?? `sim_cus_${m.companyId.slice(-10)}`, paymentMethodRef: `sim_pm_${last4}`, mandateRef: `sim_mandate_${m.id.slice(-8)}`, holderName: holderName.trim(), ibanLast4: last4 },
  }));
  return m;
}
