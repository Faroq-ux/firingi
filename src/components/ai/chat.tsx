"use client";
/**
 * AI Business Assistant chat. Staff (English) and buyers / suppliers (translated labels in `l`).
 * The conversation list and the open conversation come from the server; a question is sent
 * with a server action and the answer is added in place.
 */
import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Bot, CheckCircle2, Headset, MessageSquarePlus, Send, ShoppingCart, Sparkles, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { askAssistantAction, deleteConversationAction, handoverAction } from "@/server/actions/ai";
import { TOOL_LABEL } from "@/lib/ai";
import { Markdown } from "./markdown";
import { MicButton, SpeakButton, appendSpoken } from "@/components/voice/voice";
import { EN_VOICE } from "@/lib/voice";
import { MAX_CHAT_PHOTOS, PhotoButton, PhotoTray, ScanButton, type MediaLabels } from "./media";

export type ChatLabels = Record<"title" | "newChat" | "history" | "noHistory" | "placeholder" | "send" | "thinking" | "lookedAt" | "you" | "assistant" | "suggestOnly" | "delete" | "tryAsking", string>;
export const EN_CHAT: ChatLabels = {
  title: "AI Business Assistant", newChat: "New conversation", history: "Conversations", noHistory: "No conversations yet.", placeholder: "Ask about sales, stock, customers, suppliers…",
  send: "Ask", thinking: "Looking at your data…", lookedAt: "Looked at", you: "You", assistant: "FIRINGI AI", suggestOnly: "The assistant reads your data and suggests — it never changes anything.",
  delete: "Delete conversation", tryAsking: "Try asking",
};
/** What the agent did, shown under its answer: products put in the cart, an offer to pass the chat to FIRINGI support. */
export type ToolCard = { kind: "cart"; product: string; pack: string; qty: number; cartQty: number } | { kind: "handover"; subject: string; summary: string; category: string } | { kind: "proposal"; draftId: string };
export type ChatTool = { name: string; ok: boolean; card?: ToolCard; ticketId?: string; ticketNumber?: string };
export type AgentLabels = Record<"addedToCart" | "cartNow" | "openCart" | "handoverTitle" | "handoverText" | "handoverSend" | "handoverSent" | "openRequest", string> & { media: MediaLabels };
/** `photos`: how many the person sent (served from the server); `previews`: local previews right after sending. */
type Msg = { id: string; role: "user" | "assistant"; text: string; tools?: ChatTool[]; model?: string | null; fellBack?: boolean; photos?: number; previews?: string[] };
const fill = (s: string, v: Record<string, string | number>) => s.replace(/\{(\w+)\}/g, (_, k) => String(v[k] ?? ""));

