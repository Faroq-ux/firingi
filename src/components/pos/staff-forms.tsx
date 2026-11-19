"use client";
/** Phase 47 — the owner or a shop manager adds employees for their tills, or takes them off a till. */
import { useState } from "react";
import { useTranslations } from "next-intl";
import { UserMinus, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";
import { Msg, Spin, useRun } from "@/components/shared/run";
import { addTillEmployeeAction, removeFromTillAction } from "@/server/actions/pos";

export function StaffForm({ tills, owner }: { tills: { id: string; name: string; code: string }[]; owner: boolean }) {
  const t = useTranslations("posStaff");
  const { pending, error, done, run } = useRun();
  const blank = { name: "", email: "", password: "", role: "SELL" as "SELL" | "MANAGE", registerIds: tills.length === 1 ? [tills[0].id] : [] as string[] };
  const [x, setX] = useState(blank);
  const toggle = (id: string) => setX({ ...x, registerIds: x.registerIds.includes(id) ? x.registerIds.filter((r) => r !== id) : [...x.registerIds, id] });
  return (
    <form className="space-y-3" data-testid="pos-staff-form" onSubmit={(e) => { e.preventDefault(); run(() => addTillEmployeeAction(x), () => setX(blank), t("added")); }}>
      <div className="grid gap-2 sm:grid-cols-3">
        <div><Label htmlFor="ps-name">{t("name")}</Label><Input id="ps-name" value={x.name} onChange={(e) => setX({ ...x, name: e.target.value })} required data-testid="ps-name" /></div>
        <div><Label htmlFor="ps-email">{t("email")}</Label><Input id="ps-email" type="email" autoComplete="off" value={x.email} onChange={(e) => setX({ ...x, email: e.target.value })} required data-testid="ps-email" /></div>
        <div><Label htmlFor="ps-pass">{t("password")}</Label><Input id="ps-pass" type="password" autoComplete="new-password" value={x.password} onChange={(e) => setX({ ...x, password: e.target.value })} required minLength={10} data-testid="ps-pass" /></div>
      </div>
      <p className="text-xs text-muted-foreground">{t("passwordHint")} {t("existingNote")}</p>
      <div className="grid gap-2 sm:grid-cols-2">
        <div><Label htmlFor="ps-role">{t("role")}</Label>
          <Select id="ps-role" value={x.role} onChange={(e) => setX({ ...x, role: e.target.value as "SELL" | "MANAGE" })} data-testid="ps-role">
            <option value="SELL">{t("roleSELL")}</option>
            {owner && <option value="MANAGE">{t("roleMANAGE")}</option>}
          </Select>
        </div>
        <fieldset><legend className="mb-1 text-sm font-medium">{t("tills")}</legend>
          <div className="flex flex-wrap gap-x-4 gap-y-1">{tills.map((r) => <label key={r.id} className="flex items-center gap-1.5 text-sm"><input type="checkbox" checked={x.registerIds.includes(r.id)} onChange={() => toggle(r.id)} data-testid={`ps-till-${r.code}`} /> {r.name} <span className="text-xs text-muted-foreground">({r.code})</span></label>)}</div>
        </fieldset>
      </div>
      <div className="flex flex-wrap items-center gap-3"><Button type="submit" disabled={pending || !x.registerIds.length} data-testid="ps-add"><Spin on={pending} icon={UserPlus} /> {t("add")}</Button>{!x.registerIds.length && <span className="text-xs text-muted-foreground">{t("chooseTills")}</span>}<Msg error={error} done={done} /></div>
    </form>
  );
}

export function RemoveFromTill({ registerId, userId, code }: { registerId: string; userId: string; code: string }) {
  const t = useTranslations("posStaff");
  const { pending, error, run } = useRun();
  return (
    <span className="inline-flex items-center gap-1">
      <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={() => run(() => removeFromTillAction({ registerId, userId }), undefined, t("removed"))} data-testid={`ps-remove-${code}`} title={t("remove", { till: code })}>
        <Spin on={pending} icon={UserMinus} /> <span className="sr-only sm:not-sr-only">{t("remove", { till: code })}</span>
      </Button>
      <Msg error={error} />
    </span>
  );
}
