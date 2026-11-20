"use client";
/** Product reviews & questions (Phase 53) — the interactive parts. Texts come in as `l`. */
import { useEffect, useState } from "react";
import { Check, Flag, ImagePlus, MessageSquarePlus, Send, Sparkles, Star, ThumbsUp, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label, Select } from "@/components/ui/input";
import { Msg, Spin, useRun } from "@/components/shared/run";
import {
  answerQuestionAction, askQuestionAction, deleteOwnPostAction, deleteReviewAction, moderateAction, replyToReviewAction, reportContentAction, reviewSummaryAction,
  saveReviewAction, voteHelpfulAction,
} from "@/server/actions/reviews";
import { DETAILS, REPORT_REASONS } from "@/lib/reviews";

type L = Record<string, string>;
const fill = (s: string | undefined, v: Record<string, string | number> = {}) => (s ?? "").replace(/\{(\w+)\}/g, (_, k: string) => String(v[k] ?? `{${k}}`));
const area = "min-h-24 w-full rounded-md border border-input bg-background px-3 py-2 text-sm";

/** Tap a star (1–5). Keyboard: arrows. */
export function StarPicker({ value, onChange, size = 28, label, testid }: { value: number | null; onChange: (n: number) => void; size?: number; label: string; testid?: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex gap-1" data-testid={testid}>
      {[1, 2, 3, 4, 5].map((n) => (
        <button key={n} type="button" role="radio" aria-checked={value === n} aria-label={`${n}`} onClick={() => onChange(n)}
          onKeyDown={(e) => { if (e.key === "ArrowRight" || e.key === "ArrowUp") onChange(Math.min(5, (value ?? 0) + 1)); if (e.key === "ArrowLeft" || e.key === "ArrowDown") onChange(Math.max(1, (value ?? 2) - 1)); }}
          className="rounded p-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" data-testid={testid ? `${testid}-${n}` : undefined}>
          <Star style={{ width: size, height: size }} className={value && n <= value ? "fill-amber-400 text-amber-500 dark:fill-amber-300 dark:text-amber-300" : "text-muted-foreground/50"} />
        </button>
      ))}
    </div>
  );
}

type Mine = { stars: number; quality: number | null; value: number | null; packaging: number | null; freshness: number | null; body: string | null; photos: number; showName: boolean; id: string } | null;

