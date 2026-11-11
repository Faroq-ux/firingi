/** Personal workspace: saved table views and preferences (dashboard layout) — per user, per company. */
import type { Prisma } from "@prisma/client";
import { prisma } from "@/server/db";
import type { Ctx } from "@/server/context";
import { NotFoundError, ValidationError } from "@/server/errors";

const TABLE = /^[a-z0-9]+(\.[a-z0-9-]+)+$/;
const KEY = /^[a-z0-9]+(\.[a-z0-9-]+)+$/;
const json = (v: unknown, max = 20_000) => {
  const s = JSON.stringify(v ?? null);
  if (s.length > max) throw new ValidationError("Too large.");
  return JSON.parse(s) as Prisma.InputJsonValue;
};

export type ViewDTO = { id: string; name: string; state: unknown; isDefault: boolean };

export async function listViews(ctx: Ctx, tableId: string): Promise<ViewDTO[]> {
  if (!TABLE.test(tableId)) return [];
  const rows = await prisma.savedView.findMany({ where: { userId: ctx.user.id, companyId: ctx.company.id, tableId }, orderBy: [{ isDefault: "desc" }, { name: "asc" }] });
  return rows.map((r) => ({ id: r.id, name: r.name, state: r.state, isDefault: r.isDefault }));
}

export async function saveView(ctx: Ctx, input: { tableId: string; name: string; state: unknown; isDefault?: boolean }) {
  if (!TABLE.test(input.tableId)) throw new ValidationError("Unknown table.");
  const name = input.name.trim().slice(0, 60);
  if (!name) throw new ValidationError("Give the view a name.");
  const where = { userId: ctx.user.id, companyId: ctx.company.id, tableId: input.tableId };
  if ((await prisma.savedView.count({ where })) >= 30) throw new ValidationError("At most 30 views per table.");
  return prisma.$transaction(async (tx) => {
    if (input.isDefault) await tx.savedView.updateMany({ where, data: { isDefault: false } });
    const row = await tx.savedView.upsert({
      where: { userId_companyId_tableId_name: { ...where, name } },
      create: { ...where, name, state: json(input.state), isDefault: !!input.isDefault },
      update: { state: json(input.state), ...(input.isDefault !== undefined ? { isDefault: input.isDefault } : {}) },
    });
    return { id: row.id, name: row.name, state: row.state, isDefault: row.isDefault } as ViewDTO;
  });
}

export async function deleteView(ctx: Ctx, id: string) {
  const r = await prisma.savedView.deleteMany({ where: { id, userId: ctx.user.id, companyId: ctx.company.id } });
  if (!r.count) throw new NotFoundError("View");
}

export async function getPreference<T>(ctx: Ctx, key: string): Promise<T | null> {
  if (!KEY.test(key)) return null;
  const r = await prisma.userPreference.findUnique({ where: { userId_companyId_key: { userId: ctx.user.id, companyId: ctx.company.id, key } } });
  return (r?.value as T) ?? null;
}

export async function setPreference(ctx: Ctx, key: string, value: unknown) {
  if (!KEY.test(key)) throw new ValidationError("Unknown setting.");
  const where = { userId_companyId_key: { userId: ctx.user.id, companyId: ctx.company.id, key } };
  if (value === null) { await prisma.userPreference.deleteMany({ where: { userId: ctx.user.id, companyId: ctx.company.id, key } }); return; }
  await prisma.userPreference.upsert({ where, create: { userId: ctx.user.id, companyId: ctx.company.id, key, value: json(value) }, update: { value: json(value) } });
}
