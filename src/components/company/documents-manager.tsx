"use client";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { FileText, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input, Label, Select } from "@/components/ui/input";
import { deleteDocumentAction, uploadDocumentAction } from "@/server/actions/onboarding";

export type DocRow = { id: string; type: string; fileName: string; status: string; reviewNote: string | null; createdAt: string; expiresAt: string | null };
const VARIANT: Record<string, "warning" | "success" | "destructive" | "secondary"> = { PENDING: "warning", APPROVED: "success", REJECTED: "destructive", EXPIRED: "destructive", REVOKED: "destructive" };

export function DocumentsManager({ rows, types, required, target = "company", canEdit }: {
  rows: DocRow[]; types: string[]; required: string[]; target?: "company" | "driver"; canEdit: boolean;
}) {
  const t = useTranslations("onboarding");
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const firstMissing = required.find((r) => !rows.some((d) => d.type === r && d.status !== "REJECTED")) ?? types[0];

  return (
    <div className="space-y-4">
      <ul className="divide-y rounded-lg border">
        {rows.length === 0 && <li className="p-3 text-sm text-muted-foreground">{t("docs.none")}</li>}
        {rows.map((d) => (
          <li key={d.id} className="flex flex-wrap items-center gap-3 p-3 text-sm">
            <FileText className="size-4 text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <div className="font-medium">{t(`docTypes.${d.type}`)}</div>
              <div className="truncate text-xs text-muted-foreground">{d.fileName} · {d.createdAt.slice(0, 10)}{d.expiresAt ? ` → ${d.expiresAt.slice(0, 10)}` : ""}</div>
              {d.reviewNote && <div className="text-xs text-destructive">{t("docs.note")}: {d.reviewNote}</div>}
            </div>
            <Badge variant={VARIANT[d.status] ?? "secondary"}>{t(`review.${d.status}`)}</Badge>
            <a className="text-primary hover:underline" href={`/api/files/${d.id}`} target="_blank" rel="noreferrer">{t("docs.view")}</a>
            {canEdit && d.status !== "APPROVED" && (
              <Button size="sm" variant="ghost" className="text-destructive" disabled={pending}
                onClick={() => start(async () => { await deleteDocumentAction({ id: d.id }); router.refresh(); })}>
                {t("docs.withdraw")}
              </Button>
            )}
          </li>
        ))}
      </ul>
      {canEdit && (
        <form
          ref={formRef}
          className="grid items-end gap-3 rounded-lg border border-dashed p-3 sm:grid-cols-[1fr_1fr_auto_auto]"
          onSubmit={(e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            fd.set("target", target);
            setError(null);
            start(async () => {
              const r = await uploadDocumentAction(fd);
              if (r.ok) { formRef.current?.reset(); router.refresh(); } else setError(r.error);
            });
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="doc-type">{t("docs.type")}</Label>
            <Select id="doc-type" name="type" defaultValue={firstMissing}>
              {types.map((ty) => <option key={ty} value={ty}>{t(`docTypes.${ty}`)}{required.includes(ty) ? ` (${t("docs.required")})` : ""}</option>)}
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="doc-file">{t("docs.file")}</Label>
            <Input id="doc-file" name="file" type="file" accept="application/pdf,image/jpeg,image/png,image/webp" required />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="doc-exp">{t("docs.expiresAt")}</Label>
            <Input id="doc-exp" name="expiresAt" type="date" />
          </div>
          <Button type="submit" disabled={pending}><Upload /> {pending ? t("docs.uploading") : t("docs.upload")}</Button>
          <p className="text-xs text-muted-foreground sm:col-span-4">{t("docs.fileHint")}</p>
          {error && <p className="text-sm text-destructive sm:col-span-4">{error}</p>}
        </form>
      )}
    </div>
  );
}
