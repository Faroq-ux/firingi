import { NextResponse, type NextRequest } from "next/server";
import { feedCallback } from "@/server/bank/service";

/** The bank (or the simulated bank) sends the account holder back here after the consent. */
export async function GET(req: NextRequest) {
  const account = req.nextUrl.searchParams.get("account") ?? "";
  const ret = req.nextUrl.searchParams.get("return") ?? "";
  const back = /^\/(admin|vendor|buy)\/[\w/-]*$/.test(ret) ? ret : "/";
  let state = "linked";
  try {
    const st = await feedCallback(account);
    state = st.status === "LINKED" ? "linked" : st.status.toLowerCase();
  } catch {
    state = "error";
  }
  const url = new URL(back, req.nextUrl.origin);
  url.searchParams.set("feed", state);
  return NextResponse.redirect(url, 303);
}
