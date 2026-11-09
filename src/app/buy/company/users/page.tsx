import { getTranslations } from "next-intl/server";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { TeamUsersPage } from "@/components/team/team-pages";

export const metadata = { title: "Users" };

export default async function Page() {
  const ctx = await pagePortal("buy");
  pagePermission(ctx, ["team.users.view", "team.users.manage"]);
  const t = await getTranslations("team");
  return <TeamUsersPage ctx={ctx} title={t("users")} />;
}
