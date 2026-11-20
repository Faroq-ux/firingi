/** Phase 50: the pay-later choice at checkout, with texts in the buyer's language. */
import "server-only";
import { getTranslations } from "next-intl/server";
import type { Ctx } from "@/server/context";
import { checkoutOptions } from "@/server/pay-later/service";
import { formatDate, formatMoney } from "@/lib/utils";
import type { PayLaterChoice } from "@/components/orders/cart-controls";

export async function payLaterChoiceFor(ctx: Ctx, gross: number, locale: string): Promise<PayLaterChoice | null> {
  const o = await checkoutOptions(ctx, gross).catch(() => null);
  if (!o?.available || !o.terms.length) return null;
  const t = await getTranslations("payLater");
  const money = (n: number) => formatMoney(n, locale);
  return {
    title: t("choose"), payNow: t("payNow"), note: t("checkNote"),
    options: o.terms.map((x) => ({
      id: x.id,
      label: x.kind === "DAYS" ? t("termDays", { days: x.days }) : t("termInstalments", { count: x.count }),
      detail: [x.fee > 0 ? t("fee", { amount: money(x.fee) }) : t("noFee"), x.kind === "DAYS" ? t("payBy", { date: formatDate(x.schedule[0].dueAt, locale) }) : t("eachMonth", { count: x.count, amount: money(x.schedule[0].amount), date: formatDate(x.schedule[0].dueAt, locale) })].join(" · "),
    })),
  };
}
