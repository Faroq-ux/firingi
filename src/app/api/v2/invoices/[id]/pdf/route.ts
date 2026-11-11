import { apiRoute } from "@/server/api/v2";
import { GET as pdf } from "@/app/api/invoices/[id]/pdf/route";

/** GET /api/v2/invoices/{id}/pdf — the legal PDF (the certified provider's when it issued the document). */
export const GET = apiRoute("invoices.read", (_ctx, req, p) => pdf(req, { params: Promise.resolve({ id: p.id }) }));
