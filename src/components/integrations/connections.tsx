"use client";
/** Company › Integrations: API keys (self-service) and webhooks — create, copy once, test, pause, revoke. */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Check, Copy, KeyRound, Loader2, Send, Trash2, Webhook } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { LiveDot } from "@/components/motion/shapes";
import { createKeyAction, createWebhookAction, deleteWebhookAction, revokeKeyAction, testWebhookAction, toggleWebhookAction } from "@/server/actions/integrations";

export function CopyField({ value, testId }: { value: string; testId?: string }) {
  const t = useTranslations("integrations");
  const [done, setDone] = useState(false);
  return (
    <div className="flex items-center gap-2 rounded-lg border bg-background/80 p-2">
      <code className="min-w-0 flex-1 truncate font-mono text-sm" data-testid={testId}>{value}</code>
      <Button size="sm" variant="outline" onClick={async () => { await navigator.clipboard?.writeText(value).catch(() => null); setDone(true); setTimeout(() => setDone(false), 1500); }}>
        {done ? <Check className="size-4" aria-hidden /> : <Copy className="size-4" aria-hidden />}{done ? t("copied") : t("copy")}
      </Button>
    </div>
  );
}

export type KeyRow = { id: string; name: string; prefix: string; scopes: string[]; revokedAt: string | null; lastUsedAt: string | null; actsAs: string; calls7d: number; errors7d: number };

export function ApiKeys({ keys, scopes, recent, locale }: { keys: KeyRow[]; scopes: string[]; recent: { id: string; keyName: string; method: string; path: string; status: number; ms: number; at: string }[]; locale: string }) {
  const t = useTranslations("integrations");
  const router = useRouter();
  const [name, setName] = useState("");
  const [chosen, setChosen] = useState<string[]>(scopes.filter((s) => s.endsWith(".read")));
  const [created, setCreated] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const when = (d: string) => new Date(d).toLocaleString(locale, { dateStyle: "short", timeStyle: "short" });
  return (
    <div className="space-y-4" data-testid="api-keys">
      <div className="rounded-2xl border bg-[linear-gradient(160deg,color-mix(in_oklch,var(--vivid-violet)_9%,var(--card)),var(--card)_65%)] p-4">
        <div className="grid gap-3 lg:grid-cols-[1fr_2fr_auto] lg:items-end">
          <label className="grid gap-1 text-sm"><span className="text-muted-foreground">{t("keys.name")}</span><Input value={name} onChange={(e) => setName(e.target.value)} placeholder={t("keys.namePlaceholder")} maxLength={80} data-testid="key-name" /></label>
          <fieldset className="grid gap-1 text-sm"><legend className="mb-1 text-muted-foreground">{t("keys.perms")}</legend>
            <div className="flex flex-wrap gap-2">
              {scopes.map((s) => (
                <label key={s} className={`flex cursor-pointer items-center gap-2 rounded-full border px-3 py-1 transition-colors ${chosen.includes(s) ? "border-primary bg-primary/10 font-medium" : "bg-card"}`}>
                  <input type="checkbox" className="sr-only" checked={chosen.includes(s)} onChange={(e) => setChosen((c) => (e.target.checked ? [...c, s] : c.filter((x) => x !== s)))} data-testid={`scope-${s}`} />
                  {chosen.includes(s) && <Check className="size-3.5" aria-hidden />}{t(`scope.${s.replace(".", "_")}`)}
                </label>
              ))}
            </div>
          </fieldset>
          <Button disabled={pending || !name.trim() || !chosen.length} data-testid="key-create" onClick={() => start(async () => {
            setError(null);
            const r = await createKeyAction({ name, scopes: chosen });
            if (!r.ok) return setError(r.error);
            setCreated(r.data.key); setName(""); router.refresh();
          })}>{pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <KeyRound className="size-4" aria-hidden />}{t("keys.create")}</Button>
        </div>
        {created && <div className="motion-rise mt-3 space-y-1 rounded-xl border border-[color:color-mix(in_oklch,var(--vivid-lime)_55%,var(--border))] bg-[color:color-mix(in_oklch,var(--vivid-lime)_10%,var(--card))] p-3"><p className="text-sm font-semibold">{t("keys.once")}</p><CopyField value={created} testId="key-secret" /></div>}
        {error && <p className="mt-2 text-sm text-destructive" role="alert">{error}</p>}
      </div>
      {(() => {
        const list = (rows: KeyRow[]) => (
          <ul className="grid gap-3 md:grid-cols-2">
            {rows.map((k, i) => (
              <li key={k.id} className={`tile gloss motion-rise rounded-2xl border p-4 ${k.revokedAt ? "opacity-60" : "tone-violet"}`} style={{ ["--i" as string]: i }} data-testid="key-row">
                <div className="flex items-start gap-3">
                  <div className="tile-chip grid size-10 shrink-0 place-items-center rounded-xl"><KeyRound className="size-5" aria-hidden /></div>
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-2 font-semibold">{k.name}{k.revokedAt ? <Badge variant="outline">{t("keys.revoked")}</Badge> : k.lastUsedAt && Date.now() - new Date(k.lastUsedAt).getTime() < 3600_000 ? <span title={t("hooks.active")}><LiveDot /></span> : null}</p>
                    <p className="font-mono text-xs text-muted-foreground">{k.prefix}… · {t("keys.actsAs", { name: k.actsAs })}</p>
                    <p className="mt-1 flex flex-wrap gap-1">{k.scopes.map((s) => <span key={s} className="rounded-md bg-muted px-1.5 py-0.5 text-[11px]">{t(`scope.${s.replace(".", "_")}`)}</span>)}</p>
                    <p className="mt-1 text-xs text-muted-foreground">{k.lastUsedAt ? t("keys.lastUsed", { when: when(k.lastUsedAt) }) : t("keys.neverUsed")} · {t("keys.usage", { calls: k.calls7d, errors: k.errors7d })}</p>
                  </div>
                  {!k.revokedAt && <Button size="sm" variant="ghost" className="text-destructive" disabled={pending} data-testid="key-revoke" onClick={() => { if (confirm(t("keys.revokeConfirm"))) start(async () => { await revokeKeyAction({ id: k.id }); router.refresh(); }); }}>{t("keys.revoke")}</Button>}
                </div>
              </li>
            ))}
          </ul>
        );
        const active = keys.filter((k) => !k.revokedAt), revoked = keys.filter((k) => k.revokedAt);
        return (
          <>
            {active.length ? list(active) : <p className="text-sm text-muted-foreground">{t("keys.none")}</p>}
            {revoked.length > 0 && <details className="rounded-xl border bg-card/60 p-3 text-sm"><summary className="cursor-pointer text-muted-foreground">{t("keys.revoked")} · {revoked.length}</summary><div className="mt-3">{list(revoked)}</div></details>}
          </>
        );
      })()}
      {recent.length > 0 && (
        <details className="rounded-xl border bg-card p-3 text-sm">
          <summary className="cursor-pointer font-medium">{t("keys.recent")}</summary>
          <ul className="mt-2 divide-y font-mono text-xs">{recent.map((c) => <li key={c.id} className="flex flex-wrap gap-x-3 py-1.5"><span className={c.status >= 400 ? "text-destructive" : "text-[var(--vivid-teal)]"}>{c.status}</span><span>{c.method}</span><span className="min-w-0 flex-1 truncate">{c.path}</span><span className="text-muted-foreground">{c.ms} ms · {c.keyName} · {when(c.at)}</span></li>)}</ul>
        </details>
      )}
    </div>
  );
}

