import { liveness, healthReport, VERSION } from "@/server/ops/health";
import { cronGuard } from "@/server/ops/jobs";

export const dynamic = "force-dynamic";

/**
 * For uptime monitors and the container health check: 200 when FIRINGI and its database
 * answer, 503 when not (no details for the public). With "Authorization: Bearer $CRON_SECRET"
 * and ?full=1 it returns the whole health report (503 when something is critical).
 */
export async function GET(req: Request) {
  if (new URL(req.url).searchParams.get("full") === "1") {
    const denied = cronGuard(req);
    if (denied) return denied;
    const r = await healthReport();
    return Response.json(r, { status: r.status === "critical" ? 503 : 200, headers: { "cache-control": "no-store" } });
  }
  const l = await liveness();
  return Response.json({ status: l.ok ? "ok" : "down", version: VERSION.version, commit: VERSION.commit }, { status: l.ok ? 200 : 503, headers: { "cache-control": "no-store" } });
}
