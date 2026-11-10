import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { unsubscribe } from "@/server/marketing/campaigns";
import { BRAND_SLOGAN } from "@/config/brand";

export const metadata = { title: "Unsubscribe" };
export const dynamic = "force-dynamic";

/** Public page behind the unsubscribe link in campaign e-mails (no sign-in needed). */
export default async function UnsubscribePage({ params }: { params: Promise<{ token: string }> }) {
  const [ok, t] = await Promise.all([unsubscribe((await params).token), getTranslations("marketing")]);
  return (
    <main className="grid min-h-dvh place-items-center bg-background p-6">
      <div className="gloss w-full max-w-md rounded-2xl border bg-card p-8 text-center shadow-lg" data-testid="unsubscribed">
        <div className="mb-4"><b className="text-gradient text-2xl tracking-widest">FIRINGI</b><div className="text-[10px] tracking-[0.3em] text-muted-foreground">{BRAND_SLOGAN}</div></div>
        <h1 className="mb-2 text-xl font-semibold">{ok ? t("unsubscribedTitle") : t("invalidLink")}</h1>
        {ok && <p className="text-sm text-muted-foreground">{t("unsubscribedBody")}</p>}
        <Link href="/login" className="mt-6 inline-block text-sm text-primary hover:underline">FIRINGI →</Link>
      </div>
    </main>
  );
}
