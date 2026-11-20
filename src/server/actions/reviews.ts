"use server";
/** Product reviews & questions actions (Phase 53). The service checks rights again (verified purchase, supplier, FIRINGI's switches). */
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { defineAction, runAction } from "./_action";
import * as S from "@/server/reviews/service";
import { REPORT_REASONS, REVIEW_BUYER_TYPES, REVIEW_PARTS, REVIEW_SELLER_TYPES } from "@/lib/reviews";
import { ValidationError } from "@/server/errors";

const id = z.string().min(1).max(64);
const KIND = z.enum(["REVIEW", "REPLY", "QUESTION", "ANSWER"]);
const done = <T>(v: T) => {
  for (const p of ["/buy/catalogue", "/buy/reviews", "/vendor/reviews", "/admin/reviews"]) revalidatePath(p, "layout");
  revalidatePath("/admin/settings/reviews");
  return v;
};
const str = (v: FormDataEntryValue | null) => (typeof v === "string" ? v : "");
const score = (v: FormDataEntryValue | null) => { const n = Number(str(v)); return Number.isInteger(n) && n >= 1 && n <= 5 ? n : null; };

/** Write / edit a review (multipart: stars, details, body, showName, keep = indexes of old photos to keep, photos). */
export async function saveReviewAction(fd: FormData) {
  return runAction(async (ctx) => {
    const stars = score(fd.get("stars"));
    if (!stars) throw new ValidationError("Choose 1 to 5 stars.");
    const r = await S.saveReview(ctx, {
      offerId: id.parse(str(fd.get("offerId"))), stars,
      quality: score(fd.get("quality")), value: score(fd.get("value")), packaging: score(fd.get("packaging")), freshness: score(fd.get("freshness")),
      body: str(fd.get("body")).slice(0, 5000), showName: str(fd.get("showName")) === "1", language: str(fd.get("language")) || null,
      keep: fd.getAll("keep").map((v) => Number(v)).filter((n) => Number.isInteger(n) && n >= 0 && n < 3),
      photos: fd.getAll("photos").filter((v): v is File => v instanceof File && v.size > 0).slice(0, 3),
    });
    return done(r);
  });
}

export const deleteReviewAction = defineAction({ permission: "buyer.reviews.write", schema: z.object({ id }), handler: async (ctx, i) => done(await S.deleteReview(ctx, i.id)) });
export const voteHelpfulAction = defineAction({ permission: null, schema: z.object({ id, on: z.boolean() }), handler: async (ctx, i) => done(await S.voteHelpful(ctx, i.id, i.on)) });
export const reportContentAction = defineAction({
  permission: null,
  schema: z.object({ kind: KIND, id, reason: z.enum(REPORT_REASONS), note: z.string().max(500).nullable() }),
  handler: async (ctx, i) => done(await S.reportContent(ctx, i.kind, i.id, i.reason, i.note)),
});
export const replyToReviewAction = defineAction({ permission: "vendor.reviews.manage", schema: z.object({ id, text: z.string().min(1).max(5000) }), handler: async (ctx, i) => done(await S.replyToReview(ctx, i.id, i.text)) });
export const askQuestionAction = defineAction({ permission: "buyer.reviews.write", schema: z.object({ offerId: id, text: z.string().min(1).max(2000) }), handler: async (ctx, i) => done(await S.askQuestion(ctx, i.offerId, i.text)) });
export const answerQuestionAction = defineAction({ permission: null, schema: z.object({ id, text: z.string().min(1).max(4000) }), handler: async (ctx, i) => done(await S.answerQuestion(ctx, i.id, i.text)) });
export const deleteOwnPostAction = defineAction({ permission: null, schema: z.object({ kind: z.enum(["QUESTION", "ANSWER"]), id }), handler: async (ctx, i) => done(await S.deleteOwnPost(ctx, i.kind, i.id)) });
export const reviewSummaryAction = defineAction({ permission: "buyer.catalogue.view", schema: z.object({ offerId: id, locale: z.string().min(2).max(10) }), handler: async (ctx, i) => S.reviewSummary(ctx, i.offerId, i.locale) });

// FIRINGI
export const moderateAction = defineAction({
  permission: ["admin.reviews.moderate", "admin.settings.manage"],
  schema: z.object({ kind: KIND, id, action: z.enum(["PUBLISH", "HIDE"]), reason: z.string().max(300).nullable() }),
  handler: async (ctx, i) => done(await S.moderate(ctx, i.kind, i.id, i.action, i.reason)),
});
export const setReviewSwitchAction = defineAction({ permission: "admin.settings.manage", schema: z.object({ companyId: id, state: z.enum(["DEFAULT", "ON", "OFF"]) }), handler: async (ctx, i) => done(await S.setReviewSwitch(ctx, i.companyId, i.state)) });
const flags = <K extends string>(keys: readonly K[]) => z.object(Object.fromEntries(keys.map((k) => [k, z.boolean()])) as Record<K, z.ZodBoolean>);
export const saveReviewSettingsAction = defineAction({
  permission: "admin.settings.manage",
  schema: z.object({
    enabled: z.boolean(), buyers: flags(REVIEW_BUYER_TYPES), sellers: flags(REVIEW_SELLER_TYPES), parts: flags(REVIEW_PARTS),
    maxPhotos: z.number(), maxChars: z.number(), editDays: z.number(), autoHoldReports: z.number(), aiMinReviews: z.number(),
    filter: z.object({ contacts: z.boolean(), links: z.boolean(), insults: z.boolean(), competitors: z.array(z.string().max(60)).max(200), words: z.array(z.string().max(60)).max(200) }),
    reminder: z.object({ afterDays: z.number() }),
  }),
  handler: async (ctx, i) => {
    const before = await S.reviewSettings();
    const v = await S.saveReviewSettings(ctx, i);
    if (JSON.stringify(before.sellers) !== JSON.stringify(v.sellers) || before.enabled !== v.enabled) await S.recomputeAllStats();
    return done(v);
  },
});