export function AssistantChat({ side, base, conversations, active, initial, examples, l = EN_CHAT, locale, showModel = false, toolLabel = TOOL_LABEL, agent, photos: photosOn = false }: {
  side: "STAFF" | "VENDOR" | "BUYER"; base: string; conversations: { id: string; title: string; updatedAt: string }[]; active: string | null; initial: Msg[];
  examples: string[]; l?: ChatLabels; locale: string; showModel?: boolean; toolLabel?: Record<string, string>; agent?: AgentLabels; photos?: boolean;
}) {
  const router = useRouter();
  const [messages, setMessages] = useState<Msg[]>(initial);
  const [conversationId, setConversationId] = useState<string | null>(active);
  const [text, setText] = useState("");
  const [photos, setPhotos] = useState<{ file: File; url: string }[]>([]);
  // photos still being prepared: a question sent meanwhile waits for them (queued)
  const [preparing, setPreparing] = useState(false);
  const [queued, setQueued] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const end = useRef<HTMLDivElement>(null);
  const voice = side === "STAFF" ? EN_VOICE : undefined; // staff pages are English; suppliers / customers in their language
  useEffect(() => { setMessages(initial); setConversationId(active); }, [active, initial]);
  useEffect(() => { end.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [messages.length, pending]);
  // the photos are ready: send the question that waited for them
  useEffect(() => { if (!preparing && queued != null) { const q = queued; setQueued(null); send(q); } }, [preparing, queued]); // eslint-disable-line react-hooks/exhaustive-deps

  const media = photosOn ? agent?.media : undefined; // photos & scan only where FIRINGI has them on
  const addPhotos = (files: File[]) => {
    setError(null);
    setPhotos((cur) => {
      const room = MAX_CHAT_PHOTOS - cur.length;
      if (files.length > room && media) setError(media.tooMany);
      return [...cur, ...files.slice(0, Math.max(0, room)).map((file) => ({ file, url: URL.createObjectURL(file) }))];
    });
  };
  const send = (q: string) => {
    const question = q.trim();
    if (preparing) { setQueued(q); return; }
    const sending = photos;
    if ((!question && !sending.length) || pending) return;
    setError(null);
    setText("");
    setPhotos([]);
    setMessages((m) => [...m, { id: `u${Date.now()}`, role: "user", text: question, previews: sending.map((p) => p.url) }]);
    start(async () => {
      const fd = new FormData();
      fd.set("side", side); fd.set("text", question); fd.set("locale", locale);
      if (conversationId) fd.set("conversationId", conversationId);
      for (const p of sending) fd.append("photos", p.file);
      const r = await askAssistantAction(fd);
      if (!r.ok) { setError(r.error); setMessages((m) => m.slice(0, -1)); setText(question); setPhotos(sending); return; }
      setMessages((m) => [...m, { id: r.data.messageId, role: "assistant", text: r.data.answer, tools: r.data.tools, model: r.data.model, fellBack: r.data.fellBack }]);
      if (!conversationId) { setConversationId(r.data.conversationId); router.replace(`${base}?c=${r.data.conversationId}`, { scroll: false }); }
      router.refresh();
    });
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[16rem_1fr]" data-testid="assistant">
      <aside className="space-y-2 rounded-2xl border bg-card p-3">
        <Link href={base} className="flex items-center gap-2 rounded-lg bg-[linear-gradient(90deg,var(--vivid-blue),var(--vivid-violet))] px-3 py-2 text-sm font-medium text-white shadow-sm transition hover:opacity-90" data-testid="new-chat">
          <MessageSquarePlus className="size-4" aria-hidden /> {l.newChat}
        </Link>
        <p className="px-1 pt-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">{l.history}</p>
        <nav className="max-h-[28rem] space-y-0.5 overflow-y-auto" data-testid="conversations">
          {conversations.map((c) => (
            <Link key={c.id} href={`${base}?c=${c.id}`} className={`block truncate rounded-md px-2 py-1.5 text-sm transition hover:bg-muted ${c.id === conversationId ? "bg-muted font-medium" : ""}`} title={c.title}>{c.title}</Link>
          ))}
          {!conversations.length && <p className="px-2 text-sm text-muted-foreground">{l.noHistory}</p>}
        </nav>
      </aside>

      <section className="flex min-h-[32rem] flex-col rounded-2xl border bg-card">
        <div className="flex-1 space-y-4 overflow-y-auto p-4" aria-live="polite" data-testid="chat-messages">
          {!messages.length && (
            <div className="motion-rise mx-auto max-w-xl py-8 text-center">
              <div className="mx-auto mb-3 grid size-14 place-items-center rounded-2xl bg-[linear-gradient(135deg,var(--vivid-blue),var(--vivid-violet),var(--vivid-pink))] text-white shadow-lg"><Sparkles className="size-7" aria-hidden /></div>
              <h2 className="text-gradient text-xl font-bold">{l.title}</h2>
              <p className="mt-1 text-sm text-muted-foreground">{l.suggestOnly}</p>
              <p className="mt-5 text-xs font-medium uppercase tracking-wide text-muted-foreground">{l.tryAsking}</p>
              <div className="mt-2 flex flex-wrap justify-center gap-2" data-testid="examples">
                {examples.map((e) => <button key={e} type="button" onClick={() => send(e)} className="rounded-full border bg-background px-3 py-1.5 text-sm transition hover:border-[var(--vivid-violet)] hover:shadow-sm">{e}</button>)}
              </div>
            </div>
          )}
          {messages.map((m) => (
            <div key={m.id} className={`motion-rise flex gap-3 ${m.role === "user" ? "justify-end" : ""}`} data-testid={`msg-${m.role}`}>
              {m.role === "assistant" && <div className="grid size-8 shrink-0 place-items-center rounded-full bg-[linear-gradient(135deg,var(--vivid-blue),var(--vivid-violet))] text-white"><Bot className="size-4" aria-label={l.assistant} /></div>}
              <div className={`max-w-[85%] rounded-2xl px-4 py-2.5 ${m.role === "user" ? "bg-primary text-primary-foreground" : "border bg-background"}`}>
                {m.role === "user" && (!!m.previews?.length || !!m.photos) && (
                  <div className="mb-2 flex flex-wrap justify-end gap-1.5" data-testid="msg-photos">
                    {(m.previews ?? Array.from({ length: m.photos ?? 0 }, (_, i) => `/api/assistant/photos/${m.id}/${i}`)).map((src, i) => (
                      // eslint-disable-next-line @next/next/no-img-element -- private photo (owner-only route) or local preview
                      <img key={src} src={src} alt={`${media?.photo1 ?? "Photo"} ${i + 1}`} className="size-20 rounded-lg border border-white/30 object-cover" />
                    ))}
                  </div>
                )}
                {m.role === "user" ? (m.text && m.text !== "(photo)" && <p className="whitespace-pre-wrap text-sm">{m.text}</p>) : <Markdown text={m.text} />}
                {m.role === "assistant" && agent && side !== "STAFF" && <AgentCards side={side} messageId={m.id} tools={m.tools ?? []} l={agent} />}
                {m.role === "assistant" && <div className="mt-1 -ml-2"><SpeakButton text={m.text} labels={voice} lang={locale} /></div>}
                {m.role === "assistant" && (!!m.tools?.length || (showModel && m.model)) && (
                  <p className="mt-2 flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
                    {!!m.tools?.length && <>{l.lookedAt}: {[...new Set(m.tools.map((t) => toolLabel[t.name] ?? t.name))].map((n) => <span key={n} className="rounded-full bg-muted px-2 py-0.5">{n}</span>)}</>}
                    {showModel && m.model && <span className="ml-auto">{m.model}{m.fellBack ? " (fallback)" : ""}</span>}
                  </p>
                )}
              </div>
            </div>
          ))}
          {pending && (
            <div className="flex items-center gap-3 text-sm text-muted-foreground" data-testid="thinking">
              <div className="grid size-8 place-items-center rounded-full bg-[linear-gradient(135deg,var(--vivid-blue),var(--vivid-violet))] text-white"><Bot className="size-4" aria-hidden /></div>
              <span className="flex gap-1" aria-hidden><span className="size-1.5 animate-bounce rounded-full bg-current [animation-delay:-0.3s]" /><span className="size-1.5 animate-bounce rounded-full bg-current [animation-delay:-0.15s]" /><span className="size-1.5 animate-bounce rounded-full bg-current" /></span>
              {l.thinking}
            </div>
          )}
          <div ref={end} />
        </div>
        {error && <p role="alert" className="px-4 text-sm text-destructive">{error}</p>}
        {media && <PhotoTray photos={photos} onRemove={(i) => setPhotos((p) => p.filter((_, j) => j !== i))} l={media} />}
        <form className="flex flex-wrap items-end gap-2 border-t p-3 sm:flex-nowrap" onSubmit={(e) => { e.preventDefault(); send(text); }}>
          <textarea
            value={text} onChange={(e) => setText(e.target.value)} rows={2} maxLength={4000} placeholder={l.placeholder} aria-label={l.placeholder} data-testid="chat-input"
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(text); } }}
            className="min-h-11 w-full flex-1 resize-none rounded-xl border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring sm:w-auto"
          />
          <MicButton onText={(s) => setText((t) => appendSpoken(t, s))} labels={voice} lang={locale} />
          {media && side !== "STAFF" && <PhotoButton count={photos.length} onAdd={addPhotos} l={media} disabled={pending} onPreparing={setPreparing} />}
          {media && side !== "STAFF" && <ScanButton onCode={(code) => setText((t) => appendSpoken(t, code))} l={media} />}
          <Button type="submit" disabled={pending || (!text.trim() && !photos.length)}><Send className="size-4" aria-hidden /> {l.send}</Button>
          {conversationId && (
            <Button type="button" variant="ghost" size="sm" aria-label={l.delete} title={l.delete} disabled={pending}
              onClick={() => start(async () => { const r = await deleteConversationAction({ side, id: conversationId }); if (r.ok) { setMessages([]); setConversationId(null); router.replace(base); router.refresh(); } })}>
              <Trash2 className="size-4" aria-hidden />
            </Button>
          )}
        </form>
      </section>
    </div>
  );
}

