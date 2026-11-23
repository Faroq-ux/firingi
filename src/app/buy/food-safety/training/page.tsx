import { notFound } from "next/navigation";
import { GraduationCap } from "lucide-react";
import { pagePermission, pagePortal, can } from "@/server/rbac/guard";
import { haccpAccess, trainings } from "@/server/haccp/service";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { haccpLabels } from "@/components/haccp/labels";
import { dayText, stateTone } from "@/components/haccp/text";
import { DeleteTraining, TrainingForm } from "@/components/haccp/client";

export const metadata = { title: "Food Safety Training" };
export const dynamic = "force-dynamic";
const iso = (d: Date) => d.toISOString().slice(0, 10);

/** Phase 69: food-handler training and certificates, with a warning before they run out. */
export default async function FoodSafetyTraining() {
  const ctx = await pagePortal("buy");
  pagePermission(ctx, ["buyer.haccp.manage", "buyer.haccp.log"]);
  const a = await haccpAccess(ctx.company);
  if (!a.on || !a.s.parts.training) notFound();
  const [{ l, locale }, rows] = await Promise.all([haccpLabels(), trainings(ctx)]);
  const manage = can(ctx, "buyer.haccp.manage");
  return (
    <>
      <PageHeader title={l.trTitle} description={l.trIntro} icon={GraduationCap} actions={manage ? <TrainingForm l={l} /> : undefined} />
      <Card>
        <CardContent className="pt-6">
          {!rows.length ? <p className="text-sm text-muted-foreground" data-testid="hc-no-training">{l.noTraining}</p> : (
            <ul className="divide-y" data-testid="hc-training">
              {rows.map((t) => (
                <li key={t.id} className="space-y-1 py-3" data-testid="hc-tr-row" data-state={t.state}>
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="min-w-0 break-words font-medium">{t.personName}</span><span className="min-w-0 break-words">{t.course}</span>
                    <Badge variant={stateTone(t.state)}>{l[`trState.${t.state}`]}</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">{l.issuedAt}: {dayText(locale, t.issuedAt)}{t.expiresAt ? ` · ${l.expiresAt}: ${dayText(locale, t.expiresAt)}` : ""}{t.certificateNo ? ` · ${l.certificateNo} ${t.certificateNo}` : ""}</p>
                  {manage && <div className="flex flex-wrap items-start gap-1"><TrainingForm l={l} t={{ id: t.id, personName: t.personName, course: t.course, certificateNo: t.certificateNo, issuedAt: iso(t.issuedAt), expiresAt: t.expiresAt ? iso(t.expiresAt) : null }} /><DeleteTraining l={l} id={t.id} /></div>}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </>
  );
}
