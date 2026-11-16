import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { simQueue } from "@/server/bank/feed";
import { simLines } from "@/server/bank/service";

/**
 * Simulated bank (BANKFEED_SIMULATE=1 only): queue transactions for an IBAN, as if they happened at the
 * bank — the next feed sync picks them up. Body {iban, lines:[{bookingDate, amount, counterparty, counterpartyIban, remittance, bankRef}], balance?}.
 * "Authorization: Bearer $CRON_SECRET".
 */
export async function POST(req: NextRequest) {
  if (process.env.BANKFEED_SIMULATE !== "1") return NextResponse.json({ error: "not found" }, { status: 404 });
  const want = Buffer.from(`Bearer ${process.env.CRON_SECRET ?? ""}`);
  const got = Buffer.from(req.headers.get("authorization") ?? "");
  if (!process.env.CRON_SECRET || want.length !== got.length || !timingSafeEqual(want, got)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    const body = (await req.json()) as { iban?: string; lines?: unknown; balance?: number };
    if (!body.iban) return NextResponse.json({ error: "iban is required" }, { status: 400 });
    const n = await simQueue(body.iban, simLines(body.lines), typeof body.balance === "number" ? body.balance : null);
    return NextResponse.json({ queued: n });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