export type HookRow = { id: string; url: string; events: string[]; active: boolean; disabledReason: string | null; lastSuccessAt: string | null; lastFailureAt: string | null; failureStreak: number };

export function Webhooks({ hooks, events, recent, locale }: { hooks: HookRow[]; events: string[]; recent: { id: string; endpointId: string; event: string; status: string; attempts: number; responseCode: number | null; createdAt: string }[]; locale: string }) {
  const t = useTranslations("integrations");
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [chosen, setChosen] = useState<string[]>(events);
  const [secret, setSecret] = useState<string | null>(null);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const ev = (e: string) => t(`event.${e.replace(".", "_")}`);
  return (
    <div className="space-y-4" data-testid="webhooks">
      <div className="rounded-2xl border bg-[linear-gradient(160deg,color-mix(in_oklch,var(--vivid-teal)_9%,var(--card)),var(--card)_65%)] p-4">
        <div className="grid gap-3 lg:grid-cols-[1.4fr_2fr_auto] lg:items-end">
          <label className="grid gap-1 text-sm"><span className="text-muted-foreground">{t("hooks.url")}</span><Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://erp.example.com/firingi" data-testid="hook-url" /></label>
          <fieldset className="text-sm"><legend className="mb-1 text-muted-foreground">{t("hooks.events")}</legend>
            <div className="flex flex-wrap gap-2">{events.map((e) => (
              <label key={e} className={`flex cursor-pointer items-center gap-2 rounded-full border px-3 py-1 ${chosen.includes(e) ? "border-[var(--vivid-teal)] bg-[color:color-mix(in_oklch,var(--vivid-teal)_12%,transparent)] font-medium" : "bg-card"}`}>
                <input type="checkbox" className="sr-only" checked={chosen.includes(e)} onChange={(x) => setChosen((c) => (x.target.checked ? [...c, e] : c.filter((y) => y !== e)))} />
                {chosen.includes(e) && <Check className="size-3.5" aria-hidden />}{ev(e)}
              </label>
            ))}</div>
          </fieldset>
          <Button disabled={pending || !url.trim() || !chosen.length} data-testid="hook-add" onClick={() => start(async () => {
            setNote(null);
            const r = await createWebhookAction({ url, events: chosen });
            if (!r.ok) return setNote({ ok: false, text: r.error });
            setSecret(r.data.secret); setUrl(""); router.refresh();
          })}>{pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Webhook className="size-4" aria-hidden />}{t("hooks.add")}</Button>
        </div>
        {secret && <div className="motion-rise mt-3 space-y-1 rounded-xl border border-[color:color-mix(in_oklch,var(--vivid-lime)_55%,var(--border))] bg-[color:color-mix(in_oklch,var(--vivid-lime)_10%,var(--card))] p-3"><p className="text-sm font-semibold">{t("hooks.secretOnce")}</p><CopyField value={secret} testId="hook-secret" /></div>}
        {note && <p className={`mt-2 text-sm ${note.ok ? "text-[var(--vivid-teal)]" : "text-destructive"}`} role="status" data-testid="hook-note">{note.text}</p>}
      </div>
      {!hooks.length ? <p className="text-sm text-muted-foreground">{t("hooks.none")}</p> : (
        <ul className="space-y-3">
          {hooks.map((h, i) => {
            const mine = recent.filter((r) => r.endpointId === h.id).slice(0, 6);
            return (
              <li key={h.id} className={`tile gloss motion-rise rounded-2xl border p-4 ${h.active ? "tone-teal" : "tone-orange"}`} style={{ ["--i" as string]: i }} data-testid="hook-row">
                <div className="flex flex-wrap items-start gap-3">
                  <div className="tile-chip grid size-10 shrink-0 place-items-center rounded-xl"><Webhook className="size-5" aria-hidden /></div>
                  <div className="min-w-0 flex-1 basis-[calc(100%-4rem)] sm:basis-0">
                    <p className="flex min-w-0 items-center gap-2 font-mono text-sm font-semibold">{h.active && <LiveDot />}<span className="truncate">{h.url}</span></p>
                    <p className="text-xs text-muted-foreground">{h.active ? t("hooks.active") : h.disabledReason ? t("hooks.off", { reason: h.disabledReason }) : t("hooks.paused")} · {h.events.map(ev).join(", ")}</p>
                    {mine.length > 0 && <div className="mt-2 flex flex-wrap gap-1" aria-label={t("hooks.recent")}>{mine.map((d) => <span key={d.id} title={`${ev(d.event)} · ${new Date(d.createdAt).toLocaleString(locale)}`} className={`rounded-md px-1.5 py-0.5 font-mono text-[11px] ${d.status === "SENT" ? "bg-[color:color-mix(in_oklch,var(--vivid-teal)_18%,transparent)]" : d.status === "PENDING" ? "bg-[color:color-mix(in_oklch,var(--vivid-orange)_20%,transparent)]" : "bg-destructive/15 text-destructive"}`}>{d.responseCode ?? "—"} {t(`delivery.${d.status}`)}</span>)}</div>}
                  </div>
                  <div className="flex w-full flex-wrap gap-1 sm:w-auto">
                    <Button size="sm" variant="outline" disabled={pending} data-testid="hook-test" onClick={() => start(async () => {
                      const r = await testWebhookAction({ id: h.id });
                      if (!r.ok) return setNote({ ok: false, text: r.error });
                      setNote(r.data.ok ? { ok: true, text: t("hooks.testOk", { status: String(r.data.status) }) } : { ok: false, text: t("hooks.testFail", { status: String(r.data.status ?? r.data.body ?? "—") }) });
                      router.refresh();
                    })}><Send className="size-4" aria-hidden />{t("hooks.test")}</Button>
                    <Button size="sm" variant="ghost" disabled={pending} onClick={() => start(async () => { await toggleWebhookAction({ id: h.id, active: !h.active }); router.refresh(); })}>{h.active ? t("hooks.pause") : t("hooks.resume")}</Button>
                    <Button size="sm" variant="ghost" className="text-destructive" disabled={pending} aria-label={t("hooks.delete")} onClick={() => { if (confirm(t("hooks.deleteConfirm"))) start(async () => { await deleteWebhookAction({ id: h.id }); router.refresh(); }); }}><Trash2 className="size-4" aria-hidden /></Button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
