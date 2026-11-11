"use server";
/** System health: run the checks / alerts now (super admins and settings managers). */
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { defineAction } from "./_action";
import { checkAndAlert } from "@/server/ops/alerts";
import { runJob } from "@/server/ops/jobs";

export const runHealthChecksAction = defineAction({
  permission: "admin.settings.manage",
  schema: z.object({}),
  handler: async () => { const r = await runJob("ops", () => checkAndAlert()); revalidatePath("/admin/settings/system-health"); return r; },
});
