"use client";
/** My data: download a copy; ask FIRINGI to delete my account. */
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Download } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { requestErasureAction, withdrawErasureAction } from "@/server/actions/security";

export function PrivacyPanel({ request }: { request: { status: string; note: string | null; requestedAt: string } | null }) {
  const t = useTranslations("privacy");
  const router = useRouter();
  const [pending, start] = useTransition();
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const open = request?.status === "REQUESTED";
  return (
    <div className="space-y-4 text-sm" data-testid="privacy-panel">
      <div>
        <p className="mb-2 text-muted-foreground">{t("exportIntro")}</p>
        {/* Plain link: a download, not a page (no prefetch). */}
        <a href="/api/me/data" className={buttonVariants({ variant: "outline" })} data-testid="download-my-data"><Download className="h-4 w-4" />{t("export")}</a>
      </div>
      <div className="border-t pt-4">
        <p className="mb-2 text-muted-foreground">{t("eraseIntro")}</p>
        {open ? (
          <div className="flex flex-wrap items-center gap-2" data-testid="erasure-open">
            <span>{t("requested")}</span>
            <Button size="sm" variant="ghost" disabled={pending} onClick={() => start(async () => { await withdrawErasureAction({}); router.refresh(); })}>{t("withdraw")}</Button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <Input name="eraseReason" className="w-64" placeholder={t("reason")} value={reason} onChange={(e) => setReason(e.target.value)} />
            <Button variant="outline" disabled={pending} onClick={() => start(async () => { setError(null); const r = await requestErasureAction({ reason: reason || null }); if (r.ok) router.refresh(); else setError(r.error); })}>{t("erase")}</Button>
          </div>
        )}
        {request?.status === "REJECTED" && <p className="mt-2 text-destructive" data-testid="erasure-rejected">{t("rejected", { note: request.note ?? "" })}</p>}
        {error && <p className="mt-2 text-destructive" role="alert">{error}</p>}
      </div>
    </div>
  );
}
