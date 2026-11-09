import { redirect } from "next/navigation";
import { getContext, getSessionUser } from "@/server/context";
import { homeFor } from "@/server/rbac/guard";

/** Entry point: send each user to the portal their company type and permissions allow. */
export default async function Home() {
  const ctx = await getContext();
  if (ctx) redirect(homeFor(ctx));
  redirect((await getSessionUser()) ? "/no-access" : "/login");
}
