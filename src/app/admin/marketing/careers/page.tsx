import Link from "next/link";
import { Leaf } from "lucide-react";
import { can, pagePermission, pagePortal } from "@/server/rbac/guard";
import { landingSettings } from "@/server/landing/service";
import { applications, startingTexts } from "@/server/landing/careers";
import { APPLICATION_STATUS_LABEL as STATUS_LABEL } from "@/lib/landing";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AboutForm, ApplicationActions } from "@/components/landing/careers-admin";
import { languageList } from "@/components/landing/view";

export const metadata = { title: "Sustainability & Careers" };
export const dynamic = "force-dynamic";

/** FIRINGI only: the footer's sustainability and careers pages, FIRINGI's job openings and the applications received. */
export default async function Page({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.marketing.view", "admin.marketing.manage"]);
  const manage = can(ctx, "admin.marketing.manage");
  const { status } = await searchParams;
  const [s, apps] = await Promise.all([landingSettings(), applications(ctx, { status })]);
  const locales = languageList("en").sort((a, b) => (a.code === "en" ? -1 : b.code === "en" ? 1 : a.name.localeCompare(b.name)));
  const starting = await startingTexts(locales.map((l) => l.code));
  const total = Object.values(apps.counts).reduce((a, n) => a + n, 0);
  return (
    <>
      <PageHeader title="Sustainability & Careers" icon={Leaf} description="FIRINGI's own pages in the website footer: sustainability and careers (job openings and applications). For FIRINGI only — not suppliers' shops." />
      <div className="space-y-6">
        <Card>
          <CardHeader><CardTitle>Pages and job openings</CardTitle><CardDescription>Switch each page on or off (the footer link follows), write the texts per language and list FIRINGI&apos;s openings.</CardDescription></CardHeader>
          <CardContent>{manage ? <AboutForm initial={{ about: s.about, jobs: s.jobs, careersEmail: s.careersEmail }} locales={locales} starting={starting} /> : <p className="text-sm text-muted-foreground">Your role can&apos;t change these.</p>}</CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Applications</CardTitle>
            <CardDescription>Personal data (GDPR): keep them only while needed and delete them when the hiring is over. Applicants send a link to their CV or profile — no files.</CardDescription>
            <nav className="flex flex-wrap gap-2 pt-2 text-sm" data-testid="app-filter">
              <Link className={`rounded-full border px-3 py-1 ${!status ? "border-primary bg-primary/10 font-medium" : ""}`} href="/admin/marketing/careers">All <span className="text-muted-foreground">{total}</span></Link>
              {Object.entries(STATUS_LABEL).map(([k, v]) => <Link key={k} className={`rounded-full border px-3 py-1 ${status === k ? "border-primary bg-primary/10 font-medium" : ""}`} href={`/admin/marketing/careers?status=${k}`}>{v} <span className="text-muted-foreground">{apps.counts[k] ?? 0}</span></Link>)}
            </nav>
          </CardHeader>
          <CardContent>{!apps.rows.length ? <p className="text-sm text-muted-foreground">No applications.</p> : (
            <ul className="divide-y" data-testid="apps">{apps.rows.map((a) => (
              <li key={a.id} className="space-y-1 py-3 text-sm" data-testid="app-row" data-status={a.status}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="min-w-0 flex-1 basis-60 break-words font-medium">{a.name} <span className="text-xs font-normal text-muted-foreground">· {a.jobTitle || "Open application"} · {a.createdAt.toISOString().slice(0, 10)} · {a.locale}</span></span>
                  <Badge variant={a.status === "NEW" ? "warning" : a.status === "HIRED" ? "success" : "secondary"}>{STATUS_LABEL[a.status as keyof typeof STATUS_LABEL] ?? a.status}</Badge>
                  {manage && <ApplicationActions id={a.id} status={a.status} />}
                </div>
                <p className="text-xs text-muted-foreground"><a className="underline" href={`mailto:${a.email}`}>{a.email}</a>{a.phone ? ` · ${a.phone}` : ""}{a.link ? <> · <a className="underline" href={a.link} target="_blank" rel="noopener noreferrer nofollow">CV / profile</a></> : null}</p>
                {a.message && <p className="whitespace-pre-line text-sm">{a.message}</p>}
              </li>
            ))}</ul>
          )}</CardContent>
        </Card>
      </div>
    </>
  );
}
