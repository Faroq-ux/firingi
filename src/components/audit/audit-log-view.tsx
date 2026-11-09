import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import type { Ctx } from "@/server/context";
import { listAuditEntityTypes, listAuditLogs } from "@/server/data/audit";
import { PageHeader } from "@/components/layout/page-header";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { EmptyRow, TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { formatDate } from "@/lib/utils";

/** Shared by Risk › Audit Trail and Settings › Audit Logs. */
export async function AuditLogView({ ctx, title, basePath, params }: { ctx: Ctx; title: string; basePath: string; params: { action?: string; entity?: string; page?: string } }) {
  const [data, entityTypes, c, locale] = await Promise.all([
    listAuditLogs(ctx, { action: params.action, entityType: params.entity, page: Number(params.page) || 1 }),
    listAuditEntityTypes(ctx),
    getTranslations("common"),
    getLocale(),
  ]);
  const qs = (page: number) => `${basePath}?${new URLSearchParams({ ...(params.action ? { action: params.action } : {}), ...(params.entity ? { entity: params.entity } : {}), page: String(page) })}`;

  return (
    <>
      <PageHeader title={title} description="Append-only record of every important action. Entries cannot be edited or deleted (enforced by the database)." />
      <form className="mb-4 flex flex-wrap gap-2" action={basePath}>
        <Input name="action" placeholder="Action, e.g. member." defaultValue={params.action} className="w-56" />
        <Select name="entity" defaultValue={params.entity ?? ""} className="w-48">
          <option value="">All entities</option>
          {entityTypes.map((e) => <option key={e} value={e}>{e}</option>)}
        </Select>
        <Button type="submit" variant="outline">{c("filter")}</Button>
      </form>
      <Table>
        <THead><TR><TH>When</TH><TH>Actor</TH><TH>Action</TH><TH>Entity</TH><TH>Change</TH><TH>IP</TH></TR></THead>
        <TBody>
          {data.rows.length === 0 && <EmptyRow colSpan={6}>{c("noData")}</EmptyRow>}
          {data.rows.map((r) => (
            <TR key={r.id} className="align-top">
              <TD className="whitespace-nowrap text-xs">{formatDate(r.at, locale, true)}</TD>
              <TD className="text-xs"><div>{r.actorEmail ?? "system"}</div><div className="text-muted-foreground">{r.actorCompany}</div></TD>
              <TD><code className="text-xs">{r.action}</code></TD>
              <TD className="text-xs">{r.entityType}<div className="font-mono text-[10px] text-muted-foreground">{r.entityId}</div></TD>
              <TD className="max-w-md">
                {(r.before || r.after || r.meta) && (
                  <details className="text-xs">
                    <summary className="cursor-pointer text-primary">details</summary>
                    <pre className="mt-1 max-h-48 overflow-auto rounded bg-muted p-2 text-[11px]">{JSON.stringify({ before: r.before, after: r.after, meta: r.meta }, null, 2)}</pre>
                  </details>
                )}
              </TD>
              <TD className="text-xs text-muted-foreground">{r.ip ?? "—"}</TD>
            </TR>
          ))}
        </TBody>
      </Table>
      <div className="mt-4 flex items-center justify-between text-sm text-muted-foreground">
        <span>{c("pageOf", { page: data.page, count: data.pageCount })} · {data.total}</span>
        <div className="flex gap-2">
          {data.page > 1 && <Link className={buttonVariants({ variant: "outline", size: "sm" })} href={qs(data.page - 1)}>{c("previous")}</Link>}
          {data.page < data.pageCount && <Link className={buttonVariants({ variant: "outline", size: "sm" })} href={qs(data.page + 1)}>{c("next")}</Link>}
        </div>
      </div>
    </>
  );
}
