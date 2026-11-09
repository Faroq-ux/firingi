import { getLocale } from "next-intl/server";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { TeamUsersPage } from "@/components/team/team-pages";

export const metadata = { title: "Sales Team" };

export default async function Page() {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.users.view", "admin.users.manage"]);
  const pt = (await getLocale()).startsWith("pt");
  return <TeamUsersPage ctx={ctx} roleKey="SALES" title={pt ? "Equipa Comercial" : "Sales Team"} />;
}
