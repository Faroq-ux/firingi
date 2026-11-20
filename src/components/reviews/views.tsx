/** Product reviews & questions (Phase 53) — server-rendered views for buyers and suppliers. */
import Link from "next/link";
import { MessageCircleQuestion, Star } from "lucide-react";
import type { Ctx } from "@/server/context";
import { can } from "@/server/rbac/guard";
import { aiSummaryStatus, cardRatings, reviewSettingsCached, myReviews, productQuestions, productReviews, vendorInsights, vendorQuestions, vendorReviewAccess, vendorReviews, type ReviewSort } from "@/server/reviews/service";
import { pickLocalized } from "@/i18n/config";
import { DETAILS } from "@/lib/reviews";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Stars, StarBar } from "./stars";
import { avgText, dateText, fill, reviewLabels } from "./labels";
import { AiSummary, AnswerForm, AskForm, DeletePost, DeleteReview, HelpfulButton, ReplyForm, ReportButton, ReviewForm } from "./client";

type L = Record<string, string>;
const SORTS: ReviewSort[] = ["recent", "helpful", "high", "low"];

function Author({ a, l }: { a: { kind: "NAME" | "TYPE"; name: string | null; type: string; flag: string | null }; l: L }) {
  return (
    <span className="text-sm">
      <span className="font-medium">{a.kind === "NAME" ? a.name : l[`type.${a.type}`] ?? l.verifiedBuyer}</span>{" "}
      <span className="text-xs text-muted-foreground">{a.flag ?? ""} · <span className="inline-flex items-center gap-0.5 text-[color:var(--success,#16a34a)]">✓ {l.verifiedBuyer}</span></span>
    </span>
  );
}

function Photos({ id, n }: { id: string; n: number }) {
  if (!n) return null;
  return (
    <div className="flex flex-wrap gap-2" data-testid="review-photos-shown">
      {Array.from({ length: n }, (_, i) => (
        <a key={i} href={`/api/reviews/photos/${id}/${i}`} target="_blank" rel="noreferrer" className="block">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={`/api/reviews/photos/${id}/${i}`} alt="" loading="lazy" className="size-20 rounded-lg border object-cover sm:size-24" />
        </a>
      ))}
    </div>
  );
}

const holdText = (reasons: string[], l: L) => reasons.map((r) => l[`hold.${r}`] ?? r).join(", ");