/** Cart and hand-over cards under an agent answer. */
function AgentCards({ side, messageId, tools, l }: { side: "VENDOR" | "BUYER"; messageId: string; tools: ChatTool[]; l: AgentLabels }) {
  const carts = tools.filter((t) => t.ok && t.card?.kind === "cart");
  const handover = tools.find((t) => t.ok && t.card?.kind === "handover");
  if (!carts.length && !handover) return null;
  return (
    <div className="mt-3 space-y-2">
      {carts.map((t, i) => {
        const c = t.card as Extract<ToolCard, { kind: "cart" }>;
        return (
          <div key={i} className="flex flex-wrap items-center gap-3 rounded-xl border border-[color-mix(in_oklab,var(--vivid-teal)_40%,transparent)] bg-[color-mix(in_oklab,var(--vivid-teal)_8%,transparent)] px-3 py-2" data-testid="cart-card">
            <span className="grid size-8 shrink-0 place-items-center rounded-full bg-[linear-gradient(135deg,var(--vivid-teal),var(--vivid-blue))] text-white"><ShoppingCart className="size-4" aria-hidden /></span>
            <div className="min-w-0 flex-1 text-sm">
              <p className="font-medium [overflow-wrap:anywhere]">{fill(l.addedToCart, { qty: c.qty, product: c.product })} <span className="text-muted-foreground">· {c.pack}</span></p>
              <p className="text-xs text-muted-foreground">{fill(l.cartNow, { qty: c.cartQty })}</p>
            </div>
            <Link href="/buy/orders/cart" className="rounded-full bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition hover:opacity-90" data-testid="open-cart">{l.openCart}</Link>
          </div>
        );
      })}
      {handover && <HandoverCard side={side} messageId={messageId} tool={handover} l={l} />}
    </div>
  );
}

