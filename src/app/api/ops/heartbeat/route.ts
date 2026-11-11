import { z } from "zod";
import { cronGuard, recordExternalRun } from "@/server/ops/jobs";

/** The backup service reports its runs here ("Authorization: Bearer $CRON_SECRET"). */
const Body = z.object({ job: z.enum(["backup", "restore-test"]), ok: z.boolean(), durationMs: z.number().int().nonnegative().optional(), summary: z.record(z.string(), z.unknown()).nullable().optional(), error: z.string().max(4000).nullable().optional() });

export async function POST(req: Request) {
  const denied = cronGuard(req);
  if (denied) return denied;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid body" }, { status: 400 });
  const run = await recordExternalRun(parsed.data);
  return Response.json({ id: run.id });
}
