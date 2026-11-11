import "server-only";
import { prisma } from "@/server/db";
import { activeProviderKey } from "./provider";

export async function simCheckoutData(providerRef: string) {
  if (activeProviderKey() !== "sim") return null;
  const r = await prisma.paymentRequest.findUnique({ where: { provider_providerRef: { provider: "sim", providerRef } } });
  return r && (r.status === "OPEN" || r.status === "FAILED") ? { providerRef, amount: r.amount.toFixed(2) } : null;
}

export async function simMandateData(setupRef: string) {
  if (activeProviderKey() !== "sim") return null;
  const m = await prisma.sepaMandate.findFirst({ where: { provider: "sim", setupRef, status: "PENDING" }, include: { company: { select: { legalName: true } } } });
  return m ? { setupRef, company: m.company.legalName, holder: m.company.legalName } : null;
}