/** The reviews + questions part of a product page. `sp` carries rsort / rstars / rphotos / rpage. */
export async function ProductReviewsSection({ ctx, offerId, sp }: { ctx: Ctx; offerId: string; sp: { rsort?: string; rstars?: string; rphotos?: string; rpage?: string } }) {
  const sort = (SORTS as string[]).includes(sp.rsort ?? "") ? (sp.rsort as ReviewSort) : "recent";
  const stars = Number(sp.rstars) >= 1 && Number(sp.rstars) <= 5 ? Number(sp.rstars) : null;
  const photos = sp.rphotos === "1";
  const v = await productReviews(ctx, offerId, { sort, stars, photos, page: Number(sp.rpage) || 1 }).catch(() => null);
  if (!v || !v.on) return null;
  const [{ l, locale }, qa, ai] = await Promise.all([reviewLabels(), productQuestions(ctx, offerId), aiSummaryStatus()]);
  const s = v.settings;
  const base = `/buy/catalogue/offers/${offerId}`;
  const qs = (o: Record<string, string | null>) => {
    const p = new URLSearchParams(Object.entries({ rsort: sort === "recent" ? null : sort, rstars: stars ? String(stars) : null, rphotos: photos ? "1" : null, ...o }).filter(([, x]) => x) as [string, string][]);
    const q = p.toString();
    return `${base}${q ? `?${q}` : ""}#reviews`;
  };
  return (
    <div className="mt-8 space-y-6">
      <Card id="reviews" data-testid="product-reviews">
        <CardHeader><CardTitle className="flex flex-wrap items-center gap-2"><Star className="size-5" aria-hidden /> {l.title}</CardTitle></CardHeader>
        <CardContent className="space-y-5">
          <div className="grid gap-5 md:grid-cols-[16rem_1fr]">
            <div className="space-y-3">
              {v.stat.count > 0 ? (
                <div>
                  <div className="flex items-end gap-2"><span className="text-4xl font-bold tabular-nums" data-testid="review-avg">{avgText(v.stat.avg, locale)}</span><span className="pb-1 text-sm text-muted-foreground">/ 5</span></div>
                  <Stars value={v.stat.avg} size={20} label={fill(l.ratingAria, { avg: avgText(v.stat.avg, locale), count: v.stat.count })} />
                  <p className="text-sm text-muted-foreground" data-testid="review-count">{fill(l.basedOn, { count: v.stat.count })}</p>
                </div>
              ) : <p className="text-sm text-muted-foreground" data-testid="no-reviews">{l.noReviews}</p>}
              {v.stat.count > 0 && <div className="space-y-0.5">{[5, 4, 3, 2, 1].map((n) => <StarBar key={n} stars={n} count={v.stat.dist[n - 1]} total={v.stat.count} href={qs({ rstars: stars === n ? null : String(n), rpage: null })} active={stars === n} />)}</div>}
              {s.parts.details && DETAILS.some((d) => v.details[d] != null) && (
                <dl className="space-y-1 text-sm" data-testid="review-details">
                  {DETAILS.filter((d) => v.details[d] != null).map((d) => <div key={d} className="flex items-center justify-between gap-2"><dt className="min-w-0 text-muted-foreground">{l[`detail.${d}`]}</dt><dd className="flex items-center gap-1 tabular-nums"><Stars value={v.details[d]!} size={12} /> {avgText(v.details[d]!, locale)}</dd></div>)}
                </dl>
              )}
            </div>
            <div className="min-w-0 space-y-4">
              {ai.on && ai.configured && v.stat.count >= ai.minReviews && <AiSummary l={l} offerId={offerId} locale={locale} count={v.stat.count} />}
              {v.my && (
                <div className="rounded-xl border border-primary/30 bg-primary/5 p-3 text-sm" data-testid="my-review">
                  <div className="flex flex-wrap items-center gap-2"><span className="font-semibold">{l.yourReview}</span><Stars value={v.my.stars} size={14} /><Badge variant={v.my.status === "PUBLISHED" ? "success" : v.my.status === "HELD" ? "warning" : "destructive"} data-testid="my-review-status">{l[`status.${v.my.status}`]}</Badge></div>
                  {v.my.status === "HELD" && <p className="mt-1 text-xs text-muted-foreground">{fill(l.heldBecause, { reasons: holdText(v.my.holdReasons, l) })}</p>}
                  {v.my.status === "HIDDEN" && <p className="mt-1 text-xs text-destructive">{fill(l.hiddenBecause, { reason: v.my.hiddenReason ?? "" })}</p>}
                  {v.my.status !== "HIDDEN" && <div className="mt-2 flex flex-wrap items-start gap-2">{v.my.editable ? <ReviewForm l={l} offerId={offerId} mine={v.my} maxPhotos={s.parts.photos ? s.maxPhotos : 0} details={s.parts.details} maxChars={s.maxChars} /> : <span className="text-xs text-muted-foreground">{l.locked}</span>}<DeleteReview l={l} id={v.my.id} /></div>}
                </div>
              )}
              {!v.my && v.canWrite && <ReviewForm l={l} offerId={offerId} mine={null} maxPhotos={s.parts.photos ? s.maxPhotos : 0} details={s.parts.details} maxChars={s.maxChars} />}
              {!v.my && !v.canWrite && ctx.company.type !== "ADMIN" && <p className="text-xs text-muted-foreground" data-testid="review-only-verified">{l.onlyVerified}</p>}
              {v.stat.count > 0 && (
                <nav className="flex flex-wrap items-center gap-2 text-sm" aria-label={l.sortLabel}>
                  {SORTS.map((x) => <Link key={x} href={qs({ rsort: x === "recent" ? null : x, rpage: null })} className={`rounded-full border px-3 py-1 ${sort === x ? "border-primary bg-primary/10 font-medium text-primary" : "hover:bg-muted"}`} data-testid={`review-sort-${x}`}>{l[`sort.${x}`]}</Link>)}
                  {s.parts.photos && <Link href={qs({ rphotos: photos ? null : "1", rpage: null })} className={`rounded-full border px-3 py-1 ${photos ? "border-primary bg-primary/10 font-medium text-primary" : "hover:bg-muted"}`} data-testid="review-with-photos">{l.withPhotos}</Link>}
                  {(stars || photos) && <Link href={qs({ rstars: null, rphotos: null, rpage: null })} className="text-primary hover:underline">{l.filterAll}</Link>}
                </nav>
              )}
              <ul className="divide-y" data-testid="review-list">
                {v.reviews.map((r) => (
                  <li key={r.id} className="space-y-2 py-4" data-testid="review-item">
                    <div className="flex flex-wrap items-center gap-2"><Stars value={r.stars} size={14} /><Author a={r.author} l={l} /><span className="text-xs text-muted-foreground">{dateText(r.createdAt, locale)}{r.editedAt ? ` · ${l.edited}` : ""}</span>{r.status !== "PUBLISHED" && <Badge variant="warning">{l[`status.${r.status}`]}</Badge>}</div>
                    {s.parts.details && DETAILS.some((d) => r[d]) && <p className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">{DETAILS.filter((d) => r[d]).map((d) => <span key={d}>{l[`detail.${d}`]}: <b className="text-foreground">{r[d]}/5</b></span>)}</p>}
                    {r.body && <p className="whitespace-pre-line break-words text-sm">{r.body}</p>}
                    <Photos id={r.id} n={r.photos} />
                    {r.reply && (
                      <div className="ml-2 border-l-2 border-primary/40 pl-3 text-sm" data-testid="review-reply">
                        <p className="text-xs font-semibold text-muted-foreground">{l.supplierReply}{r.reply.at ? ` · ${dateText(r.reply.at, locale)}` : ""}</p>
                        <p className="whitespace-pre-line break-words">{r.reply.text}</p>
                        {!r.mine && <div className="mt-1"><ReportButton l={l} kind="REPLY" id={r.id} reported={r.replyReported} /></div>}
                      </div>
                    )}
                    {!r.mine && r.status === "PUBLISHED" && (
                      <div className="flex flex-wrap items-center gap-1">
                        {s.parts.helpful && <HelpfulButton l={l} id={r.id} count={r.helpful} voted={r.voted} disabled={!v.canVote} />}
                        <ReportButton l={l} kind="REVIEW" id={r.id} reported={r.reported} />
                      </div>
                    )}
                  </li>
                ))}
              </ul>
              {v.pageCount > 1 && (
                <div className="flex items-center justify-between gap-2 text-sm">
                  {v.page > 1 ? <Link href={qs({ rpage: String(v.page - 1) })} className="text-primary hover:underline">← {l.prev}</Link> : <span />}
                  <span className="text-muted-foreground">{fill(l.pageOf, { page: v.page, pages: v.pageCount })}</span>
                  {v.page < v.pageCount ? <Link href={qs({ rpage: String(v.page + 1) })} className="text-primary hover:underline">{l.next} →</Link> : <span />}
                </div>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
      {qa && (
        <Card id="questions" data-testid="product-questions">
          <CardHeader><CardTitle className="flex items-center gap-2"><MessageCircleQuestion className="size-5" aria-hidden /> {l.qaTitle}</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            {qa.questions.length === 0 && <p className="text-sm text-muted-foreground">{l.noQuestions}</p>}
            <ul className="space-y-4" data-testid="question-list">
              {qa.questions.map((q) => (
                <li key={q.id} className="rounded-xl border p-3" data-testid="question-item">
                  <div className="flex flex-wrap items-start gap-2">
                    <p className="min-w-0 flex-1 break-words text-sm font-medium"><span className="text-primary">{l.q}</span> {q.body}</p>
                    <span className="text-xs text-muted-foreground">{dateText(q.createdAt, locale)}</span>
                    {q.status !== "PUBLISHED" && <Badge variant="warning">{l[`status.${q.status}`]}</Badge>}
                    {q.mine && <DeletePost l={l} kind="QUESTION" id={q.id} />}
                  </div>
                  {q.answers.length === 0 && <p className="mt-1 text-xs text-muted-foreground">{l.noAnswerYet}</p>}
                  <ul className="mt-2 space-y-2">
                    {q.answers.map((a) => (
                      <li key={a.id} className="ml-2 border-l-2 pl-3 text-sm" data-testid="answer-item">
                        <p className="flex flex-wrap items-center gap-2 text-xs">
                          <span className="font-semibold">{l[`role.${a.role}`]}</span>
                          {a.role !== "BUYER" && <Badge variant="success" data-testid="official-answer">{l.official}</Badge>}
                          <span className="text-muted-foreground">{dateText(a.createdAt, locale)}</span>
                          {a.status !== "PUBLISHED" && <Badge variant="warning">{l[`status.${a.status}`]}</Badge>}
                        </p>
                        <p className="whitespace-pre-line break-words">{a.body}</p>
                        <div className="flex flex-wrap items-center gap-1">{a.mine ? <DeletePost l={l} kind="ANSWER" id={a.id} /> : a.status === "PUBLISHED" && <ReportButton l={l} kind="ANSWER" id={a.id} reported={a.reported} />}</div>
                      </li>
                    ))}
                  </ul>
                  <div className="mt-2 flex flex-wrap items-center gap-1">
                    {v.canAnswerAsBuyer && !q.mine && q.status === "PUBLISHED" && <AnswerForm l={l} questionId={q.id} compact />}
                    {!q.mine && q.status === "PUBLISHED" && <ReportButton l={l} kind="QUESTION" id={q.id} reported={q.reported} />}
                  </div>
                </li>
              ))}
            </ul>
            {v.canAsk && <AskForm l={l} offerId={offerId} />}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

/** Stars on a catalogue card (nothing when FIRINGI switched them off or there are no reviews). */
export async function CardStars({ productId, sellerId }: { productId: string; sellerId: string | null }) {
  const m = await cardRatings([{ productId, sellerId }]);
  const r = m.get(`${productId}:${sellerId ?? ""}`);
  if (!r) return null;
  const { l, locale } = await reviewLabels();
  return (
    <span className="inline-flex items-center gap-1 text-xs" data-testid="card-stars">
      <Stars value={r.avg} size={12} label={fill(l.ratingAria, { avg: avgText(r.avg, locale), count: r.count })} />
      <span className="tabular-nums font-medium">{avgText(r.avg, locale)}</span>
      <span className="text-muted-foreground">({r.count})</span>
    </span>
  );
}

/** "4★ and up" and "Best rated" chips above a product list. */
export async function RatingFilter({ base, params, minStars, sort }: { base: string; params: Record<string, string | string[] | null | undefined>; minStars: number | null; sort: string | null }) {
  const rs = await reviewSettingsCached();
  if (!rs.enabled || !rs.parts.reviews || !rs.parts.searchStars) return null;
  const { l } = await reviewLabels();
  const href = (o: Record<string, string | null>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...params, stars: minStars ? String(minStars) : null, sort, ...o })) {
      if (Array.isArray(v)) { if (v.length) p.set(k, v.join(",")); } else if (v) p.set(k, v);
    }
    const q = p.toString();
    return `${base}${q ? `?${q}` : ""}`;
  };
  const chip = (on: boolean) => `inline-flex items-center gap-1 rounded-full border px-3 py-1 text-sm ${on ? "border-primary bg-primary/10 font-medium text-primary" : "hover:bg-muted"}`;
  return (
    <div className="mb-3 flex flex-wrap items-center gap-2" data-testid="rating-filter">
      <Link href={href({ stars: minStars === 4 ? null : "4", page: null })} className={chip(minStars === 4)} data-testid="filter-4stars"><Star className="size-3.5 fill-amber-400 text-amber-500" aria-hidden /> {l.minStars}</Link>
      <Link href={href({ sort: sort === "rating" ? null : "rating", page: null })} className={chip(sort === "rating")} data-testid="sort-rating">{l.sortRating}</Link>
    </div>
  );
}

// ── buyer: My Reviews ───────────────────────────────────────────────────────

export async function MyReviewsView({ ctx }: { ctx: Ctx }) {
  const [{ l, locale }, m] = await Promise.all([reviewLabels(), myReviews(ctx, "en").catch(() => ({ on: false as const }))]);
  if (!m.on) return <p className="py-8 text-center text-muted-foreground" data-testid="reviews-off">{l.off}</p>;
  const mm = await myReviews(ctx, locale);
  if (!mm.on) return null;
  return (
    <div className="space-y-6">
      <Card data-testid="reviews-todo">
        <CardHeader><CardTitle>{l.todo} <span className="text-sm font-normal text-muted-foreground">({mm.todoCount})</span></CardTitle></CardHeader>
        <CardContent>
          {mm.todo.length === 0 ? <p className="text-sm text-muted-foreground">{l.todoEmpty}</p> : (
            <ul className="divide-y">{mm.todo.map((t) => (
              <li key={t.offerId} className="flex flex-wrap items-center gap-2 py-2 text-sm">
                <span className="min-w-0 flex-1 break-words"><b>{t.product}</b><span className="block text-xs text-muted-foreground">{fill(l.deliveredIn, { order: t.order })}{t.supplier ? ` · ${t.supplier}` : ""} · {dateText(t.deliveredAt, locale)}</span></span>
                {can(ctx, "buyer.reviews.write") && <Link href={`/buy/catalogue/offers/${t.offerId}#write-review`} className="inline-flex h-8 items-center gap-1 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground" data-testid="todo-review"><Star className="size-3.5" aria-hidden /> {l.reviewIt}</Link>}
              </li>
            ))}</ul>
          )}
        </CardContent>
      </Card>
      <Card data-testid="reviews-mine">
        <CardHeader><CardTitle>{l.myReviews}</CardTitle></CardHeader>
        <CardContent>
          {mm.reviews.length === 0 ? <p className="text-sm text-muted-foreground">{l.noMine}</p> : (
            <ul className="divide-y">{mm.reviews.map((r) => (
              <li key={r.id} className="space-y-1 py-3 text-sm">
                <div className="flex flex-wrap items-center gap-2"><b className="min-w-0 break-words">{r.product}</b><Stars value={r.stars} size={13} /><Badge variant={r.status === "PUBLISHED" ? "success" : r.status === "HELD" ? "warning" : "destructive"}>{l[`status.${r.status}`]}</Badge>{r.helpful > 0 && <span className="text-xs text-muted-foreground">{fill(l.helpfulCount, { count: r.helpful })}</span>}</div>
                {r.body && <p className="line-clamp-3 whitespace-pre-line break-words text-muted-foreground">{r.body}</p>}
                {r.status === "HELD" && <p className="text-xs text-muted-foreground">{fill(l.heldBecause, { reasons: holdText(r.holdReasons, l) })}</p>}
                {r.status === "HIDDEN" && <p className="text-xs text-destructive">{fill(l.hiddenBecause, { reason: r.hiddenReason ?? "" })}</p>}
                {r.reply && <p className="border-l-2 border-primary/40 pl-2 text-xs"><b>{l.supplierReply}:</b> {r.reply}</p>}
                {r.offerId && <Link href={`/buy/catalogue/offers/${r.offerId}#reviews`} className="text-xs text-primary hover:underline">{l.openProduct} →</Link>}
              </li>
            ))}</ul>
          )}
        </CardContent>
      </Card>
      <Card data-testid="questions-mine">
        <CardHeader><CardTitle>{l.myQuestions}</CardTitle></CardHeader>
        <CardContent>
          {mm.questions.length === 0 ? <p className="text-sm text-muted-foreground">{l.noQuestions}</p> : (
            <ul className="divide-y">{mm.questions.map((q) => (
              <li key={q.id} className="space-y-1 py-3 text-sm">
                <p className="break-words"><b>{q.product}</b> — {q.body} {q.status !== "PUBLISHED" && <Badge variant="warning">{l[`status.${q.status}`]}</Badge>}</p>
                {q.answers.length === 0 ? <p className="text-xs text-muted-foreground">{l.noAnswerYet}</p> : q.answers.map((a, i) => <p key={i} className="border-l-2 pl-2 text-xs"><b>{l[`role.${a.role}`]}:</b> {a.body}</p>)}
              </li>
            ))}</ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ── supplier ────────────────────────────────────────────────────────────────

const FILTERS = ["all", "unreplied", "low", "held"] as const;

export async function VendorReviewsView({ ctx, filter, page, productId }: { ctx: Ctx; filter?: string; page?: number; productId?: string | null }) {
  const [{ l, locale }, acc] = await Promise.all([reviewLabels(), vendorReviewAccess(ctx)]);
  if (!acc.on) return <p className="py-8 text-center text-muted-foreground" data-testid="reviews-off">{l.vendorOff}</p>;
  const f = (FILTERS as readonly string[]).includes(filter ?? "") ? (filter as (typeof FILTERS)[number]) : "all";
  const v = await vendorReviews(ctx, { filter: f, page, productId });
  const replies = acc.settings.parts.replies;
  return (
    <div className="space-y-4">
      <nav className="flex flex-wrap gap-2 text-sm">{FILTERS.map((x) => <Link key={x} href={`/vendor/reviews${x === "all" ? "" : `?filter=${x}`}`} className={`rounded-full border px-3 py-1 ${f === x ? "border-primary bg-primary/10 font-medium text-primary" : "hover:bg-muted"}`} data-testid={`vfilter-${x}`}>{l[`filter.${x}`]}</Link>)}</nav>
      {v.items.length === 0 ? <p className="py-8 text-center text-muted-foreground">{l.noReviews}</p> : (
        <ul className="space-y-3" data-testid="vendor-review-list">
          {v.items.map((r) => (
            <li key={r.id}><Card><CardContent className="space-y-2 pt-5" data-testid="vendor-review">
              <div className="flex flex-wrap items-center gap-2"><b className="min-w-0 break-words">{pickLocalized(r.product as Record<string, string>, locale)}</b><Stars value={r.stars} size={14} /><Author a={r.author} l={l} /><span className="text-xs text-muted-foreground">{dateText(r.createdAt, locale)}</span>{r.helpful > 0 && <span className="text-xs text-muted-foreground">{fill(l.helpfulCount, { count: r.helpful })}</span>}</div>
              {DETAILS.some((d) => r[d]) && <p className="flex flex-wrap gap-x-3 text-xs text-muted-foreground">{DETAILS.filter((d) => r[d]).map((d) => <span key={d}>{l[`detail.${d}`]}: <b className="text-foreground">{r[d]}/5</b></span>)}</p>}
              {r.body && <p className="whitespace-pre-line break-words text-sm">{r.body}</p>}
              <Photos id={r.id} n={r.photos} />
              {r.reply && (
                <div className="ml-2 border-l-2 border-primary/40 pl-3 text-sm" data-testid="vendor-reply">
                  <p className="flex flex-wrap items-center gap-2 text-xs font-semibold text-muted-foreground">{l.yourReply}{r.replyStatus && r.replyStatus !== "PUBLISHED" && <Badge variant={r.replyStatus === "HELD" ? "warning" : "destructive"}>{l[`replyStatus.${r.replyStatus}`]}</Badge>}</p>
                  <p className="whitespace-pre-line break-words">{r.reply}</p>
                </div>
              )}
              {replies && r.replyStatus !== "HIDDEN" && <ReplyForm l={l} id={r.id} initial={r.reply} />}
            </CardContent></Card></li>
          ))}
        </ul>
      )}
      {v.pageCount > 1 && <p className="flex justify-between text-sm">{v.page > 1 ? <Link className="text-primary hover:underline" href={`/vendor/reviews?filter=${f}&page=${v.page - 1}`}>← {l.prev}</Link> : <span />}<span className="text-muted-foreground">{fill(l.pageOf, { page: v.page, pages: v.pageCount })}</span>{v.page < v.pageCount ? <Link className="text-primary hover:underline" href={`/vendor/reviews?filter=${f}&page=${v.page + 1}`}>{l.next} →</Link> : <span />}</p>}
    </div>
  );
}

export async function VendorQuestionsView({ ctx, open, page }: { ctx: Ctx; open: boolean; page?: number }) {
  const [{ l, locale }, acc] = await Promise.all([reviewLabels(), vendorReviewAccess(ctx)]);
  if (!acc.on || !acc.settings.parts.questions) return <p className="py-8 text-center text-muted-foreground" data-testid="reviews-off">{l.vendorOff}</p>;
  const v = await vendorQuestions(ctx, { open, page });
  return (
    <div className="space-y-4">
      <nav className="flex flex-wrap gap-2 text-sm">
        <Link href="/vendor/reviews/questions" className={`rounded-full border px-3 py-1 ${open ? "border-primary bg-primary/10 font-medium text-primary" : "hover:bg-muted"}`} data-testid="vq-open">{l.openOnly}</Link>
        <Link href="/vendor/reviews/questions?all=1" className={`rounded-full border px-3 py-1 ${!open ? "border-primary bg-primary/10 font-medium text-primary" : "hover:bg-muted"}`} data-testid="vq-all">{l.allQ}</Link>
      </nav>
      {v.items.length === 0 ? <p className="py-8 text-center text-muted-foreground">{l.noQuestions}</p> : (
        <ul className="space-y-3" data-testid="vendor-question-list">
          {v.items.map((q) => (
            <li key={q.id}><Card><CardContent className="space-y-2 pt-5" data-testid="vendor-question">
              <p className="text-xs text-muted-foreground">{pickLocalized(q.product as Record<string, string>, locale)} · {dateText(q.createdAt, locale)}</p>
              <p className="break-words font-medium"><span className="text-primary">{l.q}</span> {q.body}</p>
              {q.answers.map((a) => <p key={a.id} className="ml-2 border-l-2 pl-3 text-sm"><b className="text-xs">{a.mine ? l.youAnswered : l[`role.${a.role}`]}</b> {a.status !== "PUBLISHED" && <Badge variant="warning">{l[`status.${a.status}`]}</Badge>}<br />{a.body}</p>)}
              {!q.answered && <AnswerForm l={l} questionId={q.id} />}
            </CardContent></Card></li>
          ))}
        </ul>
      )}
      {v.pageCount > 1 && <p className="text-center text-sm text-muted-foreground">{fill(l.pageOf, { page: v.page, pages: v.pageCount })} · {v.page < v.pageCount && <Link className="text-primary hover:underline" href={`/vendor/reviews/questions?${open ? "" : "all=1&"}page=${v.page + 1}`}>{l.next} →</Link>}</p>}
    </div>
  );
}

export async function VendorInsightsView({ ctx }: { ctx: Ctx }) {
  const [{ l, locale }, acc] = await Promise.all([reviewLabels(), vendorReviewAccess(ctx)]);
  if (!acc.on || !acc.settings.parts.insights) return <p className="py-8 text-center text-muted-foreground" data-testid="reviews-off">{l.vendorOff}</p>;
  const v = await vendorInsights(ctx);
  if (!v || v.count === 0) return <p className="py-8 text-center text-muted-foreground" data-testid="insights-empty">{l.noInsights}</p>;
  const maxN = Math.max(1, ...v.trend.map((t) => t.count));
  const tile = (label: string, value: string, testid?: string) => <Card><CardContent className="pt-5"><p className="text-xs text-muted-foreground">{label}</p><p className="text-2xl font-semibold tabular-nums" data-testid={testid}>{value}</p></CardContent></Card>;
  return (
    <div className="space-y-6" data-testid="review-insights">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        {tile(l.avgRating, `${avgText(v.avg, locale)} ★`, "ins-avg")}
        {tile(l.reviewsCount, String(v.count), "ins-count")}
        {tile(l.last90, String(v.last90))}
        {tile(l.replyRate, v.replyRate == null ? "—" : `${v.replyRate} %`)}
        {tile(l.openQuestions, String(v.openQuestions))}
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>{l.trend}</CardTitle></CardHeader>
          <CardContent>
            <div className="flex h-40 items-end gap-1" role="img" aria-label={l.trend}>
              {v.trend.map((t) => (
                <div key={t.month} className="flex min-w-0 flex-1 flex-col items-center gap-1" title={`${t.month}: ${t.avg == null ? "—" : avgText(t.avg, locale)} (${t.count})`}>
                  <span className="text-[10px] tabular-nums text-muted-foreground">{t.avg == null ? "" : avgText(t.avg, locale)}</span>
                  <div className="w-full rounded-t bg-amber-400/80 dark:bg-amber-300/80" style={{ height: `${t.avg == null ? 0 : (t.avg / 5) * 100}%`, minHeight: t.avg == null ? 0 : 4, opacity: 0.45 + 0.55 * (t.count / maxN) }} />
                  <span className="text-[10px] text-muted-foreground">{t.month.slice(5)}</span>
                </div>
              ))}
            </div>
            <div className="mt-4 space-y-0.5">{[5, 4, 3, 2, 1].map((n) => <StarBar key={n} stars={n} count={v.dist[n - 1]} total={v.count} />)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>{l.complaints}</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            {v.complaints.length === 0 ? <p className="text-sm text-muted-foreground">{l.noComplaints}</p> : (
              <ul className="space-y-1.5" data-testid="ins-complaints">{v.complaints.map((c) => <li key={c.theme} className="flex items-center justify-between gap-2 text-sm"><span>{l[`theme.${c.theme}`]}</span><Badge variant="warning">{fill(l.mentions, { count: c.count })}</Badge></li>)}</ul>
            )}
            <dl className="space-y-1 border-t pt-3 text-sm">{DETAILS.filter((d) => v.details[d] != null).map((d) => <div key={d} className="flex items-center justify-between gap-2"><dt className="text-muted-foreground">{l[`detail.${d}`]}</dt><dd className="flex items-center gap-1 tabular-nums"><Stars value={v.details[d]!} size={12} /> {avgText(v.details[d]!, locale)}</dd></div>)}</dl>
          </CardContent>
        </Card>
      </div>
      <Card>
        <CardHeader><CardTitle>{l.perProduct}</CardTitle></CardHeader>
        <CardContent>
          <ul className="divide-y" data-testid="ins-products">{v.products.map((p) => (
            <li key={p.productId} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2 text-sm">
              <Link href={`/vendor/reviews?product=${p.productId}`} className="min-w-0 flex-1 break-words font-medium hover:text-primary">{pickLocalized(p.name as Record<string, string>, locale)}</Link>
              <span className="flex items-center gap-1 tabular-nums"><Stars value={p.avg} size={12} /> {avgText(p.avg, locale)} <span className="text-muted-foreground">({p.count})</span></span>
              {p.change != null && <span className={`tabular-nums text-xs ${p.change < 0 ? "text-destructive" : "text-[color:var(--success,#16a34a)]"}`}>{p.change > 0 ? "+" : ""}{avgText(p.change, locale)} · {l.change}</span>}
              {p.complaints.length > 0 && <span className="flex flex-wrap gap-1">{p.complaints.map((c) => <Badge key={c.theme} variant="secondary">{l[`theme.${c.theme}`]} {c.count}</Badge>)}</span>}
            </li>
          ))}</ul>
        </CardContent>
      </Card>
    </div>
  );
}
