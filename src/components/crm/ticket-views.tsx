/** Ticket conversation (company and staff). */
import { formatDate } from "@/lib/utils";
import { SpeakButton } from "@/components/voice/voice";
import { EN_VOICE } from "@/lib/voice";

type Msg = { id: string; ticketId: string; body: string; createdAt: Date; internal: boolean; fromStaff: boolean; photoKeys?: string[]; author: { name: string } };

export function Thread({ messages, locale, l, staff }: { messages: Msg[]; locale: string; l: { you: string; firingi: string; internalNote: string; photo?: string }; staff: boolean }) {
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
              {!!m.photoKeys?.length && (
                <div className="mt-2 flex flex-wrap gap-2" data-testid="message-photos">
                  {m.photoKeys.map((_, i) => (
                    <a key={i} href={`/api/support/${m.ticketId}/photos/${m.id}/${i}`} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-md border">
                      {/* eslint-disable-next-line @next/next/no-img-element -- private photo served by FIRINGI with the ticket's access check */}
                      <img src={`/api/support/${m.ticketId}/photos/${m.id}/${i}`} alt={`${l.photo ?? "Photo"} ${i + 1}`} className="size-24 object-cover" loading="lazy" />
                    </a>
                  ))}
                </div>
              )}
              {!m.internal && <div className="mt-1 -ml-2"><SpeakButton text={m.body} labels={staff ? EN_VOICE : undefined} /></div>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
