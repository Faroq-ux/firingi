"use client";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input, Label } from "@/components/ui/input";
import { requestRestrictionAction } from "@/server/actions/onboarding";

export type RestrictionRow = { restriction: "TOBACCO" | "ALCOHOL"; status: string | null; validUntil: string | null; reviewNote: string | null };

function Panel({ row }: { row: RestrictionRow }) {
  const t = useTranslations("onboarding");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const active = row.status === "APPROVED" && (!row.validUntil || row.validUntil > new Date().toISOString());
  const canRequest = !active && row.status !== "PENDING";
  return (
    <div className="space-y-3 rounded-lg border p-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-semibold">{t(`restricted.${row.restriction}`)}</h3>
        {row.status ? (
          <Badge variant={active ? "success" : row.status === "PENDING" ? "warning" : "destructive"}>
            {active && row.validUntil ? t("restricted.accessUntil", { date: row.validUntil.slice(0, 10) }) : t(`review.${row.status}`)}
          </Badge>
        ) : <Badge variant="secondary">{t("restricted.notRequested")}</Badge>}
      </div>
      {row.reviewNote && <p className="text-sm text-muted-foreground">{t("restricted.note")}: {row.reviewNote}</p>}
      {canRequest && !open && <Button variant="outline" onClick={() => setOpen(true)}>{t("restricted.request")}</Button>}
      {open && (
        <form
          className="grid gap-3 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            fd.set("restriction", row.restriction);
            start(async () => {
              const r = await requestRestrictionAction(fd);
              if (r.ok) { setOpen(false); router.refresh(); } else setError(r.error);
            });
          }}
        >
          <div className="space-y-1.5"><Label htmlFor={`ln-${row.restriction}`}>{t("restricted.licenceNumber")}</Label><Input id={`ln-${row.restriction}`} name="licenceNumber" required /></div>
          <div className="space-y-1.5"><Label htmlFor={`ia-${row.restriction}`}>{t("restricted.issuingAuthority")}</Label><Input id={`ia-${row.restriction}`} name="issuingAuthority" required /></div>
          <div className="space-y-1.5"><Label htmlFor={`vu-${row.restriction}`}>{t("restricted.validUntil")}</Label><Input id={`vu-${row.restriction}`} name="validUntil" type="date" /></div>
          <div className="space-y-1.5"><Label htmlFor={`f-${row.restriction}`}>{t("docs.file")}</Label><Input id={`f-${row.restriction}`} name="file" type="file" accept="application/pdf,image/jpeg,image/png,image/webp" required /></div>
          {error && <p className="text-sm text-destructive sm:col-span-2">{error}</p>}
          <div className="flex gap-2 sm:col-span-2">
            <Button type="submit" disabled={pending}>{pending ? t("restricted.requesting") : t("restricted.request")}</Button>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>{t("addr.cancel")}</Button>
          </div>
        </form>
      )}
    </div>
  );
}

export function RestrictedAccess({ rows }: { rows: RestrictionRow[] }) {
  return <div className="grid gap-4 md:grid-cols-2">{rows.map((r) => <Panel key={r.restriction} row={r} />)}</div>;
}