function HandoverCard({ side, messageId, tool, l }: { side: "VENDOR" | "BUYER"; messageId: string; tool: ChatTool; l: AgentLabels }) {
  const router = useRouter();
  const [sent, setSent] = useState<{ id: string; number: string } | null>(tool.ticketId ? { id: tool.ticketId, number: tool.ticketNumber ?? "" } : null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const c = tool.card as Extract<ToolCard, { kind: "handover" }>;
  const href = sent ? `${side === "BUYER" ? "/buy" : "/vendor"}/support/${sent.id}` : "";
  return (
    <div className="rounded-xl border border-[color-mix(in_oklab,var(--vivid-violet)_40%,transparent)] bg-[color-mix(in_oklab,var(--vivid-violet)_7%,transparent)] p-3" data-testid="handover-card">
      <div className="flex items-start gap-3">
        <span className="grid size-8 shrink-0 place-items-center rounded-full bg-[linear-gradient(135deg,var(--vivid-violet),var(--vivid-pink))] text-white"><Headset className="size-4" aria-hidden /></span>
        <div className="min-w-0 flex-1 text-sm">
          <p className="font-medium">{sent ? fill(l.handoverSent, { number: sent.number }) : l.handoverTitle}</p>
          <p className="mt-0.5 text-xs text-muted-foreground [overflow-wrap:anywhere]">{sent ? c.subject : l.handoverText}</p>
        </div>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2 pl-11">
        {sent ? (
          <Link href={href} className="inline-flex items-center gap-1.5 rounded-full border bg-background px-3 py-1.5 text-xs font-medium transition hover:border-[var(--vivid-violet)]" data-testid="handover-open"><CheckCircle2 className="size-3.5 text-[var(--vivid-teal)]" aria-hidden /> {l.openRequest}</Link>
        ) : (
          <Button type="button" size="sm" disabled={pending} data-testid="handover-send"
            onClick={() => start(async () => { setError(null); const r = await handoverAction({ side, messageId }); if (!r.ok) { setError(r.error); return; } setSent({ id: r.data.ticketId, number: r.data.number }); router.refresh(); })}>
            <Headset className="size-4" aria-hidden /> {l.handoverSend}
          </Button>
        )}
        {error && <span role="alert" className="text-xs text-destructive">{error}</span>}
      </div>
    </div>
  );
}

/** Shown when no API key is configured or the assistant is switched off for this portal. */
export function AssistantOff({ title, text, children }: { title: string; text: string; children?: React.ReactNode }) {
  return (
    <div className="motion-rise rounded-2xl border border-dashed bg-card p-8 text-center" data-testid="assistant-off">
      <div className="mx-auto mb-3 grid size-12 place-items-center rounded-2xl bg-muted"><Bot className="size-6 text-muted-foreground" aria-hidden /></div>
      <h2 className="font-semibold">{title}</h2>
      <p className="mx-auto mt-1 max-w-lg text-sm text-muted-foreground">{text}</p>
      {children}
    </div>
  );
}
