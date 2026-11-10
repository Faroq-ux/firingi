/** GDPR access / portability: download my personal data as JSON. */
import { getContext } from "@/server/context";
import { exportMyData } from "@/server/services/privacy";

export async function GET() {
  const ctx = await getContext();
  if (!ctx) return new Response("Unauthorized", { status: 401 });
  const data = await exportMyData(ctx);
  return new Response(JSON.stringify(data, null, 2), {
    headers: { "content-type": "application/json; charset=utf-8", "content-disposition": `attachment; filename="firingi-my-data-${new Date().toISOString().slice(0, 10)}.json"`, "cache-control": "private, no-store" },
  });
}
