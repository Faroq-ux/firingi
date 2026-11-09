"use server";
/**
 * Team & role server actions. Permission checks are done inside the team service
 * (which picks admin.* or team.* permissions depending on the company type), so the
 * wrapper only requires a signed-in member here.
 */
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { defineAction } from "./_action";
import * as team from "@/server/services/team";

const passwordSchema = z.string().min(10, "At least 10 characters").max(128);

export const createMemberAction = defineAction({
  permission: null,
  schema: z.object({
    name: z.string().trim().min(2).max(120),
    email: z.string().trim().email(),
    password: passwordSchema,
    jobTitle: z.string().trim().max(120).optional().nullable(),
    roleIds: z.array(z.string()).min(1, "Choose at least one role"),
    regionIds: z.array(z.string()).optional(),
  }),
  handler: async (ctx, input) => {
    const res = await team.createMember(ctx, input);
    revalidatePath("/", "layout");
    return res;
  },
});

export const setMemberRolesAction = defineAction({
  permission: null,
  schema: z.object({ membershipId: z.string(), roleIds: z.array(z.string()) }),
  handler: async (ctx, { membershipId, roleIds }) => {
    await team.setMemberRoles(ctx, membershipId, roleIds);
    revalidatePath("/", "layout");
    return null;
  },
});

export const setMemberStatusAction = defineAction({
  permission: null,
  schema: z.object({ membershipId: z.string(), status: z.enum(["ACTIVE", "DISABLED"]) }),
  handler: async (ctx, { membershipId, status }) => {
    await team.setMemberStatus(ctx, membershipId, status);
    revalidatePath("/", "layout");
    return null;
  },
});

export const saveRoleAction = defineAction({
  permission: null,
  schema: z.object({
    id: z.string().optional(),
    name: z.string().trim().min(2).max(80),
    description: z.string().trim().max(300).optional().nullable(),
    permissions: z.array(z.string()),
  }),
  handler: async (ctx, input) => {
    const res = await team.saveCustomRole(ctx, input);
    revalidatePath("/", "layout");
    return res;
  },
});

export const deleteRoleAction = defineAction({
  permission: null,
  schema: z.object({ id: z.string() }),
  handler: async (ctx, { id }) => {
    await team.deleteCustomRole(ctx, id);
    revalidatePath("/", "layout");
    return null;
  },
});
