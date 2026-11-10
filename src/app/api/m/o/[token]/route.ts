import { trackOpen } from "@/server/marketing/campaigns";

/** E-mail open pixel of a marketing campaign (1×1 transparent GIF). */
const GIF = Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64");
export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  await trackOpen((await params).token).catch(() => {});
  return new Response(GIF, { headers: { "content-type": "image/gif", "cache-control": "no-store, max-age=0" } });
}
