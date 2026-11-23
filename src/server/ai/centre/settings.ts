import "server-only";
/** AI Centre settings (Phase 66): FIRINGI's switch per recommendation area, forecast and report; fuel rates; thresholds; weekly email. */
import type { Prisma } from "@prisma/client";
import { prisma } from "@/server/db";
import type { Ctx } from "@/server/context";
import { can } from "@/server/rbac/guard";
import { ForbiddenError } from "@/server/errors";
import { mergeAiCentre, type AiCentreSettings } from "@/lib/ai-centre";

const KEY = "ai.centre";

export async function aiCentreSettings(): Promise<AiCentreSettings> {
  const row = await prisma.setting.findFirst({ where: { scope: "GLOBAL", scopeId: "", key: KEY } });
  return mergeAiCentre(row?.value as Partial<AiCentreSettings> | null);
}

export async function saveAiCentreSettings(ctx: Ctx, input: Partial<AiCentreSettings>) {
  if (ctx.company.type !== "ADMIN" || !can(ctx, "admin.settings.manage")) throw new ForbiddenError();
  const before = await aiCentreSettings();
  const next = mergeAiCentre({ ...before, ...input });
  await prisma.setting.upsert({
    where: { scope_scopeId_key: { scope: "GLOBAL", scopeId: "", key: KEY } },
    update: { value: next as unknown as Prisma.InputJsonValue, updatedById: ctx.user.id }, create: { scope: "GLOBAL", key: KEY, value: next as unknown as Prisma.InputJsonValue, updatedById: ctx.user.id },
  });
  const { logAi } = await import("../feed");
  await logAi({ kind: "SETTINGS", ctx, summary: "AI Centre settings changed", detail: { before, after: next } });
  return next;
}
