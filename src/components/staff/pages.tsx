/**
 * Staff shifts & time (Phase 52) — the page bodies, shared by the buyer portal (customers), the supplier portal
 * (wholesalers, distributors) and FIRINGI's back office (its own staff, in English).
 */
import Link from "next/link";
import { redirect } from "next/navigation";
import { AlertTriangle, CalendarClock, Clock, Coffee, Leaf, Timer, Users } from "lucide-react";
import { pagePortal, type Portal } from "@/server/rbac/guard";
import * as S from "@/server/staff/service";
import { addDays } from "@/lib/staff-time";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { dayLabel, dayOf, fill, hoursText, money, staffLabels, timeOf } from "./labels";
import { AcceptSwap, CancelLeave, ClaimShift, ClockButtons, DecideLeave, DeleteShift, EntryForm, ExportForm, KioskPad, LeaveForm, PinForm, ProfileForm, SheetButtons, ShiftForm, SwapOffer, WeekButtons } from "./client";

type P = "buy" | "vendor" | "admin";
const portalPath = (type: string) => S.portalOf(type);

/** The context, the texts and the base path; sends wholesalers / distributors to the supplier portal. */
async function open(portal: P, sub: string) {
  const ctx = await pagePortal(portal as Portal);
  const want = portalPath(ctx.company.type);
  if (want !== `/${portal}`) redirect(`${want}/staff${sub}`);
  const english = portal === "admin";
  const { l, locale } = await staffLabels(english);
  const access = await S.staffAccess(ctx.company);
  return { ctx, l, locale, base: `${want}/staff`, access, manager: S.isManager(ctx) };
}

function Closed({ l, why, title, icon }: { l: Record<string, string>; why: string | null; title: string; icon: typeof Clock }) {
  return (<><PageHeader title={title} icon={icon} /><p className="rounded-xl border border-dashed p-6 text-center text-sm" data-testid="staff-closed">{l[`closed.${why ?? "OFF"}`] ?? l["closed.OFF"]}</p></>);
}
const flagBadges = (flags: string[], l: Record<string, string>) => flags.filter((f) => f !== "NO_SHIFT").map((f) => <Badge key={f} variant={f === "EDITED" ? "secondary" : "warning"} className="text-[10px]">{l[`flag.${f}`] ?? f}</Badge>);

// ── overview (managers) ─────────────────────────────────────────────────────

