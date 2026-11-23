import type { z } from "zod";
import { ValidationError } from "@/server/errors";

/** Parse, or fail with the first problem in plain words ("Step 2: Write what the agent should do."). */
export function firstIssue<S extends z.ZodTypeAny>(schema: S, input: unknown): z.infer<S> {
  const r = schema.safeParse(input);
  if (r.success) return r.data;
  const i = r.error.issues[0];
  const where = i.path[0] === "steps" && typeof i.path[1] === "number" ? `Step ${i.path[1] + 1}: ` : i.path[0] === "conditions" && typeof i.path[1] === "number" ? `Condition ${i.path[1] + 1}: ` : "";
  const msg = i.code === "invalid_type" && i.path.length ? `${String(i.path[i.path.length - 1])} is missing or wrong.` : i.message;
  throw new ValidationError(`${where}${msg}`);
}
