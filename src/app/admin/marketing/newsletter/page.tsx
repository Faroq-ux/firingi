import Link from "next/link";
import { Mail } from "lucide-react";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { newsletterSubscribers } from "@/server/landing/service";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { DeleteSubscriber } from "@/components/landing/admin";

export const metadata = { title: "Newsletter" };
export const dynamic = "force-dynamic";

const STATUSES = ["ALL", "CONFIRMED", "PENDING", "UNSUBSCRIBED"] as const;

/** Phase 56: sign-ups from the landing page (double opt-in). Only confirmed addresses are exported. */
export default async function Page({ searchParams }: { searchParams: Promise<{ status?: string; q?: string }> }) {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.marketing.view", "admin.marketing.manage"]);
  const sp = await searchParams;
  const status = STATUSES.includes(sp.status as (typeof STATUSES)[number]) ? sp.status! : "ALL";
  const { rows, counts } = await newsletterSubscribers(ctx, { status, q: sp.q });
  const total = (counts.CONFIRMED ?? 0) + (counts.PENDING ?? 0) + (counts.UNSUBSCRIBED ?? 0);
  const d = (x: Date | null) => (x ? x.toISOString().slice(0, 10) : "—");
  return (
    <>
      <PageHeader title="Newsletter" icon={Mail} description="People who signed up on the landing page. They confirm by e-mail first (double opt-in) and can leave with the link in every e-mail."
        actions={<span className="flex flex-wrap gap-3 text-sm"><a href="/api/admin/newsletter-export" className="text-primary hover:underline" data-testid="news-export">Export confirmed (CSV)</a><Link href="/admin/marketing/landing" className="text-primary hover:underline">Landing Page →</Link></span>} />
      <div className="mb-4 flex flex-wrap gap-2" data-testid="news-counts">
        {STATUSES.map((s) => (
          <Link key={s} href={`/admin/marketing/newsletter?status=${s}`} className={`rounded-full border px-3 py-1 text-sm ${status === s ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted"}`}>
            {s === "ALL" ? "All" : s.charAt(0) + s.slice(1).toLowerCase()} · {s === "ALL" ? total : counts[s] ?? 0}
          </Link>
        ))}
        <form className="ml-auto"><input type="hidden" name="status" value={status} /><input name="q" defaultValue={sp.q ?? ""} placeholder="Find an e-mail" className="h-9 rounded-lg border bg-card px-3 text-sm" /></form>
      </div>
      <Card>
        <CardContent className="pt-6">
          {rows.length === 0 ? <p className="text-sm text-muted-foreground">No sign-ups yet.</p> : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm" data-testid="news-table">
                <thead><tr className="border-b text-left text-xs text-muted-foreground"><th className="py-2 pr-3 font-medium">E-mail</th><th className="py-2 pr-3 font-medium">Status</th><th className="py-2 pr-3 font-medium">Language</th><th className="py-2 pr-3 font-medium">Country</th><th className="py-2 pr-3 font-medium">Signed up</th><th className="py-2 pr-3 font-medium">Confirmed</th><th /></tr></thead>
                <tbody>{rows.map((r) => (
                  <tr key={r.id} className="border-b last:border-0">
                    <td className="break-all py-2 pr-3">{r.email}</td>
                    <td className="py-2 pr-3">{r.status.charAt(0) + r.status.slice(1).toLowerCase()}</td>
                    <td className="py-2 pr-3">{r.locale}</td><td className="py-2 pr-3">{r.countryCode ?? "—"}</td>
                    <td className="whitespace-nowrap py-2 pr-3">{d(r.createdAt)}</td><td className="whitespace-nowrap py-2 pr-3">{d(r.confirmedAt)}</td>
                    <td className="py-2 text-right"><DeleteSubscriber id={r.id} /></td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </>
  );
}