export async function StaffOverview({ portal }: { portal: P }) {
  const { ctx, l, locale, base, access, manager } = await open(portal, "");
  if (!access.on) return <Closed l={l} why={access.why} title={l.overviewTitle} icon={Users} />;
  if (!manager) redirect(`${base}/me`);
  const w = await S.whoIsIn(ctx);
  const lab = access.parts.labour ? await S.labourReport(ctx, 14).catch(() => null) : null;
  const tz = w.tz;
  return (
    <>
      <PageHeader title={l.overviewTitle} icon={Users} description={l.overviewIntro}
        actions={<><Link className={buttonVariants({ variant: "outline" })} href={`${base}/rota`}><CalendarClock className="size-4" /> {l.rotaTitle}</Link><Link className={buttonVariants({ variant: "outline" })} href={`${base}/clock`}><Clock className="size-4" /> {l.kioskTitle}</Link></>} />
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Card><CardContent className="pt-5"><p className="text-xs text-muted-foreground">{l.inNow}</p><p className="text-2xl font-semibold tabular-nums" data-testid="staff-in-count">{w.inNow.length}</p></CardContent></Card>
        <Card><CardContent className="pt-5"><p className="text-xs text-muted-foreground">{l.staffCount}</p><p className="text-2xl font-semibold tabular-nums">{w.staff}</p></CardContent></Card>
        <Card><CardContent className="pt-5"><p className="text-xs text-muted-foreground">{l.today}</p><p className="text-2xl font-semibold tabular-nums">{w.today.length}</p></CardContent></Card>
        <Card><CardContent className="pt-5 text-sm"><p className="text-xs text-muted-foreground">{l.pending}</p>
          <ul className="mt-1 space-y-0.5">
            {access.parts.leave && <li><Link className="text-primary hover:underline" href={`${base}/leave`}>{fill(l.pendingLeave, { n: w.pending.leave })}</Link></li>}
            {access.parts.swaps && <li><Link className="text-primary hover:underline" href={`${base}/leave`}>{fill(l.pendingSwaps, { n: w.pending.swaps })}</Link></li>}
            {access.parts.timesheets && <li><Link className="text-primary hover:underline" href={`${base}/timesheets`}>{fill(l.pendingSheets, { n: w.pending.timesheets })}</Link></li>}
          </ul></CardContent></Card>
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card data-testid="staff-in-now"><CardHeader><CardTitle>{l.inNow}</CardTitle></CardHeader><CardContent>
          {!w.inNow.length ? <p className="text-sm text-muted-foreground">{l.nobodyIn}</p> : <ul className="divide-y text-sm">{w.inNow.map((p, i) => (
            <li key={i} className="flex flex-wrap items-center justify-between gap-2 py-2"><span className="min-w-0 break-words font-medium">{p.name}{p.site ? <span className="text-xs font-normal text-muted-foreground"> · {p.site}</span> : null}</span>
              <span className="flex items-center gap-2 text-xs text-muted-foreground">{p.onBreak && <Badge variant="secondary"><Coffee className="size-3" /> {l.onBreak}</Badge>}{fill(l.since, { time: timeOf(p.since, locale, tz) })}</span></li>))}</ul>}
        </CardContent></Card>
        <Card data-testid="staff-today"><CardHeader><CardTitle>{l.today}</CardTitle></CardHeader><CardContent>
          {!w.today.length ? <p className="text-sm text-muted-foreground">{l.noShiftsToday}</p> : <ul className="divide-y text-sm">{w.today.map((x) => (
            <li key={x.id} className="flex flex-wrap items-center justify-between gap-2 py-2"><span className="min-w-0 break-words"><span className="font-medium">{x.name ?? l.openShift}</span> <span className="text-xs text-muted-foreground">{timeOf(x.startsAt, locale, tz)}–{timeOf(x.endsAt, locale, tz)}{x.site ? ` · ${x.site}` : ""}{x.role ? ` · ${x.role}` : ""}</span></span>
              <Badge variant={x.state === "IN" ? "success" : x.state === "MISSING" ? "destructive" : "secondary"}>{l[`state.${x.state}`]}</Badge></li>))}</ul>}
        </CardContent></Card>
        <Card className="lg:col-span-2" data-testid="staff-flagged"><CardHeader><CardTitle className="flex items-center gap-2"><AlertTriangle className="size-4" /> {l.flaggedTitle}</CardTitle></CardHeader><CardContent>
          {!w.flagged.length ? <p className="text-sm text-muted-foreground">{l.noFlags}</p> : <ul className="divide-y text-sm">{w.flagged.map((e) => (
            <li key={e.id} className="flex flex-wrap items-center gap-2 py-2"><span className="min-w-0 flex-1 break-words"><span className="font-medium">{e.name}</span> <span className="text-xs text-muted-foreground">{dayOf(e.clockIn, locale, tz)} {timeOf(e.clockIn, locale, tz)}–{e.clockOut ? timeOf(e.clockOut, locale, tz) : "…"}</span></span>
              <span className="flex flex-wrap gap-1">{flagBadges(e.flags, l)}</span></li>))}</ul>}
          {access.parts.timesheets && <Link className="mt-2 inline-block text-sm text-primary hover:underline" href={`${base}/timesheets`}>{l.timesheetsTitle} →</Link>}
        </CardContent></Card>
        {lab && (
          <Card className="lg:col-span-2" data-testid="staff-labour"><CardHeader><CardTitle className="flex items-center gap-2"><Leaf className="size-4" /> {l.labourTitle}</CardTitle>{lab.ratesMissing > 0 && <CardDescription>{fill(l.ratesMissing, { n: lab.ratesMissing })}</CardDescription>}</CardHeader><CardContent>
            <div className="mb-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
              <div><p className="text-xs text-muted-foreground">{l.hours}</p><p className="font-semibold tabular-nums">{hoursText(lab.total.minutes)}</p></div>
              <div><p className="text-xs text-muted-foreground">{l.labourCost}</p><p className="font-semibold tabular-nums">{money(lab.total.cost, locale)}</p></div>
              <div><p className="text-xs text-muted-foreground">{l.sales}</p><p className="font-semibold tabular-nums">{money(lab.total.sales, locale)}</p></div>
              <div><p className="text-xs text-muted-foreground">{l.share}</p><p className="font-semibold tabular-nums" data-testid="labour-share">{lab.total.share == null ? "—" : `${lab.total.share} %`}</p></div>
            </div>
            <div className="overflow-x-auto"><table className="w-full min-w-[28rem] text-xs"><thead><tr className="text-left text-muted-foreground"><th className="py-1 font-normal">{l.day}</th><th className="py-1 text-right font-normal">{l.hours}</th><th className="py-1 text-right font-normal">{l.labourCost}</th><th className="py-1 text-right font-normal">{l.sales}</th><th className="py-1 text-right font-normal">{l.share}</th></tr></thead>
              <tbody>{lab.rows.slice().reverse().map((r) => <tr key={r.day} className="border-t"><td className="py-1">{dayLabel(r.day, locale)}</td><td className="py-1 text-right tabular-nums">{hoursText(r.minutes)}</td><td className="py-1 text-right tabular-nums">{money(r.cost, locale)}</td><td className="py-1 text-right tabular-nums">{money(r.sales, locale)}</td><td className="py-1 text-right tabular-nums">{r.share == null ? "—" : `${r.share} %`}</td></tr>)}</tbody></table></div>
          </CardContent></Card>
        )}
      </div>
    </>
  );
}

