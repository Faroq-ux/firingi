"use client";
import { useRouter } from "next/navigation";
import { Portal } from "@/components/ui/portal";
import { useState, useTransition } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { deleteRoleAction, saveRoleAction } from "@/server/actions/team";

export type PermGroup = { title: string; perms: { code: string; description: string }[] };
type Labels = Record<"addRole" | "edit" | "delete" | "roleName" | "description" | "permissions" | "save" | "cancel" | "confirmDelete", string>;

export function RoleEditor({
  groups, labels, role,
}: { groups: PermGroup[]; labels: Labels; role?: { id: string; name: string; description: string | null; permissions: string[] } }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [perms, setPerms] = useState<string[]>(role?.permissions ?? []);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  return (
    <>
      <div className="flex gap-1">
        {role ? (
          <>
            <Button size="sm" variant="outline" onClick={() => { setPerms(role.permissions); setOpen(true); }}>{labels.edit}</Button>
            <Button
              size="sm"
              variant="ghost"
              className="text-destructive"
              disabled={pending}
              onClick={() => {
                if (!confirm(labels.confirmDelete)) return;
                start(async () => {
                  const r = await deleteRoleAction({ id: role.id });
                  if (!r.ok) alert(r.error);
                  router.refresh();
                });
              }}
            >
              {labels.delete}
            </Button>
          </>
        ) : (
          <Button onClick={() => { setPerms([]); setOpen(true); }}><Plus /> {labels.addRole}</Button>
        )}
      </div>
      {open && (
        <Portal>
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" role="dialog" aria-modal="true">
          <form
            className="max-h-[90dvh] w-full max-w-3xl space-y-4 overflow-y-auto rounded-xl border bg-card p-6 shadow-lg"
            onSubmit={(e) => {
              e.preventDefault();
              const fd = new FormData(e.currentTarget);
              start(async () => {
                const r = await saveRoleAction({
                  id: role?.id,
                  name: String(fd.get("name")),
                  description: String(fd.get("description") || "") || null,
                  permissions: perms,
                });
                if (r.ok) { setOpen(false); router.refresh(); } else setError(r.error);
              });
            }}
          >
            <h2 className="text-lg font-semibold">{role ? role.name : labels.addRole}</h2>
            {error && <p className="rounded-md bg-destructive/10 p-2 text-sm text-destructive">{error}</p>}
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5"><Label htmlFor="rname">{labels.roleName}</Label><Input id="rname" name="name" defaultValue={role?.name} required minLength={2} /></div>
              <div className="space-y-1.5"><Label htmlFor="rdesc">{labels.description}</Label><Input id="rdesc" name="description" defaultValue={role?.description ?? ""} /></div>
            </div>
            <div className="space-y-3">
              <Label>{labels.permissions}</Label>
              {groups.map((g) => (
                <fieldset key={g.title} className="rounded-lg border p-3">
                  <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{g.title}</legend>
                  <div className="grid gap-1 sm:grid-cols-2">
                    {g.perms.map((p) => (
                      <label key={p.code} className="flex items-start gap-2 text-sm">
                        <input
                          type="checkbox"
                          className="mt-0.5"
                          checked={perms.includes(p.code)}
                          onChange={(e) => setPerms(e.target.checked ? [...perms, p.code] : perms.filter((x) => x !== p.code))}
                        />
                        <span>{p.description} <code className="text-[10px] text-muted-foreground">{p.code}</code></span>
                      </label>
                    ))}
                  </div>
                </fieldset>
              ))}
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>{labels.cancel}</Button>
              <Button type="submit" disabled={pending}>{labels.save}</Button>
            </div>
          </form>
        </div>
        </Portal>
      )}
    </>
  );
}
