"use client";
/** Order chat (Phase 35): one tab per conversation, messages with photos and translation, the composer. */
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Camera, Languages, Loader2, Lock, Send, ShieldAlert, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { markChatReadAction, sendChatMessageAction } from "@/server/actions/chat";

type Labels = Record<string, string>;
const fill = (s: string, v: Record<string, string | number>) => s.replace(/\{(\w+)\}/g, (_, k) => String(v[k] ?? ""));

export type ChatMsg = {
  id: string; mine: boolean; side: "BUYER" | "SUPPLIER" | "FIRINGI" | "DRIVER"; company: string | null; name: string;
  body: string; translated: boolean; original: string | null; hidden: boolean; photos: number; createdAt: string;
  typed?: string | null; flags?: string[]; reviewed?: boolean;
};
export type ChatTab = { channel: string; label: string; canWrite: boolean; why: string | null; unread: number; messages: ChatMsg[] };

export function OrderChat({ orderId, portal, tabs, photos, translate, staff, l, locale }: {
  orderId: string; portal: "buy" | "vendor" | "admin" | "driver"; tabs: ChatTab[]; photos: boolean; translate: boolean; staff: boolean; l: Labels; locale: string;
}) {
  const router = useRouter();
  const first = tabs.find((t) => t.unread > 0) ?? tabs[0];
  const [active, setActive] = useState(first?.channel);
  const tab = tabs.find((t) => t.channel === active) ?? tabs[0];
  const [body, setBody] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [warn, setWarn] = useState(false);
  const [pending, start] = useTransition();
  const [originals, setOriginals] = useState<Set<string>>(new Set());
  const listRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const time = useMemo(() => new Intl.DateTimeFormat(locale, { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }), [locale]);

  // read when opened; keep the list at the newest message; refresh while the page is open
  useEffect(() => {
    if (tab?.unread) void markChatReadAction({ orderId, channel: tab.channel, portal });
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [tab?.channel, tab?.unread, tab?.messages.length, orderId, portal]);
  useEffect(() => {
    const id = setInterval(() => { if (document.visibilityState === "visible") router.refresh(); }, 20000);
    return () => clearInterval(id);
  }, [router]);
  if (!tab) return null;

  const submit = () => start(async () => {
    setError(null); setWarn(false);
    const fd = new FormData();
    fd.set("orderId", orderId); fd.set("portal", portal); fd.set("channel", tab.channel); fd.set("body", body); fd.set("locale", locale);
    for (const f of files) fd.append("photos", f);
    const r = await sendChatMessageAction(fd);
    if (!r.ok) { setError(r.error ?? "Error"); return; }
    setBody(""); setFiles([]); if (fileRef.current) fileRef.current.value = "";
    if ((r.data as { hidden?: boolean }).hidden) setWarn(true);
    router.refresh();
  });

  const who = (m: ChatMsg) => (m.mine ? l.you : m.side === "DRIVER" ? `${l.driver} · ${m.name}` : `${m.name}${m.company ? ` · ${m.company}` : ""}`);
  return (
    <div className="space-y-3" data-testid="order-chat">
      <div className="flex flex-wrap gap-1.5" role="tablist" aria-label={l.title}>
        {tabs.map((t) => (
          <button key={t.channel} type="button" role="tab" aria-selected={t.channel === tab.channel} onClick={() => { setActive(t.channel); setError(null); setWarn(false); }}
            data-testid={`chat-tab-${t.channel}`}
            className={`rounded-full border px-3 py-1.5 text-sm transition ${t.channel === tab.channel ? "border-transparent bg-[linear-gradient(90deg,var(--vivid-blue),var(--vivid-violet))] text-white shadow-sm" : "bg-card hover:border-[var(--vivid-violet)]"}`}>
            {t.label}{t.unread > 0 && <span className="ml-1.5 rounded-full bg-[var(--vivid-pink,#db2777)] px-1.5 text-xs text-white" data-testid="chat-unread">{t.unread}</span>}
          </button>
        ))}
      </div>

      <div ref={listRef} className="max-h-[26rem] min-h-28 space-y-2 overflow-y-auto rounded-xl border bg-muted/30 p-3" data-testid="chat-messages" aria-live="polite">
        {tab.messages.length === 0 && <p className="py-6 text-center text-sm text-muted-foreground">{l.empty}</p>}
        {tab.messages.map((m) => {
          const showOriginal = originals.has(m.id);
          return (
            <div key={m.id} className={`flex ${m.mine ? "justify-end" : "justify-start"}`} data-testid="chat-message">
              <div className={`max-w-[85%] min-w-0 rounded-2xl px-3 py-2 text-sm shadow-sm ${m.mine ? "bg-primary text-primary-foreground" : "border bg-card"}`}>
                <div className={`mb-0.5 text-xs ${m.mine ? "text-primary-foreground/80" : "text-muted-foreground"}`}>{who(m)} · {time.format(new Date(m.createdAt))}</div>
                {m.body && <p className="whitespace-pre-wrap break-words" data-testid="chat-body">{showOriginal && m.original ? m.original : m.body}</p>}
                {m.photos > 0 && (
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {Array.from({ length: m.photos }, (_, n) => (
                      <a key={n} href={`/api/chat/photos/${portal}/${m.id}/${n}`} target="_blank" rel="noreferrer">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={`/api/chat/photos/${portal}/${m.id}/${n}`} alt={l.photo} className="size-20 rounded-lg border object-cover" />
                      </a>
                    ))}
                  </div>
                )}
                {m.translated && (
                  <button type="button" className={`mt-1 inline-flex items-center gap-1 text-xs underline-offset-2 hover:underline ${m.mine ? "text-primary-foreground/80" : "text-muted-foreground"}`} data-testid="chat-original"
                    onClick={() => setOriginals((s) => { const n = new Set(s); if (n.has(m.id)) n.delete(m.id); else n.add(m.id); return n; })}>
                    <Languages className="size-3" /> {showOriginal ? l.showTranslation : `${l.translated} · ${l.showOriginal}`}
                  </button>
                )}
                {staff && m.flags && m.flags.length > 0 && (
                  <div className="mt-1.5 rounded-md bg-warning/15 p-1.5 text-xs text-foreground" data-testid="chat-flag">
                    <span className="font-medium">{l.flagged}: {m.flags.join(", ")}{m.reviewed ? ` · ${l.reviewed}` : ""}</span>
                    {m.typed && <span className="block break-words">{l.typed}: {m.typed}</span>}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {tab.canWrite ? (
        <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); submit(); }} data-testid="chat-form">
          <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={2} maxLength={2000} placeholder={l.placeholder} aria-label={l.placeholder} data-testid="chat-input"
            onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && (body.trim() || files.length)) { e.preventDefault(); submit(); } }}
            className="w-full resize-y rounded-xl border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring" />
          {files.length > 0 && (
            <div className="flex flex-wrap gap-1.5 text-xs">
              {files.map((f, i) => (
                <span key={i} className="inline-flex max-w-full items-center gap-1 rounded-full border bg-card px-2 py-0.5"><span className="truncate">{f.name}</span>
                  <button type="button" aria-label={l.remove} onClick={() => setFiles(files.filter((_, j) => j !== i))}><X className="size-3" /></button></span>
              ))}
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit" disabled={pending || (!body.trim() && !files.length)} data-testid="chat-send">{pending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />} {l.send}</Button>
            {photos && (
              <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border bg-card px-3 py-2 text-sm hover:bg-accent">
                <Camera className="size-4" /> {l.addPhotos}
                <input ref={fileRef} type="file" accept="image/*" multiple className="sr-only" data-testid="chat-photos"
                  onChange={(e) => setFiles(Array.from(e.target.files ?? []).slice(0, 3))} />
              </label>
            )}
            {translate && <span className="text-xs text-muted-foreground">{l.translateNote}</span>}
          </div>
          {warn && <p className="flex items-start gap-1.5 rounded-md bg-warning/15 p-2 text-sm" role="status" data-testid="chat-hidden-warning"><ShieldAlert className="mt-0.5 size-4 shrink-0" /> {l.hiddenWarn}</p>}
          {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
        </form>
      ) : (
        <p className="flex items-center gap-1.5 text-sm text-muted-foreground" data-testid="chat-closed"><Lock className="size-4" /> {l[`why.${tab.why}`] ?? l["why.OFF"]}</p>
      )}
      <p className="text-xs text-muted-foreground">{fill(l.privacy, {})}</p>
    </div>
  );
}
