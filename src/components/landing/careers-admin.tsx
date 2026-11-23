"use client";
/** FIRINGI's footer pages (English): sustainability and careers on/off and texts per language, job openings, applications. */
import { useState } from "react";
import { Check, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";
import { Msg, Spin, useRun } from "@/components/shared/run";
import { deleteApplicationAction, saveAboutSettingsAction, setApplicationStatusAction } from "@/server/actions/landing";
import { ABOUT_PAGES, APPLICATION_STATUSES, APPLICATION_STATUS_LABEL as STATUS_LABEL, JOB_TYPES, jobId, type AboutPage, type Job, type LandingSettings } from "@/lib/landing";

const TA = "w-full rounded-lg border border-input bg-card/80 px-3 py-2 text-sm";
const PAGE: Record<AboutPage, string> = { sustainability: "Sustainability (/sustainability)", careers: "Careers (/careers)" };
const TYPE: Record<string, string> = { FULL_TIME: "Full-time", PART_TIME: "Part-time", INTERNSHIP: "Internship", TEMPORARY: "Temporary", FREELANCE: "Freelance" };

export function AboutForm({ initial, locales, starting }: { initial: Pick<LandingSettings, "about" | "jobs" | "careersEmail">; locales: { code: string; name: string }[]; starting: Record<AboutPage, Record<string, string>> }) {
  const { pending, error, done, run } = useRun();
  const [about, setAbout] = useState(initial.about);
  const [jobs, setJobs] = useState<Job[]>(initial.jobs);
  const [email, setEmail] = useState(initial.careersEmail);
  const [page, setPage] = useState<AboutPage>("sustainability");
  const [lang, setLang] = useState("en");
  const cur = about[page].text[lang] ?? "";
  const start = starting[page][lang] ?? starting[page].en ?? "";
  const setJob = (i: number, p: Partial<Job>) => setJobs(jobs.map((j, k) => (k === i ? { ...j, ...p } : j)));
  return (
    <div className="space-y-8" data-testid="about-form">
      <section className="space-y-2">
        <h3 className="text-sm font-semibold">Shown in the footer</h3>
        {ABOUT_PAGES.map((p) => (
          <label key={p} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={about[p].on} onChange={(e) => setAbout({ ...about, [p]: { ...about[p], on: e.target.checked } })} data-testid={`about-on-${p}`} /> {PAGE[p]}
            <a href={`/${p}`} target="_blank" rel="noopener" className="text-xs text-primary hover:underline">Open →</a></label>
        ))}
        <p className="text-xs text-muted-foreground">For FIRINGI only: these pages are linked from FIRINGI&apos;s website footer, not from suppliers&apos; shops.</p>
      </section>
      <section className="space-y-3">
        <h3 className="text-sm font-semibold">Page texts</h3>
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-64"><Label className="text-xs">Page</Label><Select value={page} onChange={(e) => setPage(e.target.value as AboutPage)} data-testid="about-page">{ABOUT_PAGES.map((p) => <option key={p} value={p}>{PAGE[p]}</option>)}</Select></div>
          <div className="w-56"><Label className="text-xs">Language</Label><Select value={lang} onChange={(e) => setLang(e.target.value)} data-testid="about-lang">{locales.map((l) => <option key={l.code} value={l.code}>{l.name} ({l.code})</option>)}</Select></div>
        </div>
        <p className="text-xs text-muted-foreground">{cur ? "FIRINGI's own text." : "Empty: visitors see the starting text below in their language. Copy it in to change it."}</p>
        <textarea className={TA} rows={12} value={cur} placeholder={start} onChange={(e) => setAbout({ ...about, [page]: { ...about[page], text: { ...about[page].text, [lang]: e.target.value } } })} data-testid="about-text" />
        {!cur && <Button type="button" variant="outline" size="sm" onClick={() => setAbout({ ...about, [page]: { ...about[page], text: { ...about[page].text, [lang]: start } } })}>Copy the starting text in</Button>}
      </section>
      <section className="space-y-3">
        <h3 className="text-sm font-semibold">Job openings at FIRINGI</h3>
        {!jobs.length && <p className="text-sm text-muted-foreground">No openings — the careers page asks for open applications.</p>}
        {jobs.map((j, i) => (
          <div key={j.id} className="space-y-2 rounded-lg border p-3" data-testid="job-row">
            <div className="grid gap-2 sm:grid-cols-6">
              <div className="space-y-1 sm:col-span-3"><Label className="text-xs">Title</Label><Input value={j.title} maxLength={120} onChange={(e) => setJob(i, { title: e.target.value })} data-testid="job-title" /></div>
              <div className="space-y-1 sm:col-span-2"><Label className="text-xs">Location</Label><Input value={j.location} maxLength={120} placeholder="e.g. Lisbon / remote" onChange={(e) => setJob(i, { location: e.target.value })} data-testid="job-location" /></div>
              <div className="space-y-1"><Label className="text-xs">Type</Label><Select value={j.type} onChange={(e) => setJob(i, { type: e.target.value as Job["type"] })}>{JOB_TYPES.map((t) => <option key={t} value={t}>{TYPE[t]}</option>)}</Select></div>
            </div>
            <textarea className={TA} rows={5} value={j.text} maxLength={8000} placeholder="What the job is, what we look for, what we offer" onChange={(e) => setJob(i, { text: e.target.value })} data-testid="job-text" />
            <div className="flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={j.on} onChange={(e) => setJob(i, { on: e.target.checked })} /> Shown on the careers page</label>
              <Button type="button" size="sm" variant="ghost" onClick={() => setJobs(jobs.filter((_, k) => k !== i))}><Trash2 className="size-4" /> Remove</Button>
            </div>
          </div>
        ))}
        <Button type="button" size="sm" variant="outline" onClick={() => setJobs([...jobs, { id: jobId("new opening", jobs.map((x) => x.id)), title: "", location: "", type: "FULL_TIME", text: "", on: true }])} data-testid="job-add"><Plus className="size-4" /> Add an opening</Button>
        <div className="max-w-md space-y-1"><Label className="text-xs" htmlFor="careers-email">Also e-mail applications to (optional)</Label><Input id="careers-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="jobs@…" data-testid="careers-email" /></div>
      </section>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" disabled={pending} data-testid="about-save" onClick={() => run(() => saveAboutSettingsAction({
          about: Object.fromEntries(ABOUT_PAGES.map((p) => [p, { on: about[p].on, text: Object.fromEntries(Object.entries(about[p].text).filter(([, v]) => v.trim())) }])) as never,
          jobs: jobs.map((j) => ({ ...j, id: j.id.startsWith("new-opening") && j.title.trim() ? jobId(j.title, jobs.filter((x) => x !== j).map((x) => x.id)) : j.id })), careersEmail: email,
        }), undefined, "Saved.")}><Spin on={pending} icon={Check} /> Save</Button>
        <Msg error={error} done={done} />
      </div>
    </div>
  );
}

export function ApplicationActions({ id, status }: { id: string; status: string }) {
  const { pending, error, run } = useRun();
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <Select aria-label="Status" className="h-8 w-32" value={status} disabled={pending} onChange={(e) => run(() => setApplicationStatusAction({ id, status: e.target.value as never }))} data-testid="app-status">
        {APPLICATION_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
      </Select>
      <Button size="sm" variant="ghost" disabled={pending} title="Delete for good (GDPR)" onClick={() => { if (window.confirm("Delete this application for good?")) run(() => deleteApplicationAction({ id })); }} data-testid="app-delete"><Trash2 className="size-4" aria-hidden /></Button>
      <Msg error={error} />
    </span>
  );
}