/** Write or edit the business's review (stars, details, text, up to 3 photos). */
export function ReviewForm({ l, offerId, mine, maxPhotos, details, maxChars, reviewId }: { l: L; offerId: string; mine: Mine; maxPhotos: number; details: boolean; maxChars: number; reviewId?: string }) {
  const { pending, error, done, run } = useRun();
  const [open, setOpen] = useState(!mine);
  const [stars, setStars] = useState<number | null>(mine?.stars ?? null);
  const [d, setD] = useState<Record<string, number | null>>({ quality: mine?.quality ?? null, value: mine?.value ?? null, packaging: mine?.packaging ?? null, freshness: mine?.freshness ?? null });
  const [body, setBody] = useState(mine?.body ?? "");
  const [showName, setShowName] = useState(mine?.showName ?? false);
  const [keep, setKeep] = useState<number[]>(Array.from({ length: mine?.photos ?? 0 }, (_, i) => i));
  const [files, setFiles] = useState<File[]>([]);
  const [localErr, setLocalErr] = useState<string | null>(null);
  const room = Math.max(0, maxPhotos - keep.length);
  if (!open) return <Button variant="outline" onClick={() => setOpen(true)} data-testid="review-edit"><Star className="size-4" /> {l.edit}</Button>;
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setLocalErr(null);
    if (!stars) { setLocalErr(l.pickStars); return; }
    const fd = new FormData();
    fd.set("offerId", offerId); fd.set("stars", String(stars));
    for (const k of DETAILS) if (d[k]) fd.set(k, String(d[k]));
    fd.set("body", body); fd.set("showName", showName ? "1" : "0");
    fd.set("language", document.documentElement.lang || "");
    for (const k of keep) fd.append("keep", String(k));
    for (const f of files.slice(0, room)) fd.append("photos", f);
    run(async () => saveReviewAction(fd), (data) => {
      const r = data as { status: string; holdReasons: string[] };
      setFiles([]);
      if (r.status === "HELD") setLocalErr(null);
    }, l.saved);
  };
  return (
    <form onSubmit={submit} className="space-y-4 rounded-xl border p-4" data-testid="review-form" id="write-review">
      <h3 className="font-semibold">{mine ? l.edit : l.write}</h3>
      <div><Label>{l.yourRating}</Label><StarPicker value={stars} onChange={setStars} label={l.yourRating} testid="review-stars" /></div>
      {details && (
        <fieldset className="grid gap-3 sm:grid-cols-2">
          <legend className="mb-1 text-sm font-medium">{l.detailsOptional}</legend>
          {DETAILS.map((k) => (
            <div key={k} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2">
              <span className="text-sm">{l[`detail.${k}`]}</span>
              <span className="inline-flex items-center gap-1">
                <StarPicker value={d[k]} onChange={(n) => setD({ ...d, [k]: n })} size={20} label={l[`detail.${k}`]} testid={`review-${k}`} />
                {d[k] && <button type="button" className="rounded p-1 text-muted-foreground hover:bg-muted" aria-label={l.clear} onClick={() => setD({ ...d, [k]: null })}><X className="size-3.5" /></button>}
              </span>
            </div>
          ))}
        </fieldset>
      )}
      <div>
        <Label htmlFor="review-body">{l.bodyLabel}</Label>
        <textarea id="review-body" className={area} value={body} maxLength={maxChars} onChange={(e) => setBody(e.target.value)} placeholder={l.bodyHint} data-testid="review-body" />
        <p className="mt-1 text-xs text-muted-foreground">{l.rules}</p>
      </div>
      {maxPhotos > 0 && (
        <div className="space-y-2">
          <Label>{fill(l.photos, { max: maxPhotos })}</Label>
          {mine && mine.photos > 0 && (
            <div className="flex flex-wrap gap-2">
              {Array.from({ length: mine.photos }, (_, i) => (
                <label key={i} className="relative inline-block">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={`/api/reviews/photos/${reviewId ?? mine.id}/${i}`} alt="" className={`size-20 rounded-lg border object-cover ${keep.includes(i) ? "" : "opacity-30"}`} />
                  <span className="absolute bottom-1 left-1 inline-flex items-center gap-1 rounded bg-background/90 px-1 text-[11px]">
                    <input type="checkbox" checked={keep.includes(i)} onChange={(e) => setKeep(e.target.checked ? [...keep, i] : keep.filter((k) => k !== i))} /> {l.keepPhoto}
                  </span>
                </label>
              ))}
            </div>
          )}
          {room > 0 && (
            <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-dashed px-3 py-2 text-sm hover:bg-muted">
              <ImagePlus className="size-4" /> {l.addPhotos}
              <input type="file" accept="image/jpeg,image/png,image/webp" multiple className="sr-only" data-testid="review-photos"
                onChange={(e) => setFiles(Array.from(e.target.files ?? []).slice(0, room))} />
            </label>
          )}
          {files.length > 0 && <p className="text-xs text-muted-foreground">{files.map((f) => f.name).join(", ")}</p>}
        </div>
      )}
      <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-0.5" checked={showName} onChange={(e) => setShowName(e.target.checked)} data-testid="review-showname" /> {l.showName}</label>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" disabled={pending} data-testid="review-save"><Spin on={pending} icon={Send} /> {l.save}</Button>
        {mine && <Button type="button" variant="ghost" onClick={() => setOpen(false)}>{l.cancel}</Button>}
        <Msg error={localErr ?? error} done={done} />
      </div>
    </form>
  );
}

export function DeleteReview({ l, id }: { l: L; id: string }) {
  const { pending, error, run } = useRun();
  return (
    <span className="inline-flex items-center gap-2">
      <Button size="sm" variant="ghost" disabled={pending} onClick={() => { if (confirm(l.deleteConfirm)) run(() => deleteReviewAction({ id })); }} data-testid="review-delete"><Spin on={pending} icon={Trash2} /> {l.delete}</Button>
      <Msg error={error} />
    </span>
  );
}

