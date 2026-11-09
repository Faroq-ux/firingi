/**
 * Server-action wrapper: authenticates, checks permission, validates input with Zod,
 * maps errors to a serialisable result. Every mutating action goes through this.
 */
import "server-only";
import { z } from "zod";
import { getContext, type Ctx } from "@/server/context";
import { can } from "@/server/rbac/guard";
import type { PermissionCode } from "@/server/rbac/permissions";
import { AppError, fromDbError } from "@/server/errors";

export type ActionResult<T = unknown> =
  | { ok: true; data: T }
  | { ok: false; error: string; code: string; fieldErrors?: Record<string, string[]>; details?: Record<string, string> };

export function defineAction<S extends z.ZodTypeAny, R>(opts: {
  permission: PermissionCode | PermissionCode[] | null; // null = any signed-in member
  schema: S;
  handler: (ctx: Ctx, input: z.infer<S>) => Promise<R>;
}) {
  return async (raw: z.input<S>): Promise<ActionResult<R>> => {
    try {
      const ctx = await getContext();
      if (!ctx) return { ok: false, code: "UNAUTHENTICATED", error: "Please sign in." };
      if (opts.permission && !can(ctx, opts.permission))
        return { ok: false, code: "FORBIDDEN", error: "You do not have permission to do this." };
      const parsed = opts.schema.safeParse(raw);
      if (!parsed.success)
        return {
          ok: false,
          code: "VALIDATION",
          error: "Please check the highlighted fields.",
          fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
        };
      return { ok: true, data: await opts.handler(ctx, parsed.data) };
    } catch (e) {
      const err = e instanceof AppError ? e : fromDbError(e);
      if (err) return { ok: false, code: err.code, error: err.message, details: err.details };
      console.error(e);
      return { ok: false, code: "INTERNAL", error: "Something went wrong. Please try again." };
    }
  };
}

/** Same error handling for actions that take FormData (file uploads) and parse it themselves. */
export async function runAction<R>(handler: (ctx: Ctx) => Promise<R>): Promise<ActionResult<R>> {
  try {
    const ctx = await getContext();
    if (!ctx) return { ok: false, code: "UNAUTHENTICATED", error: "Please sign in." };
    return { ok: true, data: await handler(ctx) };
  } catch (e) {
    const err = e instanceof AppError ? e : fromDbError(e);
    if (err) return { ok: false, code: err.code, error: err.message, fieldErrors: (err as { fieldErrors?: Record<string, string[]> }).fieldErrors };
    console.error(e);
    return { ok: false, code: "INTERNAL", error: "Something went wrong. Please try again." };
  }
}
