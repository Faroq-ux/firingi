/**
 * Temperature loggers (Phase 42): a vehicle / cold-room data logger posts its readings here.
 *   POST /api/coldchain/readings   Authorization: Bearer fcl_…   (token shown once when the logger is added)
 *   body: { "readings": [{ "at": "2026-11-17T10:00:00Z", "value": 3.4 }, …] }  or  { "value": 3.4 }  (now)
 * Up to 1000 readings per call; repeated timestamps are ignored.
 */
import { NextResponse } from "next/server";
import { ingestReadings } from "@/server/coldchain/service";
import { AppError, ValidationError } from "@/server/errors";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!token.startsWith("fcl_")) return NextResponse.json({ error: { code: "UNAUTHORIZED", message: "Send the logger token as Authorization: Bearer …" } }, { status: 401 });
  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: { code: "BAD_JSON", message: "The body must be JSON." } }, { status: 400 }); }
  try {
    return NextResponse.json(await ingestReadings(token, body));
  } catch (e) {
    if (e instanceof ValidationError) return NextResponse.json({ error: { code: "VALIDATION", message: e.message } }, { status: 422 });
    if (e instanceof AppError) return NextResponse.json({ error: { code: e.code, message: e.message } }, { status: e.status ?? 400 });
    throw e;
  }
}
