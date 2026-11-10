import { trackClick } from "@/server/marketing/campaigns";

/** Campaign link / button: records the click and opens the page the campaign points to (sign-in first if needed). */
export async function GET(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const to = await trackClick((await params).token).catch(() => "/");
  return Response.redirect(new URL(to, req.url), 303);
}
