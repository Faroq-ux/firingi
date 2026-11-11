"use client";
/** Supplier: saved imports — turn one into a scheduled feed (URL + every N hours), run now, delete. */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Link2, Loader2, Play, Radio, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { LiveDot } from "@/components/motion/shapes";
import { deleteProfileAction, runFeedAction, saveProfileAction } from "@/server/actions/integrations";

export type FeedProfile = { id: string; name: string; mapping: Record<string, string>; feedUrl: string | null; everyHours: number | null; enabled: boolean; lastRunAt: string | null; last: { status: string; heldReason: string | null; error: string | null } | null };
const HOURS = [1, 2, 4, 6, 12, 24, 48, 168];

function FeedCard({ p, locale, i }: { p: FeedProfile; locale: string; i: number }) {
  const t = useTranslations("integrations");
  const router = useRouter();
  const [url, setUrl] = useState(p.feedUrl ?? "");
  const [every, setEvery] = useState(p.everyHours ?? 6);
  const [enabled, setEnabled] = useState(p.enabled);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const live = !!p.feedUrl && p.enabled;
  const save = () => start(async () => {
    const r = await saveProfileAction({ id: p.id, name: p.name, mapping: p.mapping as Record<string, never>, feedUrl: url.trim() || null, everyHours: url.trim() ? every : null, enabled });
    setNote(r.ok ? { ok: true, text: t("feeds.saved") } : { ok: false, text: r.error }); if (r.ok) router.refresh();
  });
  const run = () => start(async () => {
    const r = await runFeedAction({ id: p.id });
    if (!r.ok) return setNote({ ok: false, text: r.error });
    setNote({ ok: r.data.status === "APPLIED", text: t(`feeds.result.${r.data.status}`) });
    if (r.data.status === "HELD") router.push(`/vendor/products/import/${r.data.runId}`); else router.refresh();
  });
  return (
    <div className={`tile gloss motion-rise motion-lift rounded-2xl border p-4 ${live ? "tone-teal" : "tone-violet"}`} style={{ ["--i" as string]: i }} data-testid="feed-card">
      <div className="mb-3 flex items-start gap-3">
        <div className="tile-chip grid size-10 shrink-0 place-items-center rounded-xl">{live ? <Radio className="size-5" aria-hidden /> : <Link2 className="size-5" aria-hidden />}</div>
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold">{p.name}</p>
          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            {live && <LiveDot />}{live ? t("feeds.on") : t("feeds.manual")} · {p.lastRunAt ? t("feeds.lastRun", { when: new Date(p.lastRunAt).toLocaleString(locale, { dateStyle: "short", timeStyle: "short" }) }) : t("feeds.never")}
          </p>
          {p.last?.status === "FAILED" && <p className="mt-1 text-xs text-destructive">{p.last.error}</p>}
          {p.last?.heldReason && p.last.status === "PREVIEW" && <p className="mt-1 text-xs text-[var(--vivid-orange)]">{t("feeds.result.HELD")}</p>}
        </div>
      </div>
      <div className="grid gap-2">
        <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder={t("feeds.url")} aria-label={t("feeds.url")} data-testid="feed-url" />
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-2 text-sm">{t("feeds.every")}
            <select className="h-9 rounded-md border bg-background px-2" value={every} onChange={(e) => setEvery(Number(e.target.value))} disabled={!url.trim()}>{HOURS.map((h) => <option key={h} value={h}>{t("feeds.hours", { n: h })}</option>)}</select>
          </label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="size-4" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />{t("feeds.on")}</label>
          <div className="ml-auto flex gap-1">
            <Button size="sm" disabled={pending} onClick={save} data-testid="feed-save">{t("feeds.save")}</Button>
            {p.feedUrl && <Button size="sm" variant="outline" disabled={pending} onClick={run} data-testid="feed-run">{pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Play className="size-4" aria-hidden />}{t("feeds.runNow")}</Button>}
            <Button size="sm" variant="ghost" className="text-destructive" disabled={pending} aria-label={t("feeds.delete")} onClick={() => { if (confirm(t("feeds.deleteConfirm"))) start(async () => { await deleteProfileAction({ id: p.id }); router.refresh(); }); }}><Trash2 className="size-4" aria-hidden /></Button>
          </div>
        </div>
        {note && <p className={`text-sm ${note.ok ? "text-[var(--vivid-teal)]" : "text-destructive"}`} role="status">{note.text}</p>}
      </div>
    </div>
  );
}

export function Feeds({ profiles, locale }: { profiles: FeedProfile[]; locale: string }) {
  const t = useTranslations("integrations");
  if (!profiles.length) return <p className="text-sm text-muted-foreground">{t("feeds.none")}</p>;
  return <div className="grid gap-3 md:grid-cols-2">{profiles.map((p, i) => <FeedCard key={p.id} p={p} locale={locale} i={i} />)}</div>;
}
