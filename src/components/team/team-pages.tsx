/**
 * Server components for team management. Used by:
 *   /admin/users/*                       (FIRINGI staff)
 *   /vendor/company/users|roles          (distributors / wholesalers)
 *   /buy/company/users|roles             (customers / wholesalers)
 */
import { getLocale, getTranslations } from "next-intl/server";
import type { Ctx } from "@/server/context";
import { can } from "@/server/rbac/guard";
import { listMembers, listRoles } from "@/server/services/team";
import { listRegionOptions } from "@/server/data/geo";
import { PERMISSIONS, grantablePermissions } from "@/server/rbac/permissions";
import { pickLocalized } from "@/i18n/config";
import { formatDate } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyRow, TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { PageHeader } from "@/components/layout/page-header";
import { AddMemberForm, MemberActions } from "./member-forms";
import { RoleEditor, type PermGroup } from "./role-editor";

async function memberLabels() {
  const [t, c] = await Promise.all([getTranslations("team"), getTranslations("common")]);
  return {
    addUser: t("addUser"), name: c("name"), email: c("email"), jobTitle: t("jobTitle"), initialPassword: t("initialPassword"),
    passwordHint: t("passwordHint"), rolesLabel: t("rolesLabel"), regions: t("regions"), regionsHint: t("regionsHint"),
    create: c("create"), cancel: c("cancel"), save: c("save"), editRoles: t("editRoles"), enable: c("enable"), disable: c("disable"),
  };
}

export async function TeamUsersPage({ ctx, title, roleKey, description }: { ctx: Ctx; title: string; roleKey?: string; description?: string }) {
  const isAdmin = ctx.company.type === "ADMIN";
  const canManage = can(ctx, isAdmin ? "admin.users.manage" : "team.users.manage");
  const [members, roles, labels, t, c, locale] = await Promise.all([
    listMembers(ctx, { roleKey }),
    listRoles(ctx),
    memberLabels(),
    getTranslations("team"),
    getTranslations("common"),
    getLocale(),
  ]);
  const regions = isAdmin && canManage ? await listRegionOptions(ctx) : [];
  const roleOptions = roles.map((r) => ({ id: r.id, name: r.name, isSystem: r.isSystem, description: r.description }));

  return (
    <>
      <PageHeader
        title={title}
        description={description}
        actions={canManage && (
          <AddMemberForm
            roles={roleOptions}
            regions={regions.map((r) => ({ id: r.id, label: `${r.country.code} · ${pickLocalized(r.name, locale)}` }))}
            labels={labels}
          />
        )}
      />
      <Table>
        <THead>
          <TR>
            <TH>{c("name")}</TH>
            <TH>{t("rolesLabel")}</TH>
            {isAdmin && <TH>{t("scope")}</TH>}
            <TH>{c("status")}</TH>
            <TH>{c("lastLogin")}</TH>
            <TH className="text-right">{c("actions")}</TH>
          </TR>
        </THead>
        <TBody>
          {members.length === 0 && <EmptyRow colSpan={6}>{c("noData")}</EmptyRow>}
          {members.map((m) => (
            <TR key={m.id}>
              <TD>
                <div className="font-medium">
                  {m.user.name} {m.id === ctx.membership.id && <span className="text-xs text-muted-foreground">({c("you")})</span>}
                </div>
                <div className="text-xs text-muted-foreground">{m.user.email}{m.jobTitle ? ` · ${m.jobTitle}` : ""}</div>
              </TD>
              <TD>
                <div className="flex flex-wrap gap-1">
                  {m.isOwner && <Badge>{c("owner")}</Badge>}
                  {m.roles.map((r) => <Badge key={r.roleId} variant="secondary">{r.role.name}</Badge>)}
                  {!m.isOwner && m.roles.length === 0 && <span className="text-xs text-muted-foreground">{t("noRoles")}</span>}
                </div>
              </TD>
              {isAdmin && (
                <TD className="text-xs">
                  {m.scopes.length === 0 ? t("allRegions") : m.scopes.map((s) => `${s.country?.code ?? ""} ${s.region ? pickLocalized(s.region.name, locale) : ""}`).join(", ")}
                </TD>
              )}
              <TD>
                <Badge variant={m.status === "ACTIVE" && m.user.status === "ACTIVE" ? "success" : "destructive"}>
                  {m.status === "ACTIVE" && m.user.status === "ACTIVE" ? c("active") : c("disabled")}
                </Badge>
              </TD>
              <TD className="text-xs text-muted-foreground">{m.user.lastLoginAt ? formatDate(m.user.lastLoginAt, locale, true) : c("never")}</TD>
              <TD className="text-right">
                <MemberActions
                  membershipId={m.id}
                  currentRoleIds={m.roles.map((r) => r.roleId)}
                  roles={roleOptions}
                  status={m.status}
                  canEdit={canManage && m.id !== ctx.membership.id && (!m.isOwner || ctx.membership.isOwner)}
                  labels={labels}
                />
              </TD>
            </TR>
          ))}
        </TBody>
      </Table>
    </>
  );
}

export async function TeamRolesPage({ ctx, title }: { ctx: Ctx; title: string }) {
  const isAdmin = ctx.company.type === "ADMIN";
  const canManage = can(ctx, isAdmin ? "admin.roles.manage" : "team.roles.manage");
  const [roles, t, c] = await Promise.all([listRoles(ctx), getTranslations("team"), getTranslations("common")]);

  // Permission picker: only what this company type may grant (and, unless owner, what the editor holds).
  const grantable = grantablePermissions(ctx.company.type).filter((p) => ctx.membership.isOwner || ctx.permissions.has(p));
  const byModule = new Map<string, PermGroup>();
  for (const code of grantable) {
    const def = PERMISSIONS[code];
    const title = `${def.audience} · ${def.module}`;
    if (!byModule.has(title)) byModule.set(title, { title, perms: [] });
    byModule.get(title)!.perms.push({ code, description: def.description });
  }
  const groups = [...byModule.values()];
  const labels = {
    addRole: t("addRole"), edit: c("edit"), delete: c("delete"), roleName: t("roleName"), description: t("description"),
    permissions: t("permissions"), save: c("save"), cancel: c("cancel"), confirmDelete: t("confirmDelete"),
  };

  return (
    <>
      <PageHeader title={title} description={t("systemRoleNote")} actions={canManage && <RoleEditor groups={groups} labels={labels} />} />
      <div className="grid gap-4 lg:grid-cols-2">
        {roles.map((r) => (
          <Card key={r.id}>
            <CardHeader className="flex-row items-start justify-between gap-2">
              <div className="space-y-1">
                <CardTitle className="flex items-center gap-2">
                  {r.name} <Badge variant={r.isSystem ? "secondary" : "default"}>{r.isSystem ? t("system") : t("custom")}</Badge>
                </CardTitle>
                <CardDescription>{r.description} · {t("members", { count: r.memberCount })}</CardDescription>
              </div>
              {canManage && !r.isSystem && <RoleEditor groups={groups} labels={labels} role={r} />}
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-1">
                {r.permissions.map((p) => <code key={p} className="rounded bg-muted px-1.5 py-0.5 text-[11px]">{p}</code>)}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </>
  );
}
