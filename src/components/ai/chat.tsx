"use client";
/**
 * AI Business Assistant chat. Staff (English) and buyers / suppliers (translated labels in `l`).
 * The conversation list and the open conversation come from the server; a question is sent
 * with a server action and the answer is added in place.
 */
import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Bot, MessageSquarePlus, Send, Sparkles, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { askAssistantAction, deleteConversationAction } from "@/server/actions/ai";
import { TOOL_LABEL } from "@/lib/ai";
import { Markdown } from "./markdown";

export type ChatLabels = Record<"title" | "newChat" | "history" | "noHistory" | "placeholder" | "send" | "thinking" | "lookedAt" | "you" | "assistant" | "suggestOnly" | "delete" | "tryAsking", string>;
export const EN_CHAT: ChatLabels = {
  title: "AI Business Assistant", newChat: "New conversation", history: "Conversations", noHistory: "No conversations yet.", placeholder: "Ask about sales, stock, customers, suppliers…",
  send: "Ask", thinking: "Looking at your data…", lookedAt: "Looked at", you: "You", assistant: "FIRINGI AI", suggestOnly: "The assistant reads your data and suggests — it never changes anything.",
  delete: "Delete conversation", tryAsking: "Try asking",
};
type Msg = { id: string; role: "user" | "assistant"; text: string; tools?: { name: string; ok: boolean }[]; model?: string | null; fellBack?: boolean };

export function AssistantChat({ side, base, conversations, active, initial, examples, l = EN_CHAT, locale, showModel = false, toolLabel = TOOL_LABEL }: {
  side: "STAFF" | "VENDOR" | "BUYER"; base: string; conversations: { id: string; title: string; updatedAt: string }[]; active: string | null; initial: Msg[];
  examples: string[]; l?: ChatLabels; locale: string; showModel?: boolean; toolLabel?: Record<string, string>;
}) {
  const router = useRouter();
  const [messages, setMessages] = useState<Msg[]>(initial);
  const [conversationId, setConversationId] = useState<string | null>(active);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { setMessages(initial); setConversationId(active); }, [active, initial]);
  useEffect(() => { end.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [messages.length, pending]);

  const send = (q: string) => {
    const question = q.trim();
    if (!question || pending) return;
    setError(null);
    setText("");
    setMessages((m) => [...m, { id: `u${Date.now()}`, role: "user", text: question }]);
    start(async () => {
      const r = await askAssistantAction({ side, conversationId, text: question, locale });
      if (!r.ok) { setError(r.error); setMessages((m) => m.slice(0, -1)); setText(question); return; }
      setMessages((m) => [...m, { id: `a${Date.now()}`, role: "assistant", text: r.data.answer, tools: r.data.tools, model: r.data.model, fellBack: r.data.fellBack }]);
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
                {m.role === "user" ? <p className="whitespace-pre-wrap text-sm">{m.text}</p> : <Markdown text={m.text} />}
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
        <form className="flex items-end gap-2 border-t p-3" onSubmit={(e) => { e.preventDefault(); send(text); }}>
          <textarea
            value={text} onChange={(e) => setText(e.target.value)} rows={2} maxLength={4000} placeholder={l.placeholder} aria-label={l.placeholder} data-testid="chat-input"
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(text); } }}
            className="min-h-11 flex-1 resize-none rounded-xl border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <Button type="submit" disabled={pending || !text.trim()}><Send className="size-4" aria-hidden /> {l.send}</Button>
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
