/** Back office: export a person's data for a request received by e-mail / post. ?email= */
import { getContext } from "@/server/context";
import { AppError } from "@/server/errors";
import { exportUserData } from "@/server/services/privacy";

export async function GET(req: Request) {
  const ctx = await getContext();
  if (!ctx) return new Response("Unauthorized", { status: 401 });
  try {
    const data = await exportUserData(ctx, new URL(req.url).searchParams.get("email") ?? "");
    return new Response(JSON.stringify(data, null, 2), { headers: { "content-type": "application/json; charset=utf-8", "content-disposition": `attachment; filename="firingi-personal-data-${data.account.id}.json"`, "cache-control": "private, no-store" } });
  } catch (e) {
    if (e instanceof AppError) return new Response(e.message, { status: e.status });
    throw e;
  }
}