// ── my shifts & hours (every staff member) ──────────────────────────────────

export async function MyShifts({ portal }: { portal: P }) {
  const { ctx, l, locale, access } = await open(portal, "/me");
  if (!access.on) return <Closed l={l} why={access.why} title={l.meTitle} icon={Timer} />;
  const [me, sites, ppl] = await Promise.all([S.myWeek(ctx), S.sites(ctx), S.people(ctx)]);
  const tz = me.tz, s = me.settings;
  const siteName = new Map(sites.map((x) => [x.id, x.label]));
  const colleagues = ppl.filter((p) => p.membershipId !== ctx.membership.id && p.active).map((p) => ({ id: p.membershipId, label: p.name }));
  const tone = (st: string) => (st === "APPROVED" ? "success" : st === "REJECTED" ? "destructive" : st === "CANCELLED" ? "secondary" : "warning") as "success" | "destructive" | "secondary" | "warning";
  return (
    <>
      <PageHeader title={l.meTitle} icon={Timer} description={l.meIntro} />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        {access.parts.clock && (
          <Card data-testid="my-clock"><CardHeader><CardTitle>{me.open ? fill(l.clockedInSince, { time: timeOf(me.open.clockIn, locale, tz) }) : l.notClockedIn}</CardTitle>
            {me.open?.onBreak && <CardDescription><Coffee className="inline size-3.5" /> {l.onBreak}</CardDescription>}</CardHeader>
            <CardContent>{s.clock.phone ? <ClockButtons l={l} locale={locale} open={!!me.open} onBreak={!!me.open?.onBreak} needLocation={s.clock.location} sites={sites.map((x) => ({ id: x.id, label: x.label }))} /> : <p className="text-sm text-muted-foreground">{l.phoneOff}</p>}</CardContent></Card>
        )}
        <Card data-testid="my-week"><CardHeader><CardTitle>{l.thisWeek}</CardTitle>{me.contractHours != null && <CardDescription>{fill(l.contract, { h: Number(me.contractHours) })}</CardDescription>}</CardHeader><CardContent>
          <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            <div><p className="text-xs text-muted-foreground">{l.worked}</p><p className="text-lg font-semibold tabular-nums" data-testid="my-worked">{hoursText(me.totals.minutes)}</p></div>
            <div><p className="text-xs text-muted-foreground">{l.overtime}</p><p className="text-lg font-semibold tabular-nums">{hoursText(me.totals.overtimeMinutes)}</p></div>
            <div><p className="text-xs text-muted-foreground">{l.night}</p><p className="text-lg font-semibold tabular-nums">{hoursText(me.totals.nightMinutes)}</p></div>
            <div><p className="text-xs text-muted-foreground">{l.holiday}</p><p className="text-lg font-semibold tabular-nums">{hoursText(me.totals.holidayMinutes)}</p></div>
          </div>
          {access.parts.timesheets && <div className="mt-3"><SheetButtons l={l} membershipId={ctx.membership.id} week={me.week} status="OPEN" self /></div>}
        </CardContent></Card>
        {access.parts.rota && (
          <Card data-testid="my-shifts"><CardHeader><CardTitle>{l.myShifts}</CardTitle></CardHeader><CardContent>
            {!me.shifts.length ? <p className="text-sm text-muted-foreground">{l.noShifts}</p> : <ul className="divide-y text-sm">{me.shifts.map((x) => (
              <li key={x.id} className="space-y-1 py-2"><p className="break-words"><span className="font-medium">{dayOf(x.startsAt, locale, tz)}</span> {timeOf(x.startsAt, locale, tz)}–{timeOf(x.endsAt, locale, tz)} <span className="text-xs text-muted-foreground">{[x.siteId ? siteName.get(x.siteId) : null, x.role].filter(Boolean).join(" · ")}</span></p>
                {access.parts.swaps && x.startsAt > new Date() && <SwapOffer shiftId={x.id} l={l} colleagues={colleagues} />}</li>))}</ul>}
            {me.openShifts.length > 0 && (<><h3 className="mb-1 mt-4 text-sm font-medium">{l.openShifts}</h3><ul className="divide-y text-sm" data-testid="open-shifts">{me.openShifts.map((x) => (
              <li key={x.id} className="flex flex-wrap items-center justify-between gap-2 py-2"><span>{dayOf(x.startsAt, locale, tz)} {timeOf(x.startsAt, locale, tz)}–{timeOf(x.endsAt, locale, tz)} <span className="text-xs text-muted-foreground">{x.role ?? ""}</span></span><ClaimShift id={x.id} l={l} /></li>))}</ul></>)}
          </CardContent></Card>
        )}
        {access.parts.swaps && me.swaps.length > 0 && (
          <Card data-testid="my-swaps"><CardHeader><CardTitle>{l.swaps}</CardTitle></CardHeader><CardContent><ul className="divide-y text-sm">{me.swaps.map((w) => (
            <li key={w.id} className="flex flex-wrap items-center justify-between gap-2 py-2"><span>{dayOf(w.startsAt, locale, tz)} {timeOf(w.startsAt, locale, tz)}–{timeOf(w.endsAt, locale, tz)}{w.note ? <span className="text-xs text-muted-foreground"> · {w.note}</span> : null}</span>
              {w.forMe && w.status === "PENDING" ? <AcceptSwap id={w.id} l={l} /> : <Badge variant={tone(w.status)}>{l[`status.${w.status}`]}</Badge>}</li>))}</ul></CardContent></Card>
        )}
        <Card data-testid="my-recent"><CardHeader><CardTitle>{l.recent}</CardTitle></CardHeader><CardContent>
          {!me.entries.length ? <p className="text-sm text-muted-foreground">{l.noEntries}</p> : <ul className="divide-y text-sm">{me.entries.slice(0, 14).map((e) => (
            <li key={e.id} className="flex flex-wrap items-center gap-2 py-1.5"><span className="min-w-0 flex-1">{dayOf(e.clockIn, locale, tz)} {timeOf(e.clockIn, locale, tz)}–{e.clockOut ? timeOf(e.clockOut, locale, tz) : "…"}{e.breakMinutes ? <span className="text-xs text-muted-foreground"> · {fill(l.breakShort, { m: e.breakMinutes })}</span> : null}</span><span className="flex flex-wrap gap-1">{flagBadges(e.flags, l)}</span></li>))}</ul>}
        </CardContent></Card>
        {access.parts.leave && (
          <Card className="lg:col-span-2" data-testid="my-leave"><CardHeader><CardTitle>{l.leaveTitle}</CardTitle></CardHeader><CardContent className="space-y-4">
            <LeaveForm l={l} />
            {me.leave.length > 0 && <ul className="divide-y text-sm">{me.leave.map((x) => (
              <li key={x.id} className="flex flex-wrap items-center gap-2 py-2"><span className="min-w-0 flex-1">{l[`leave.${x.kind}`]} · {dayLabel(x.startsOn, locale)}{x.endsOn !== x.startsOn ? ` – ${dayLabel(x.endsOn, locale)}` : ""}{x.halfDay ? ` · ${l.halfDay}` : ""}{x.decisionNote ? <span className="text-xs text-muted-foreground"> · {x.decisionNote}</span> : null}</span>
                <Badge variant={tone(x.status)}>{l[`status.${x.status}`]}</Badge>{(x.status === "PENDING" || x.status === "APPROVED") && <CancelLeave id={x.id} l={l} />}</li>))}</ul>}
          </CardContent></Card>
        )}
        {access.parts.clock && (
          <Card className="lg:col-span-2"><CardHeader><CardTitle>{l.pinTitle}</CardTitle><CardDescription>{me.hasPin ? l.pinHint : l.pinMissing}</CardDescription></CardHeader><CardContent><PinForm membershipId={ctx.membership.id} l={l} compact /></CardContent></Card>
        )}
      </div>
    </>
  );
}

