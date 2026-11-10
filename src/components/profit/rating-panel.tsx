/** Rating of a delivered order: the customer rates it, the supplier answers (translated). */
import { getTranslations } from "next-intl/server";
import type { Ctx } from "@/server/context";
import { orderRatingFor } from "@/server/services/performance";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { RateOrderForm, ReplyRatingForm } from "./forms";

const stars = (n: number | null) => (n === null ? "—" : `${"★".repeat(n)}${"☆".repeat(5 - n)}`);

export async function RatingPanel({ ctx, orderId, status, role }: { ctx: Ctx; orderId: string; status: string; role: "BUYER" | "VENDOR" | "ADMIN" }) {
  if (status !== "DELIVERED" || role === "ADMIN") return null;
  const [t, r] = await Promise.all([getTranslations("ratings"), orderRatingFor(ctx, orderId)]);
  if (role === "VENDOR" && (!r || r.hidden)) return null;
  return (
    <Card className="tile gloss tone-orange motion-rise" data-testid="rating-panel">
      <CardHeader><CardTitle>{role === "BUYER" ? (r ? t("yourRating") : t("title")) : t("customerRating")}</CardTitle></CardHeader>
      <CardContent className="text-sm">
        {role === "BUYER" ? (
          <>
            <RateOrderForm orderId={orderId} initial={r && { stars: r.stars, deliveryStars: r.deliveryStars, comment: r.comment }}
              l={{ order: t("order"), delivery: t("delivery"), comment: t("comment"), send: t("send"), update: t("update"), thanks: t("thanks") }} />
            {r?.reply && <p className="mt-3 rounded-md border bg-card p-2"><b>{t("answer")}:</b> {r.reply}</p>}
          </>
        ) : (
          <>
            <div className="flex flex-wrap gap-x-6 gap-y-1">
              <span>{t("order")}: <span className="text-[color:var(--vivid-orange)]">{stars(r!.stars)}</span></span>
              <span>{t("delivery")}: <span className="text-[color:var(--vivid-orange)]">{stars(r!.deliveryStars)}</span></span>
            </div>
            {r!.comment && <p className="mt-2 italic">“{r!.comment}”</p>}
            <ReplyRatingForm id={r!.id} reply={r!.reply} l={{ reply: t("reply"), send: t("send") }} />
          </>
        )}
      </CardContent>
    </Card>
  );
}
