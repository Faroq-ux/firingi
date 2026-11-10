/** SAF-T (PT) download: /api/saft?entity=<legalEntityId>&month=YYYY-MM */
import { getContext } from "@/server/context";
import { AppError } from "@/server/errors";
import { buildSaft } from "@/server/invoicing/saft";
import { writeAudit } from "@/server/services/audit";

export async function GET(req: Request) {
  const ctx = await getContext();
  if (!ctx) return new Response("Unauthorized", { status: 401 });
  const u = new URL(req.url).searchParams;
  try {
    const { xml, filename, documents } = await buildSaft(ctx, u.get("entity") ?? "", u.get("month") ?? "");
    await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "saft.exported", entityType: "LegalEntity", entityId: u.get("entity") ?? "", after: { month: u.get("month"), documents } });
    return new Response(xml, { headers: { "content-type": "application/xml; charset=utf-8", "content-disposition": `attachment; filename="${filename}"`, "cache-control": "private, no-store" } });
  } catch (e) {
    if (e instanceof AppError) return new Response(e.message, { status: e.status });
    throw e;
  }
}
