/**
 * Loyalty at checkout (Phase 32): the buyer's perks and the system promotion that carries the points
 * discount and the tier's free delivery on orders, invoices and FIRINGI's promotion reports.
 * The promotion is PAUSED so it is never applied automatically and can't be entered as a code.
 */
import { prisma } from "@/server/db";
export { buyerPerks, LOYALTY_PROMOTION_ID } from "./service";
import { LOYALTY_PROMOTION_ID } from "./service";

let ensured = false;
export async function ensureLoyaltyPromotion() {
  if (ensured) return;
  await prisma.promotion.upsert({
    where: { id: LOYALTY_PROMOTION_ID },
    update: {},
    create: {
      id: LOYALTY_PROMOTION_ID, ownerType: "ADMIN", name: { en: "Loyalty points", pt: "Pontos de fidelização", es: "Puntos de fidelidad" }, kind: "ORDER_AMOUNT", value: 0.01, // nominal (a database rule): the real amount is set per checkout
      firingiFundPct: 100, vendorFundPct: 0, validFrom: new Date(0), status: "PAUSED", showInOffers: false,
      description: { en: "Loyalty points spent at checkout and the tier's free delivery (paid by FIRINGI). Managed in Marketing › Loyalty & Rewards." },
    },
  });
  ensured = true;
}
