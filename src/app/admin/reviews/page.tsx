import Link from "next/link";
import { ShieldCheck } from "lucide-react";
import type { ReportKind } from "@prisma/client";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { moderationQueue, type ModTab } from "@/server/reviews/service";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { ModerateButtons } from "@/components/reviews/client";
import { Stars } from "@/components/reviews/stars";

export const metadata = { title: "Review Moderation" };
export const dynamic = "force-dynamic";

const TABS: [ModTab, string][] = [["HELD", "Waiting"], ["REPORTED", "Reported"], ["HIDDEN", "Hidden"], ["ALL", "All"]];
const KINDS: [ReportKind | "", string][] = [["", "Everything"], ["REVIEW", "Reviews"], ["REPLY", "Supplier replies"], ["QUESTION", "Questions"], ["ANSWER", "Answers"]];
const HOLD: Record<string, string> = { CONTACT: "contact details", LINK: "link", INSULT: "insult", COMPETITOR: "competitor name", WORD: "blocked word", REPORTS: "reports" };
const REASON: Record<string, string> = { CONTACT: "Contact details / advertising", OFFENSIVE: "Offensive", FALSE: "Not true / misleading", NOT_ABOUT_PRODUCT: "Not about the product", SPAM: "Spam", OTHER: "Other" };

/** Phase 53: posts the filter or reports held, open reports, hidden posts — publish or hide with a reason. */
export default async function Page({ searchParams }: { searchParams: Promise<{ tab?: string; kind?: string; q?: string; page?: string }> }) {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.reviews.moderate", "admin.settings.manage"]);
  const sp = await searchParams;
  const tab = (TABS.map((t) => t[0]) as string[]).includes(sp.tab ?? "") ? (sp.tab as ModTab) : "HELD";
  const kind = (["REVIEW", "REPLY", "QUESTION", "ANSWER"] as string[]).includes(sp.kind ?? "") ? (sp.kind as ReportKind) : null;
  const v = await moderationQueue(ctx, { tab, kind, q: sp.q ?? null, page: Number(sp.page) || 1 });
  const href = (o: Record<string, string | null>) => { const p = new URLSearchParams(Object.entries({ tab, kind, q: sp.q ?? null, ...o }).filter(([, x]) => x) as [string, string][]); return `/admin/reviews?${p}`; };
  return (
    <>
      <PageHeader title="Review Moderation" icon={ShieldCheck} description="Product reviews, supplier replies, questions and answers publish at once. The filter holds posts with contact details, links, insults or competitor names; reports can hold them too. Publish them, or hide them with a reason the author is told." actions={<div className="flex gap-3 text-sm"><Link href="/admin/reviews/overview" className="text-primary hover:underline">Overview →</Link><Link href="/admin/settings/reviews" className="text-primary hover:underline">Settings →</Link></div>} />
      <div className="mb-4 flex flex-wrap items-center gap-2 text-sm">
        {TABS.map(([t, label]) => <Link key={t} href={href({ tab: t, page: null })} className={`rounded-full border px-3 py-1 ${tab === t ? "border-primary bg-primary/10 font-medium text-primary" : "hover:bg-muted"}`} data-testid={`mod-tab-${t}`}>{label}{t === "HELD" && v.counts.held ? ` (${v.counts.held})` : ""}{t === "REPORTED" && v.counts.reported ? ` (${v.counts.reported})` : ""}</Link>)}
        <span className="mx-1 hidden h-5 border-l sm:inline" />
        {KINDS.map(([k, label]) => <Link key={k} href={href({ kind: k || null, page: null })} className={`rounded-full px-2 py-0.5 text-xs ${(kind ?? "") === k ? "bg-muted font-medium" : "text-muted-foreground hover:bg-muted"}`}>{label}</Link>)}
        <form className="ml-auto flex gap-2" action="/admin/reviews"><input type="hidden" name="tab" value={tab} />{kind && <input type="hidden" name="kind" value={kind} />}<input name="q" defaultValue={sp.q ?? ""} placeholder="Search the text…" className="h-8 w-48 rounded-md border border-input bg-background px-2 text-sm" aria-label="Search" /></form>
      </div>
      {v.items.length === 0 ? <p className="py-10 text-center text-muted-foreground" data-testid="mod-empty">Nothing here.</p> : (
        <ul className="space-y-3" data-testid="mod-list">
          {v.items.map((x) => (
            <li key={`${x.kind}:${x.id}`}><Card><CardContent className="space-y-2 pt-5" data-testid="mod-item">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <Badge variant="secondary">{x.kind.toLowerCase()}</Badge>
                <Badge variant={x.status === "PUBLISHED" ? "success" : x.status === "HELD" ? "warning" : "destructive"}>{x.status.toLowerCase()}</Badge>
                {x.stars != null && <Stars value={x.stars} size={13} />}
                <b className="min-w-0 break-words">{x.product}</b>
                <span className="text-xs text-muted-foreground">by {x.author} · {x.createdAt.toISOString().slice(0, 10)}</span>
              </div>
              {x.text && <p className="whitespace-pre-line break-words text-sm">{x.text}</p>}
              {x.photos > 0 && (
                <div className="flex gap-2">
                  {Array.from({ length: x.photos }, (_, i) => (
                    <a key={i} href={`/api/reviews/photos/${x.id}/${i}`} target="_blank" rel="noreferrer">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={`/api/reviews/photos/${x.id}/${i}`} alt="" className="size-16 rounded border object-cover" />
                    </a>
                  ))}
                </div>
              )}
              {x.reasons.length > 0 && <p className="text-xs text-amber-700 dark:text-warning">Held for: {x.reasons.map((r) => HOLD[r] ?? r).join(", ")}</p>}
              {x.reports > 0 && <p className="text-xs text-muted-foreground">{x.reports} open report{x.reports === 1 ? "" : "s"}: {x.reportReasons.map((r) => `${REASON[r.reason] ?? r.reason}${r.note ? ` (“${r.note}”)` : ""}`).join("; ")}</p>}
              {x.hiddenReason && <p className="text-xs text-destructive">Hidden: {x.hiddenReason}</p>}
              <ModerateButtons kind={x.kind} id={x.id} status={x.status} />
            </CardContent></Card></li>
          ))}
        </ul>
      )}
      {v.pageCount > 1 && <p className="mt-4 flex justify-between text-sm">{v.page > 1 ? <Link href={href({ page: String(v.page - 1) })} className="text-primary hover:underline">← Previous</Link> : <span />}<span className="text-muted-foreground">Page {v.page} of {v.pageCount}</span>{v.page < v.pageCount ? <Link href={href({ page: String(v.page + 1) })} className="text-primary hover:underline">Next →</Link> : <span />}</p>}
    </>
  );
}
