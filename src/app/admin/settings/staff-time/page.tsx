import Link from "next/link";
import { CalendarClock } from "lucide-react";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { adminOverview, companySwitches, holidayList, staffSettings } from "@/server/staff/service";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FindStaffBusiness, HolidayEditor, StaffSettingsForm, StaffSwitch } from "@/components/staff/admin";

export const metadata = { title: "Staff & Time Settings" };
export const dynamic = "force-dynamic";

export default async function Page({ searchParams }: { searchParams: Promise<{ country?: string; year?: string }> }) {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.settings.manage", "admin.users.manage"]);
  const sp = await searchParams;
  const year = Math.min(2100, Math.max(2020, Number(sp.year) || new Date().getUTCFullYear()));
  const [s, sw, o, h] = await Promise.all([staffSettings(), companySwitches(ctx), adminOverview(ctx), holidayList(ctx, sp.country ?? null, year)]);
  return (
    <>
      <PageHeader title="Staff & Time" icon={CalendarClock} description="Shifts, clocking in and out, timesheets, payroll export, leave and swaps for customers', suppliers' and FIRINGI's own staff. Switch every part on or off, per type and per business; set the working-time rules and public holidays." />
      <Link href="/admin/staff" className="mb-3 inline-block text-sm text-primary hover:underline">FIRINGI&apos;s own staff →</Link>
      <div className="mb-6 grid grid-cols-3 gap-3">
        <Card><CardContent className="pt-5"><p className="text-xs text-muted-foreground">Staff profiles</p><p className="text-xl font-semibold tabular-nums">{o.profiles}</p></CardContent></Card>
        <Card><CardContent className="pt-5"><p className="text-xs text-muted-foreground">Clock entries (7 days)</p><p className="text-xl font-semibold tabular-nums">{o.entries}</p></CardContent></Card>
        <Card><CardContent className="pt-5"><p className="text-xs text-muted-foreground">Clocked in now</p><p className="text-xl font-semibold tabular-nums">{o.inNow}</p></CardContent></Card>
      </div>
      <Card className="mb-6"><CardContent className="pt-6"><StaffSettingsForm initial={s} /></CardContent></Card>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Businesses</CardTitle><CardDescription>Default follows &quot;who uses it&quot; above; switch one business on or off on its own.</CardDescription></CardHeader>
          <CardContent className="space-y-4">
            {sw.length > 0 && <ul className="divide-y" data-testid="staff-switches">{sw.map((x) => <li key={x.companyId} className="flex flex-wrap items-center gap-2 py-2 text-sm"><span className="min-w-0 flex-1 break-words">{x.name} <span className="text-xs text-muted-foreground">· {x.type.toLowerCase()}</span></span><StaffSwitch companyId={x.companyId} state={x.state} /></li>)}</ul>}
            <FindStaffBusiness />
            {o.companies.length > 0 && (<><h3 className="pt-2 text-sm font-semibold">Most active this week</h3><ul className="divide-y text-sm">{o.companies.map((c) => <li key={c.id} className="flex justify-between gap-2 py-1.5"><span className="min-w-0 break-words">{c.name} <span className="text-xs text-muted-foreground">· {String(c.type).toLowerCase()}</span></span><span className="tabular-nums">{c.entries}</span></li>)}</ul></>)}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Public holidays</CardTitle><CardDescription>Hours worked on these days count as public-holiday hours; leave skips them.</CardDescription></CardHeader>
          <CardContent><HolidayEditor countries={h.countries} countryId={h.countryId} year={year} rows={h.rows} /></CardContent>
        </Card>
      </div>
    </>
  );
}
