/** Phase 51: the shop's CO₂ filter labels — null when FIRINGI hides badges or the buyer doesn't see CO₂. */
import "server-only";
import type { Ctx } from "@/server/context";
import { co2Access, co2Settings } from "@/server/co2/service";
import { co2Labels } from "./labels";

export async function co2Filter(ctx: Ctx) {
  const s = await co2Settings();
  if (!s.enabled || !s.show.badges || !(await co2Access(ctx.company, s)).buyer) return null;
  return (await co2Labels()).l;
}
