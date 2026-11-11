import { openApiDocument } from "@/server/api/openapi";

/** GET /api/v2/openapi.json — machine-readable description of the API (public). */
export function GET(req: Request) {
  return Response.json(openApiDocument(new URL(req.url).origin), { headers: { "cache-control": "public, max-age=300" } });
}
