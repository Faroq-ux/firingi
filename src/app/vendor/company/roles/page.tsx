import { getTranslations } from "next-intl/server";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { TeamRolesPage } from "@/components/team/team-pages";

export const metadata = { title: "Roles" };

export default async function Page() {
  const ctx = await pagePortal("vendor");
  pagePermission(ctx, ["team.users.view", "team.roles.manage"]);
  const t = await getTranslations("team");
  return <TeamRolesPage ctx={ctx} title={t("roles")} />;
}
