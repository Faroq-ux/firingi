"use client";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { UserPlus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FieldError, Input, Label } from "@/components/ui/input";
import { createMemberAction, setMemberRolesAction, setMemberStatusAction } from "@/server/actions/team";

export type RoleOption = { id: string; name: string; isSystem: boolean; description: string | null };
export type RegionOption = { id: string; label: string };
type Labels = Record<
  "addUser" | "name" | "email" | "jobTitle" | "initialPassword" | "passwordHint" | "rolesLabel" | "regions" | "regionsHint" | "create" | "cancel" | "save" | "editRoles" | "enable" | "disable",
  string
>;

function RoleChecklist({ roles, value, onChange }: { roles: RoleOption[]; value: string[]; onChange: (v: string[]) => void }) {
  return (
    <div className="grid gap-1.5 sm:grid-cols-2">
      {roles.map((r) => (
        <label key={r.id} className="flex cursor-pointer items-start gap-2 rounded-md border p-2 text-sm hover:bg-muted/40">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={value.includes(r.id)}
            onChange={(e) => onChange(e.target.checked ? [...value, r.id] : value.filter((x) => x !== r.id))}
          />
          <span>
            <span className="font-medium">{r.name}</span>
            {r.description && <span className="block text-xs text-muted-foreground">{r.description}</span>}
          </span>
        </label>
      ))}
    </div>
  );
}

export function AddMemberForm({ roles, regions, labels }: { roles: RoleOption[]; regions?: RegionOption[]; labels: Labels }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [roleIds, setRoleIds] = useState<string[]>([]);
  const [regionIds, setRegionIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});

  if (!open)
    return (
      <Button onClick={() => setOpen(true)}>
        <UserPlus /> {labels.addUser}
      </Button>
    );

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" role="dialog" aria-modal="true">
      <form
        className="max-h-[90dvh] w-full max-w-2xl space-y-4 overflow-y-auto rounded-xl border bg-card p-6 shadow-lg"
        onSubmit={(e) => {
          e.preventDefault();
          const fd = new FormData(e.currentTarget);
          start(async () => {
            const r = await createMemberAction({
              name: String(fd.get("name")),
              email: String(fd.get("email")),
              password: String(fd.get("password")),
              jobTitle: String(fd.get("jobTitle") || "") || null,
              roleIds,
              regionIds,
            });
            if (r.ok) {
              setOpen(false);
              setRoleIds([]);
              router.refresh();
            } else {
              setError(r.error);
              setFieldErrors(r.fieldErrors ?? {});
            }
          });
        }}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">{labels.addUser}</h2>
          <button type="button" onClick={() => setOpen(false)} className="rounded p-1 hover:bg-muted" aria-label={labels.cancel}><X className="size-4" /></button>
        </div>
        {error && <p className="rounded-md bg-destructive/10 p-2 text-sm text-destructive">{error}</p>}
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5"><Label htmlFor="name">{labels.name}</Label><Input id="name" name="name" required /><FieldError messages={fieldErrors.name} /></div>
          <div className="space-y-1.5"><Label htmlFor="email">{labels.email}</Label><Input id="email" name="email" type="email" required /><FieldError messages={fieldErrors.email} /></div>
          <div className="space-y-1.5"><Label htmlFor="jobTitle">{labels.jobTitle}</Label><Input id="jobTitle" name="jobTitle" /></div>
          <div className="space-y-1.5">
            <Label htmlFor="password">{labels.initialPassword}</Label>
            <Input id="password" name="password" type="password" minLength={10} required autoComplete="new-password" />
            <p className="text-xs text-muted-foreground">{labels.passwordHint}</p>
            <FieldError messages={fieldErrors.password} />
          </div>
        </div>
        <div className="space-y-2">
          <Label>{labels.rolesLabel}</Label>
          <RoleChecklist roles={roles} value={roleIds} onChange={setRoleIds} />
          <FieldError messages={fieldErrors.roleIds} />
        </div>
        {regions && regions.length > 0 && (
          <div className="space-y-2">
            <Label>{labels.regions}</Label>
            <p className="text-xs text-muted-foreground">{labels.regionsHint}</p>
            <div className="flex flex-wrap gap-2">
              {regions.map((r) => (
                <label key={r.id} className="flex items-center gap-1.5 rounded-md border px-2 py-1 text-sm">
                  <input type="checkbox" checked={regionIds.includes(r.id)} onChange={(e) => setRegionIds(e.target.checked ? [...regionIds, r.id] : regionIds.filter((x) => x !== r.id))} />
                  {r.label}
                </label>
              ))}
            </div>
          </div>
        )}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={() => setOpen(false)}>{labels.cancel}</Button>
          <Button type="submit" disabled={pending}>{labels.create}</Button>
        </div>
      </form>
    </div>
  );
}

export function MemberActions({
  membershipId, currentRoleIds, roles, status, canEdit, labels,
}: { membershipId: string; currentRoleIds: string[]; roles: RoleOption[]; status: string; canEdit: boolean; labels: Labels }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [roleIds, setRoleIds] = useState(currentRoleIds);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  if (!canEdit) return null;

  return (
    <div className="flex justify-end gap-1">
      <Button size="sm" variant="outline" onClick={() => { setRoleIds(currentRoleIds); setError(null); setEditing(true); }}>{labels.editRoles}</Button>
      <Button
        size="sm"
        variant={status === "ACTIVE" ? "ghost" : "secondary"}
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await setMemberStatusAction({ membershipId, status: status === "ACTIVE" ? "DISABLED" : "ACTIVE" });
            if (!r.ok) alert(r.error);
            router.refresh();
          })
        }
      >
        {status === "ACTIVE" ? labels.disable : labels.enable}
      </Button>
      {editing && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4 text-left" role="dialog" aria-modal="true">
          <div className="w-full max-w-2xl space-y-4 rounded-xl border bg-card p-6 shadow-lg">
            <h2 className="text-lg font-semibold">{labels.editRoles}</h2>
            {error && <p className="rounded-md bg-destructive/10 p-2 text-sm text-destructive">{error}</p>}
            <RoleChecklist roles={roles} value={roleIds} onChange={setRoleIds} />
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setEditing(false)}>{labels.cancel}</Button>
              <Button
                disabled={pending}
                onClick={() =>
                  start(async () => {
                    const r = await setMemberRolesAction({ membershipId, roleIds });
                    if (r.ok) { setEditing(false); router.refresh(); } else setError(r.error);
                  })
                }
              >
                {labels.save}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
