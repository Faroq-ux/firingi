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

/** Plain-language names for permissions, their areas and FIRINGI's built-in roles (translated for supplier and customer
 *  pages; FIRINGI back-office permissions stay in English). Codes such as "buyer.orders.place" are never shown. */
async function permTexts() {
  const t = await getTranslations("perm");
  const key = (m: string) => m.replace(/[^A-Za-z0-9]/g, "");
  const tr = (k: string, fallback: string) => (t.has(k) ? t(k) : fallback);
  const def = (code: string) => PERMISSIONS[code as keyof typeof PERMISSIONS];
  return {
    title: t("title"),
    perm: (code: string) => { const d = def(code); if (!d) return code; return d.audience === "ADMIN" ? d.description : tr(`p.${code.replace(/\./g, "_")}`, d.description); },
    module: (code: string) => { const d = def(code); if (!d) return ""; return d.audience === "ADMIN" ? d.module : tr(`module.${key(d.module)}`, d.module); },
    role: <R extends { key: string; name: string; description?: string | null; isSystem: boolean }>(r: R) =>
      r.isSystem && t.has(`role.${r.key}.name`) ? { ...r, name: t(`role.${r.key}.name`), description: t(`role.${r.key}.desc`) } : r,
  };
}

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
  const [members, rawRoles, labels, t, c, locale, pt] = await Promise.all([
    listMembers(ctx, { roleKey }),
    listRoles(ctx),
    memberLabels(),
    getTranslations("team"),
    getTranslations("common"),
    getLocale(),
    permTexts(),
  ]);
  const roles = rawRoles.map(pt.role);
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
                  {m.roles.map((r) => <Badge key={r.roleId} variant="secondary">{pt.role({ ...r.role, description: null }).name}</Badge>)}
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
  const [rawRoles, t, c, pt] = await Promise.all([listRoles(ctx), getTranslations("team"), getTranslations("common"), permTexts()]);
  const roles = rawRoles.map(pt.role);

  // Permission picker: only what this company type may grant (and, unless owner, what the editor holds).
  const grantable = grantablePermissions(ctx.company.type).filter((p) => ctx.membership.isOwner || ctx.permissions.has(p));
  const byModule = new Map<string, PermGroup>();
  for (const code of grantable) {
    const title = pt.module(code);
    if (!byModule.has(title)) byModule.set(title, { title, perms: [] });
    byModule.get(title)!.perms.push({ code, description: pt.perm(code) });
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
            <CardHeader className="flex-row flex-wrap items-start justify-between gap-2">
              <div className="min-w-0 flex-1 space-y-1">
                <CardTitle className="flex flex-wrap items-center gap-2 break-words">
                  {r.name} <Badge variant={r.isSystem ? "secondary" : "default"}>{r.isSystem ? t("system") : t("custom")}</Badge>
                </CardTitle>
                <CardDescription>{r.description} · {t("members", { count: r.memberCount })}</CardDescription>
              </div>
              {canManage && !r.isSystem && <RoleEditor groups={groups} labels={labels} role={r} />}
            </CardHeader>
            <CardContent>
              <PermissionList groups={groupPerms(r.permissions, pt)} title={pt.title} />
            </CardContent>
          </Card>
        ))}
      </div>
    </>
  );
}

/** A role's permissions grouped by area, in plain words. */
function groupPerms(codes: string[], pt: Awaited<ReturnType<typeof permTexts>>) {
  const out = new Map<string, string[]>();
  for (const code of codes) {
    const m = pt.module(code);
    if (!out.has(m)) out.set(m, []);
    out.get(m)!.push(pt.perm(code));
  }
  return [...out.entries()].map(([module, perms]) => ({ module, perms }));
}

function PermissionList({ groups, title }: { groups: { module: string; perms: string[] }[]; title: string }) {
  return (
    <div className="space-y-2" data-testid="role-permissions">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{title}</div>
      <dl className="grid gap-x-4 gap-y-2 text-sm sm:grid-cols-[minmax(0,9rem)_minmax(0,1fr)]">
        {groups.map((g) => (
          <div key={g.module} className="contents">
            <dt className="font-medium text-foreground/90">{g.module}</dt>
            <dd className="min-w-0 text-muted-foreground">
              <ul className="space-y-0.5">{g.perms.map((p) => <li key={p} className="break-words">{p}</li>)}</ul>
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