export function HelpfulButton({ l, id, count, voted, disabled }: { l: L; id: string; count: number; voted: boolean; disabled?: boolean }) {
  const { pending, error, run } = useRun();
  const [on, setOn] = useState(voted), [n, setN] = useState(count);
  return (
    <span className="inline-flex items-center gap-2">
      <Button size="sm" variant={on ? "secondary" : "ghost"} disabled={pending || disabled} aria-pressed={on} data-testid="review-helpful"
        onClick={() => run(async () => { const r = await voteHelpfulAction({ id, on: !on }); if (r.ok) { setOn(!on); setN(r.data as number); } return r; })}>
        <ThumbsUp className="size-4" /> {fill(l.helpful, { count: n })}
      </Button>
      <Msg error={error} />
    </span>
  );
}

export function ReportButton({ l, kind, id, reported }: { l: L; kind: "REVIEW" | "REPLY" | "QUESTION" | "ANSWER"; id: string; reported: boolean }) {
  const { pending, error, done, run } = useRun();
  const [open, setOpen] = useState(false), [reason, setReason] = useState<string>("OFFENSIVE"), [note, setNote] = useState("");
  const [sent, setSent] = useState(reported);
  if (sent) return <span className="text-xs text-muted-foreground" data-testid="reported">{done ?? l.reported}</span>;
  if (!open) return <Button size="sm" variant="ghost" onClick={() => setOpen(true)} data-testid={`report-${kind.toLowerCase()}`}><Flag className="size-4" /> {l.report}</Button>;
  return (
    <div className="w-full space-y-2 rounded-lg border p-3" data-testid="report-form">
      <Label>{l.reportTitle}</Label>
      <Select value={reason} onChange={(e) => setReason(e.target.value)} data-testid="report-reason">{REPORT_REASONS.map((r) => <option key={r} value={r}>{l[`reason.${r}`]}</option>)}</Select>
      <textarea className={area} value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} placeholder={l.reportNote} aria-label={l.reportNote} />
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" disabled={pending} onClick={() => run(() => reportContentAction({ kind, id, reason: reason as (typeof REPORT_REASONS)[number], note: note || null }), () => setSent(true), l.reportThanks)} data-testid="report-send"><Spin on={pending} icon={Flag} /> {l.send}</Button>
        <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>{l.cancel}</Button>
        <Msg error={error} />
      </div>
    </div>
  );
}

/** The supplier's one public reply. */
export function ReplyForm({ l, id, initial }: { l: L; id: string; initial: string | null }) {
  const { pending, error, done, run } = useRun();
  const [open, setOpen] = useState(false), [text, setText] = useState(initial ?? "");
  if (!open) return <Button size="sm" variant={initial ? "ghost" : "outline"} onClick={() => setOpen(true)} data-testid="reply-open"><MessageSquarePlus className="size-4" /> {initial ? l.editReply : l.reply}</Button>;
  return (
    <div className="w-full space-y-2" data-testid="reply-form">
      <textarea className={area} value={text} maxLength={2000} onChange={(e) => setText(e.target.value)} placeholder={l.replyPlaceholder} aria-label={l.reply} data-testid="reply-text" />
      <p className="text-xs text-muted-foreground">{l.replyRules}</p>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" disabled={pending || text.trim().length < 2} onClick={() => run(() => replyToReviewAction({ id, text }), (d) => { if ((d as { status: string }).status === "PUBLISHED") setOpen(false); }, l.replyDone)} data-testid="reply-send"><Spin on={pending} icon={Send} /> {l.replySend}</Button>
        <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>{l.cancel}</Button>
        <Msg error={error} done={done} />
      </div>
    </div>
  );
}

export function AskForm({ l, offerId }: { l: L; offerId: string }) {
  const { pending, error, done, run } = useRun();
  const [text, setText] = useState("");
  return (
    <div className="space-y-2" data-testid="ask-form">
      <Label htmlFor="ask-text">{l.ask}</Label>
      <textarea id="ask-text" className={area} value={text} maxLength={1000} onChange={(e) => setText(e.target.value)} placeholder={l.askPlaceholder} data-testid="ask-text" />
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" disabled={pending || text.trim().length < 5} onClick={() => run(() => askQuestionAction({ offerId, text }), (d) => { setText(""); void d; }, l.asked)} data-testid="ask-send"><Spin on={pending} icon={Send} /> {l.askSend}</Button>
        <Msg error={error} done={done} />
      </div>
    </div>
  );
}