// ── rota ────────────────────────────────────────────────────────────────────

export async function RotaView({ portal, week }: { portal: P; week?: string }) {
  const { ctx, l, locale, base, access } = await open(portal, "/rota");
  if (!access.on || !access.parts.rota) return <Closed l={l} why={access.on ? "PART_OFF" : access.why} title={l.rotaTitle} icon={CalendarClock} />;
  const [r, sites] = await Promise.all([S.weekRota(ctx, week ?? null), S.sites(ctx)]);
  const tz = r.tz, dayLabels = r.days.map((d) => dayLabel(d, locale));
  const siteName = new Map(sites.map((x) => [x.id, x.label]));
  const rows = [...r.people.map((p) => ({ id: p.membershipId as string | null, name: p.name, sub: p.role, planned: p.plannedMinutes, contract: p.contractHours })), { id: null, name: l.openShift, sub: null, planned: 0, contract: null }];
  const cell = (mid: string | null, day: string) => r.shifts.filter((x) => x.membershipId === mid && x.day === day);
  const onLeave = (mid: string | null, day: string) => !!mid && r.leave.some((v) => v.membershipId === mid && v.startsOn <= day && v.endsOn >= day);
  return (
    <>
      <PageHeader title={l.rotaTitle} icon={CalendarClock} description={r.manager ? l.rotaIntro : l.rotaIntroStaff} />
      <div className="mb-4 flex flex-wrap items-center gap-2 text-sm">
        <Link className={buttonVariants({ variant: "outline", size: "sm" })} href={`${base}/rota?week=${addDays(r.week, -7)}`}>{l.prevWeek}</Link>
        <span className="font-medium" data-testid="rota-week">{dayLabels[0]} – {dayLabels[6]}</span>
        <Link className={buttonVariants({ variant: "outline", size: "sm" })} href={`${base}/rota?week=${addDays(r.week, 7)}`}>{l.nextWeek}</Link>
        <Link className={buttonVariants({ variant: "ghost", size: "sm" })} href={`${base}/rota`}>{l.thisWeekBtn}</Link>
        {r.manager && r.plannedCost != null && r.plannedCost > 0 && <span className="ml-auto text-xs text-muted-foreground">{fill(l.plannedCost, { cost: money(r.plannedCost, locale) })}</span>}
      </div>
      {r.manager && (
        <Card className="mb-4"><CardContent className="space-y-3 pt-5">
          <WeekButtons l={l} week={r.week} prevWeek={addDays(r.week, -7)} drafts={r.drafts} />
          {r.people.length ? <ShiftForm l={l} days={r.days} dayLabels={dayLabels} people={r.people.map((p) => ({ id: p.membershipId, label: p.name }))} sites={sites.map((x) => ({ id: x.id, label: x.label }))} /> : <p className="text-sm text-muted-foreground">{l.noStaff}</p>}
        </CardContent></Card>
      )}
      <Card><CardContent className="overflow-x-auto pt-5">
        <table className="w-full min-w-[56rem] border-separate border-spacing-1 text-xs" data-testid="rota-grid">
          <thead><tr><th className="w-40 text-left font-medium text-muted-foreground">{l.person}</th>{dayLabels.map((d, i) => <th key={i} className="text-left font-medium text-muted-foreground">{d}</th>)}</tr></thead>
          <tbody>{rows.map((p) => (
            <tr key={p.id ?? "open"} className="align-top">
              <td className="rounded-lg bg-muted/40 p-2"><p className="break-words font-medium">{p.name}</p>{p.sub && <p className="text-muted-foreground">{p.sub}</p>}{p.id && <p className="text-muted-foreground">{fill(l.planned, { h: hoursText(p.planned) })}{p.contract != null ? ` ${fill(l.contractOf, { h: p.contract })}` : ""}</p>}</td>
              {r.days.map((d) => (
                <td key={d} className={`min-w-[7rem] rounded-lg border p-1 ${onLeave(p.id, d) ? "bg-[repeating-linear-gradient(45deg,transparent,transparent_6px,color-mix(in_oklch,var(--muted-foreground)_12%,transparent)_6px,color-mix(in_oklch,var(--muted-foreground)_12%,transparent)_12px)]" : ""}`}>
                  {onLeave(p.id, d) && <p className="px-1 text-[10px] text-muted-foreground">{l.onLeave}</p>}
                  {cell(p.id, d).map((x) => (
                    <div key={x.id} className={`mb-1 rounded-md px-1.5 py-1 ${x.status === "DRAFT" ? "border border-dashed" : "bg-[color-mix(in_oklch,var(--vivid-teal)_14%,transparent)]"}`} data-testid="rota-shift">
                      <p className="flex items-center justify-between gap-1 font-medium tabular-nums">{timeOf(x.startsAt, locale, tz)}–{timeOf(x.endsAt, locale, tz)}{r.manager && <DeleteShift id={x.id} l={l} />}</p>
                      <p className="text-muted-foreground">{[x.role, x.siteId ? siteName.get(x.siteId) : null, x.status === "DRAFT" ? l.draft : null].filter(Boolean).join(" · ")}</p>
                      {x.warnings.length > 0 && <p className="mt-0.5 flex flex-wrap gap-0.5" data-testid="rota-warning">{x.warnings.map((w) => <Badge key={w} variant="warning" className="px-1 text-[9px]">{l[`warn.${w}`] ?? w}</Badge>)}</p>}
                      {!r.manager && !x.membershipId && x.status === "PUBLISHED" && r.settings.self.claimOpenShifts && <ClaimShift id={x.id} l={l} />}
                    </div>
                  ))}
                </td>
              ))}
            </tr>
          ))}</tbody>
        </table>
      </CardContent></Card>
    </>
  );
}

