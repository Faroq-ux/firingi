/** Ticket conversation (company and staff). */
import { formatDate } from "@/lib/utils";

type Msg = { id: string; body: string; createdAt: Date; internal: boolean; fromStaff: boolean; author: { name: string } };

export function Thread({ messages, locale, l, staff }: { messages: Msg[]; locale: string; l: { you: string; firingi: string; internalNote: string }; staff: boolean }) {
  return (
    <ol className="space-y-3" data-testid="thread">
      {messages.map((m) => {
        const mine = staff ? m.fromStaff : !m.fromStaff;
        return (
          <li key={m.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
            <div className={`max-w-[85%] rounded-lg border p-3 text-sm ${m.internal ? "border-warning bg-warning/10" : mine ? "bg-primary/5" : "bg-card"}`} data-testid={m.internal ? "internal-note" : "message"}>
              <div className="mb-1 text-xs text-muted-foreground">
                {m.internal ? `${l.internalNote} · ` : ""}{m.fromStaff ? (staff ? m.author.name : `${l.firingi} · ${m.author.name}`) : staff ? m.author.name : `${l.you} · ${m.author.name}`} · {formatDate(m.createdAt, locale, true)}
              </div>
              <p className="whitespace-pre-line">{m.body}</p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