export function AnswerForm({ l, questionId, compact }: { l: L; questionId: string; compact?: boolean }) {
  const { pending, error, done, run } = useRun();
  const [open, setOpen] = useState(!compact), [text, setText] = useState("");
  if (!open) return <Button size="sm" variant="ghost" onClick={() => setOpen(true)} data-testid="answer-open"><MessageSquarePlus className="size-4" /> {l.answer}</Button>;
  return (
    <div className="w-full space-y-2" data-testid="answer-form">
      <textarea className={area} value={text} maxLength={2000} onChange={(e) => setText(e.target.value)} placeholder={l.answerPlaceholder} aria-label={l.answer} data-testid="answer-text" />
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" disabled={pending || text.trim().length < 2} onClick={() => run(() => answerQuestionAction({ id: questionId, text }), () => setText(""), l.answered)} data-testid="answer-send"><Spin on={pending} icon={Send} /> {l.answerSend}</Button>
        {compact && <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>{l.cancel}</Button>}
        <Msg error={error} done={done} />
      </div>
    </div>
  );
}

export function DeletePost({ l, kind, id }: { l: L; kind: "QUESTION" | "ANSWER"; id: string }) {
  const { pending, error, run } = useRun();
  return (
    <span className="inline-flex items-center gap-1">
      <Button size="sm" variant="ghost" disabled={pending} onClick={() => { if (confirm(l.deletePostConfirm)) run(() => deleteOwnPostAction({ kind, id })); }} aria-label={l.delete}><Spin on={pending} icon={Trash2} /></Button>
      <Msg error={error} />
    </span>
  );
}

/** The AI summary — asked for after the page shows, so the page never waits for the AI. */
export function AiSummary({ l, offerId, locale, count }: { l: L; offerId: string; locale: string; count: number }) {
  const [s, setS] = useState<{ text: string; basedOn: number; simulated: boolean } | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    reviewSummaryAction({ offerId, locale }).then((r) => { if (live) setS(r.ok ? (r.data as typeof s) ?? null : null); }).catch(() => live && setS(null));
    return () => { live = false; };
  }, [offerId, locale, count]);
  if (s === null) return null;
  return (
    <div className="rounded-xl border bg-[color-mix(in_oklch,var(--vivid-violet,#7c3aed)_6%,var(--card))] p-3 text-sm" data-testid="review-ai-summary" aria-live="polite">
      <p className="mb-1 inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground"><Sparkles className="size-3.5" aria-hidden /> {l.aiTitle}</p>
      {s === undefined ? <p className="text-muted-foreground">{l.aiLoading}</p> : (
        <>
          <p className="whitespace-pre-line">{s.text}</p>
          <p className="mt-1 text-xs text-muted-foreground">{fill(l.aiNote, { count: s.basedOn })}{s.simulated ? ` · ${l.aiSimulated}` : ""}</p>
        </>
      )}
    </div>
  );
}

// ── FIRINGI (English) ──────────────────────────────────────────────────────

export function ModerateButtons({ kind, id, status }: { kind: "REVIEW" | "REPLY" | "QUESTION" | "ANSWER"; id: string; status: string }) {
  const { pending, error, done, run } = useRun();
  const [hide, setHide] = useState(false), [reason, setReason] = useState("");
  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="moderate">
      {status !== "PUBLISHED" && <Button size="sm" disabled={pending} onClick={() => run(() => moderateAction({ kind, id, action: "PUBLISH", reason: null }), undefined, "Published.")} data-testid="mod-publish"><Spin on={pending} icon={Check} /> Publish</Button>}
      {status !== "HIDDEN" && !hide && <Button size="sm" variant="outline" onClick={() => setHide(true)} data-testid="mod-hide"><X className="size-4" /> Hide…</Button>}
      {hide && (
        <span className="flex w-full flex-wrap items-center gap-2">
          <input className="h-8 min-w-0 flex-1 rounded-md border border-input bg-background px-2 text-sm" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason the author will see" aria-label="Reason" data-testid="mod-reason" />
          <Button size="sm" variant="destructive" disabled={pending || reason.trim().length < 3} onClick={() => run(() => moderateAction({ kind, id, action: "HIDE", reason }), () => setHide(false), "Hidden.")} data-testid="mod-hide-confirm"><Spin on={pending} icon={X} /> Hide</Button>
          <Button size="sm" variant="ghost" onClick={() => setHide(false)}>Cancel</Button>
        </span>
      )}
      <Msg error={error} done={done} />
    </div>
  );
}
