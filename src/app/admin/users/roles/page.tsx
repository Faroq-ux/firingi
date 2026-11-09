import { getLocale } from "next-intl/server";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { TeamRolesPage } from "@/components/team/team-pages";

export const metadata = { title: "Roles" };

export default async function Page() {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.users.view", "admin.roles.manage"]);
  return <TeamRolesPage ctx={ctx} title={(await getLocale()).startsWith("pt") ? "Funções" : "Roles"} />;
}