// ── kiosk ───────────────────────────────────────────────────────────────────

export async function KioskView({ portal }: { portal: P }) {
  const { ctx, l, locale, access, manager } = await open(portal, "/clock");
  if (!access.on || !access.parts.clock) return <Closed l={l} why={access.on ? "PART_OFF" : access.why} title={l.kioskTitle} icon={Clock} />;
  if (!access.settings.clock.kiosk) return <Closed l={l} why="KIOSK_OFF" title={l.kioskTitle} icon={Clock} />;
  const ok = manager || ["company.staff.kiosk", "company.pos.sell", "company.pos.manage", "admin.staff.manage"].some((p) => ctx.permissions.has(p as never));
  if (!ok) redirect(`${S.portalOf(ctx.company.type)}/staff/me`);
  const sites = await S.sites(ctx);
  return (
    <>
      <PageHeader title={l.kioskTitle} icon={Clock} description={l.kioskIntro} />
      <Card><CardContent className="py-8"><KioskPad l={l} locale={locale} sites={sites.map((x) => ({ id: x.id, label: x.label }))} /></CardContent></Card>
    </>
  );
}

// ── timesheets (managers) ───────────────────────────────────────────────────

export async function TimesheetsView({ portal, week }: { portal: P; week?: string }) {
  const { ctx, l, locale, base, access, manager } = await open(portal, "/timesheets");
  if (!access.on || !access.parts.timesheets) return <Closed l={l} why={access.on ? "PART_OFF" : access.why} title={l.timesheetsTitle} icon={Timer} />;
  if (!manager) redirect(`${base}/me`);
  const [t, sites] = await Promise.all([S.timesheetWeek(ctx, week ?? null), S.sites(ctx)]);
  const tz = t.tz, siteOpts = sites.map((x) => ({ id: x.id, label: x.label }));
  const dayLabels = t.days.map((d) => dayLabel(d, locale));
  const local = (d: Date) => new Intl.DateTimeFormat("sv-SE", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
  const tone = (st: string) => (st === "APPROVED" ? "success" : st === "SUBMITTED" ? "warning" : "secondary") as "success" | "warning" | "secondary";
  const exportBase = "/api/staff/export";
  return (
    <>
      <PageHeader title={l.timesheetsTitle} icon={Timer} description={l.timesheetsIntro} />
      <div className="mb-4 flex flex-wrap items-center gap-2 text-sm">
        <Link className={buttonVariants({ variant: "outline", size: "sm" })} href={`${base}/timesheets?week=${addDays(t.week, -7)}`}>{l.prevWeek}</Link>
        <span className="font-medium" data-testid="sheet-week">{dayLabels[0]} – {dayLabels[6]}</span>
        <Link className={buttonVariants({ variant: "outline", size: "sm" })} href={`${base}/timesheets?week=${addDays(t.week, 7)}`}>{l.nextWeek}</Link>
        <Link className={buttonVariants({ variant: "ghost", size: "sm" })} href={`${base}/timesheets`}>{l.thisWeekBtn}</Link>
      </div>
      <div className="space-y-3" data-testid="sheets">
        {t.rows.map((r) => (
          <Card key={r.membershipId} data-testid="sheet-row"><CardContent className="space-y-2 pt-5 text-sm">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <span className="min-w-0 flex-1 basis-full break-words font-medium sm:basis-auto">{r.name}{r.role ? <span className="text-xs font-normal text-muted-foreground"> · {r.role}</span> : null}</span>
              <span className="tabular-nums" data-testid="sheet-hours">{l.worked}: <b>{hoursText(r.minutes)}</b></span>
              <span className="tabular-nums">{l.overtime}: {hoursText(r.overtimeMinutes)}</span>
              <span className="tabular-nums">{l.night}: {hoursText(r.nightMinutes)}</span>
              <span className="tabular-nums">{l.holiday}: {hoursText(r.holidayMinutes)}</span>
              {r.leaveDays > 0 && <span className="tabular-nums">{l.leaveDays}: {r.leaveDays}</span>}
              {r.cost != null && <span className="tabular-nums">{l.cost}: {money(r.cost, locale)}</span>}
              <Badge variant={tone(r.status)} data-testid="sheet-status">{l[`status.${r.status}`]}</Badge>
              <SheetButtons l={l} membershipId={r.membershipId} week={t.week} status={r.status} />
            </div>
            {r.flags.length > 0 && <div className="flex flex-wrap gap-1">{flagBadges(r.flags, l)}</div>}
            <ul className="divide-y rounded-lg border text-xs">
              {r.entries.map((e) => (
                <li key={e.id} className="flex flex-wrap items-center gap-2 px-2 py-1.5">
                  <span className="min-w-0 flex-1">{dayOf(e.clockIn, locale, tz)} {timeOf(e.clockIn, locale, tz)}–{e.clockOut ? timeOf(e.clockOut, locale, tz) : l.stillIn}{e.breakMinutes ? ` · ${fill(l.breakShort, { m: e.breakMinutes })}` : ""}{e.editReason ? <span className="text-muted-foreground"> · {e.editReason}</span> : null}</span>
                  <span className="flex flex-wrap gap-1">{flagBadges(e.flags, l)}</span>
                  {r.status !== "APPROVED" && <EntryForm l={l} membershipId={r.membershipId} sites={siteOpts} defaultDay={local(e.clockIn)} initial={{ id: e.id, day: local(e.clockIn), in: timeOf(e.clockIn, "en-GB", tz), out: e.clockOut ? timeOf(e.clockOut, "en-GB", tz) : null, breakMinutes: e.breakMinutes, siteId: e.siteId }} />}
                </li>
              ))}
              {!r.entries.length && <li className="px-2 py-1.5 text-muted-foreground">{l.noEntries}</li>}
            </ul>
            {r.status !== "APPROVED" && <EntryForm l={l} membershipId={r.membershipId} sites={siteOpts} defaultDay={t.week} />}
          </CardContent></Card>
        ))}
      </div>
      <Card className="mt-6"><CardHeader><CardTitle>{l.export}</CardTitle><CardDescription>{fill(l.exportHint, { years: access.settings.keepYears })}</CardDescription></CardHeader><CardContent><ExportForm l={l} base={exportBase} from={t.week} to={addDays(t.week, 6)} /></CardContent></Card>
    </>
  );
}

// ── leave & swaps (managers) ────────────────────────────────────────────────

export async function LeaveView({ portal }: { portal: P }) {
  const { ctx, l, locale, base, access, manager } = await open(portal, "/leave");
  if (!access.on || (!access.parts.leave && !access.parts.swaps)) return <Closed l={l} why={access.on ? "PART_OFF" : access.why} title={l.leavePageTitle} icon={CalendarClock} />;
  if (!manager) redirect(`${base}/me`);
  const tz = (await S.whoIsIn(ctx)).tz;
  const [leave, swaps] = await Promise.all([access.parts.leave ? S.leaveList(ctx) : [], access.parts.swaps ? S.swapList(ctx) : []]);
  const tone = (st: string) => (st === "APPROVED" ? "success" : st === "REJECTED" ? "destructive" : st === "CANCELLED" ? "secondary" : "warning") as "success" | "destructive" | "secondary" | "warning";
  return (
    <>
      <PageHeader title={l.leavePageTitle} icon={CalendarClock} description={l.leavePageIntro} />
      <div className="grid gap-6 lg:grid-cols-2">
        {access.parts.leave && (
          <Card data-testid="leave-list"><CardHeader><CardTitle>{l.leaveTitle}</CardTitle></CardHeader><CardContent>
            {!leave.length ? <p className="text-sm text-muted-foreground">{l.noRequests}</p> : <ul className="divide-y text-sm">{leave.map((x) => (
              <li key={x.id} className="space-y-1.5 py-2" data-testid="leave-row"><p className="flex flex-wrap items-center gap-2"><span className="min-w-0 flex-1 break-words"><span className="font-medium">{x.name}</span> · {l[`leave.${x.kind}`]} · {dayLabel(x.startsOn, locale)}{x.endsOn !== x.startsOn ? ` – ${dayLabel(x.endsOn, locale)}` : ""} <span className="text-xs text-muted-foreground">({fill(l.days, { n: x.days })})</span></span><Badge variant={tone(x.status)}>{l[`status.${x.status}`]}</Badge></p>
                {x.reason && <p className="text-xs text-muted-foreground">{x.reason}</p>}
                {x.status === "PENDING" && <DecideLeave id={x.id} l={l} />}</li>))}</ul>}
          </CardContent></Card>
        )}
        {access.parts.swaps && (
          <Card data-testid="swap-list"><CardHeader><CardTitle>{l.swaps}</CardTitle></CardHeader><CardContent>
            {!swaps.length ? <p className="text-sm text-muted-foreground">{l.noRequests}</p> : <ul className="divide-y text-sm">{swaps.map((w) => (
              <li key={w.id} className="space-y-1.5 py-2" data-testid="swap-row"><p className="flex flex-wrap items-center gap-2"><span className="min-w-0 flex-1 break-words"><span className="font-medium">{w.from}</span> → {w.to ?? l.anyone} · {dayOf(w.startsAt, locale, tz)} {timeOf(w.startsAt, locale, tz)}–{timeOf(w.endsAt, locale, tz)}</span><Badge variant={tone(w.status)}>{l[`status.${w.status}`]}</Badge></p>
                {w.note && <p className="text-xs text-muted-foreground">{w.note}</p>}
                {(w.status === "ACCEPTED" || (w.status === "PENDING" && w.to)) && <DecideLeave id={w.id} l={l} swap />}</li>))}</ul>}
          </CardContent></Card>
        )}
      </div>
    </>
  );
}

// ── people (managers) ───────────────────────────────────────────────────────

export async function PeopleView({ portal }: { portal: P }) {
  const { ctx, l, base, access, manager } = await open(portal, "/people");
  if (!access.on) return <Closed l={l} why={access.why} title={l.peopleTitle} icon={Users} />;
  if (!manager) redirect(`${base}/me`);
  const [ppl, sites] = await Promise.all([S.people(ctx), S.sites(ctx)]);
  const siteOpts = sites.map((x) => ({ id: x.id, label: x.label }));
  const teamHref = portal === "admin" ? "/admin/users/all" : `/${portal}/company/users`;
  return (
    <>
      <PageHeader title={l.peopleTitle} icon={Users} description={l.peopleIntro} actions={<Link className={buttonVariants({ variant: "outline" })} href={teamHref}>{l.teamLink}</Link>} />
      <div className="space-y-3" data-testid="people">
        {ppl.map((p) => (
          <Card key={p.membershipId} data-testid="person"><CardContent className="space-y-3 pt-5">
            <div className="flex flex-wrap items-center gap-2"><span className="min-w-0 flex-1 break-words font-medium">{p.name} {p.email && <span className="text-xs font-normal text-muted-foreground">{p.email}</span>}</span>
              <Badge variant={p.hasPin ? "success" : "secondary"}>{p.hasPin ? l.hasPin : l.noPin}</Badge>{!p.active && <Badge variant="secondary">{l.inactive}</Badge>}{p.inSince && <Badge variant="success">{l.inNow}</Badge>}</div>
            <ProfileForm l={l} sites={siteOpts} p={p} />
            {access.parts.clock && <PinForm membershipId={p.membershipId} l={l} compact />}
          </CardContent></Card>
        ))}
      </div>
    </>
  );
}
