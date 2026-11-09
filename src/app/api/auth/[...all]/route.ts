import { toNextJsHandler } from "better-auth/next-js";
import { auth } from "@/server/auth/auth";

const handler = toNextJsHandler(auth);

export const GET = handler.GET;

/**
 * Public self sign-up is disabled: every account must go through the FIRINGI
 * registration + approval flow (server-side), so `/sign-up/*` is rejected here.
 */
export async function POST(req: Request) {
  const path = new URL(req.url).pathname;
  if (path.includes("/sign-up")) {
    return Response.json({ code: "SIGN_UP_DISABLED", message: "Use the FIRINGI registration form." }, { status: 403 });
  }
  return handler.POST(req);
}
