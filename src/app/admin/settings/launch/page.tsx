import Link from "next/link";
import { CheckCircle2, CircleAlert, CircleX, Rocket } from "lucide-react";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { SECTION_LABEL, launchReadiness, launchSettings, type CheckState, type LaunchSection } from "@/server/launch/service";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { LaunchSettingsForm } from "@/components/launch/admin";

export const metadata = { title: "Launch Readiness" };
export const dynamic = "force-dynamic";

const ICON = { pass: CheckCircle2, warn: CircleAlert, fail: CircleX } as const;
const TONE = { pass: "text-[color:var(--success,#16a34a)]", warn: "text-[color:var(--warning,#d97706)]", fail: "text-destructive" } as const;
const WORD: Record<CheckState, string> = { pass: "OK", warn: "Warning", fail: "Must fix" };
const VERDICT = {
  "not-ready": { title: "Not ready to launch", text: "Fix every “Must fix” item first. Warnings can wait until after a pilot.", variant: "destructive" as const },
  pilot: { title: "Ready for a pilot", text: "Nothing blocks a launch. Fix the warnings before opening to everyone.", variant: "warning" as const },
  ready: { title: "Ready to launch", text: "Every check passes.", variant: "success" as const },
};

export default async function LaunchPage() {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.settings.view", "admin.settings.manage"]);
  const [r, settings] = await Promise.all([launchReadiness(ctx), launchSettings()]);
  const manage = ctx.permissions.has("admin.settings.manage");
  const v = VERDICT[r.verdict];
  const sections = [...new Set(r.checks.map((c) => c.section))] as LaunchSection[];
  return (
    <>
      <PageHeader title="Launch Readiness" icon={Rocket}
        description="Everything that must be true before real businesses use FIRINGI, checked live: server settings, FIRINGI's invoicing details, certified invoicing, payments, messages, backups and jobs, the marketplace itself and the legal links. Each item links to the page that fixes it."
        actions={<Link className={buttonVariants({ variant: "outline" })} href="/admin/settings/launch/pilot" data-testid="to-pilot">Pilot & invites</Link>} />
      <Card className="mb-4" data-testid="verdict">
        <CardContent className="flex flex-wrap items-center gap-4 pt-5">
          <Badge variant={v.variant} className="px-3 py-1 text-sm" data-testid="verdict-badge">{v.title}</Badge>
          <span className="text-sm text-muted-foreground">{v.text}</span>
          <span className="ml-auto flex gap-3 text-sm tabular-nums" data-testid="verdict-counts">
            <span className={TONE.fail}>{r.counts.fail} must fix</span><span className={TONE.warn}>{r.counts.warn} warnings</span><span className={TONE.pass}>{r.counts.pass} OK</span>
          </span>
        </CardContent>
      </Card>
      <div className="grid gap-4 lg:grid-cols-2" data-testid="checks">
        {sections.map((s) => {
          const list = r.checks.filter((c) => c.section === s);
          const worst = list.some((c) => c.state === "fail") ? "fail" : list.some((c) => c.state === "warn") ? "warn" : "pass";
          const SI = ICON[worst];
          return (
            <Card key={s} data-testid={`section-${s}`}>
              <CardHeader><CardTitle className="flex items-center gap-2"><SI className={`size-5 ${TONE[worst]}`} /> {SECTION_LABEL[s]}</CardTitle></CardHeader>
              <CardContent>
                <ul className="divide-y">
                  {list.map((c) => {
                    const I = ICON[c.state];
                    return (
                      <li key={c.key} className="flex gap-3 py-2.5" data-testid={`check-${c.key}`} data-state={c.state}>
                        <I className={`mt-0.5 size-4 shrink-0 ${TONE[c.state]}`} aria-label={WORD[c.state]} />
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-baseline gap-x-2"><span className="font-medium">{c.label}</span>{c.state !== "pass" && <span className={`text-xs font-medium ${TONE[c.state]}`}>{WORD[c.state]}</span>}</div>
                          <p className="break-words text-sm text-muted-foreground">{c.detail}</p>
                          {c.state !== "pass" && c.fix && <Link href={c.fix.href} className="text-xs font-medium text-primary hover:underline">Fix: {c.fix.label} →</Link>}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </CardContent>
            </Card>
          );
        })}
      </div>
      <Card className="mt-4" id="settings">
        <CardHeader><CardTitle>Launch settings</CardTitle></CardHeader>
        <CardContent><LaunchSettingsForm settings={settings} canManage={manage} /></CardContent>
      </Card>
      <p className="mt-3 text-xs text-muted-foreground">Checked {r.at.slice(0, 16).replace("T", " ")} UTC. The step-by-step launch guide is docs/launch.md in the code.</p>
    </>
  );
}
