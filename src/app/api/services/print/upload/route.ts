/** A customer's file for a print order (PDF / JPG / PNG / WEBP), stored privately under the company. */
import { getContext } from "@/server/context";
import { AppError } from "@/server/errors";
import { printAccess } from "@/server/servicing/printing";
import { storeUpload } from "@/server/services/storage";

export async function POST(req: Request) {
  const ctx = await getContext().catch(() => null);
  if (!ctx) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await printAccess(ctx)).order) return Response.json({ error: "Forbidden" }, { status: 403 });
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return Response.json({ error: "Please choose a file." }, { status: 400 });
  try {
    const f = await storeUpload(file, `print-artwork/${ctx.company.id}`);
    return Response.json({ key: f.key, fileName: f.fileName });
  } catch (e) {
    if (e instanceof AppError) return Response.json({ error: e.message }, { status: e.status });
    throw e;
  }
}
