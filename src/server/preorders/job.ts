import "server-only";
/**
 * Pre-orders job (Phase 71, hourly): announce campaigns that opened, close and share out those whose window ended,
 * confirm allocations nobody answered, place orders before each delivery date, finish campaigns; price-lock reminders
 * and expiry.
 */
import { processCampaigns } from "./campaigns";
import { processLocks } from "./locks";

export async function processPreorders(now = new Date()) {
  const campaigns = await processCampaigns(now);
  const locks = await processLocks(now);
  return { ...campaigns, locksReminded: locks.reminded, locksExpired: locks.expired };
}
