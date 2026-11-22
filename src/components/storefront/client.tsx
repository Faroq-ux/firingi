"use client";
/** Storefronts (Phase 61) — the supplier's editor and FIRINGI's controls (texts passed in as `l`; FIRINGI's in English). */
import { useMemo, useRef, useState } from "react";
import { Check, Copy, ImageUp, Rocket, Save, Trash2, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Msg, Spin, useRun } from "@/components/shared/run";
import {
  decideStorefrontAction, publishStorefrontAction, removeStorefrontImageAction, saveStorefrontAction, saveStorefrontSettingsAction,
  unpublishStorefrontAction, uploadStorefrontImageAction,
} from "@/server/actions/storefront";
import { ACCENTS, type StorefrontSettings } from "@/lib/storefront";

export type L = Record<string, string>;
const f = (s: string | undefined, v: Record<string, string | number> = {}) => (s ?? "").replace(/\{(\w+)\}/g, (_, k: string) => String(v[k] ?? `{${k}}`));
const Check2 = ({ id, checked, onChange, label, testid }: { id: string; checked: boolean; onChange: (v: boolean) => void; label: string; testid?: string }) => (
  <label htmlFor={id} className="flex items-start gap-2 text-sm"><input id={id} type="checkbox" className="mt-0.5 size-4 accent-[color:var(--primary)]" checked={checked} onChange={(e) => onChange(e.target.checked)} data-testid={testid} /> <span>{label}</span></label>
);

type Product = { id: string; name: string; packaging: string; sku: string };
type Store = { exists: boolean; slug: string; status: string; tagline: string; about: string; accent: string; featuredOfferIds: string[]; showProducts: boolean };

export function StorefrontEditor({ l, store, products, maxFeatured, base }: { l: L; store: Store; products: Product[]; maxFeatured: number; base: string }) {
  const { pending, error, done, run } = useRun();
  const [v, setV] = useState({ slug: store.slug, tagline: store.tagline, about: store.about, accent: store.accent, showProducts: store.showProducts });
  const [featured, setFeatured] = useState<string[]>(store.featuredOfferIds);
  const [q, setQ] = useState("");
  const list = useMemo(() => {
    const t = q.trim().toLowerCase();
    return products.filter((p) => !t || p.name.toLowerCase().includes(t) || p.sku.toLowerCase().includes(t)).slice(0, 60);
  }, [q, products]);
  const toggle = (id: string) => setFeatured((x) => (x.includes(id) ? x.filter((y) => y !== id) : x.length >= maxFeatured ? x : [...x, id]));
  const save = () => run(() => saveStorefrontAction({ ...v, slug: v.slug.trim().toLowerCase(), featuredOfferIds: featured }), undefined, l.saved);
  return (
    <div className="space-y-5" data-testid="sf-editor">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="sf-slug">{l.link}</Label>
          <div className="flex min-w-0 items-center rounded-md border bg-background text-sm focus-within:ring-2 focus-within:ring-ring">
            <span className="shrink-0 truncate pl-3 text-muted-foreground">{base}/s/</span>
            <input id="sf-slug" className="min-w-0 flex-1 bg-transparent py-2 pr-3 outline-none" value={v.slug} maxLength={40} onChange={(e) => setV({ ...v, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "") })} data-testid="sf-slug" />
          </div>
        </div>
        <div className="space-y-1"><Label htmlFor="sf-tagline">{l.tagline}</Label><Input id="sf-tagline" maxLength={120} value={v.tagline} onChange={(e) => setV({ ...v, tagline: e.target.value })} data-testid="sf-tagline-input" /></div>
      </div>
      <div className="space-y-1">
        <Label htmlFor="sf-about">{l.about}</Label>
        <textarea id="sf-about" rows={4} maxLength={2000} className="w-full rounded-md border bg-background p-2 text-sm" value={v.about} onChange={(e) => setV({ ...v, about: e.target.value })} data-testid="sf-about-input" />
      </div>
      <fieldset className="space-y-1">
        <legend className="text-sm font-medium">{l.accent}</legend>
        <div className="flex flex-wrap gap-2">
          {ACCENTS.map((c) => (
            <button key={c} type="button" aria-label={c} aria-pressed={v.accent === c} onClick={() => setV({ ...v, accent: c })} className="grid size-8 place-items-center rounded-full ring-offset-2 ring-offset-background transition-transform hover:scale-110 aria-pressed:ring-2 aria-pressed:ring-foreground" style={{ background: c }} data-testid="sf-accent">
              {v.accent === c && <Check className="size-4 text-white" />}
            </button>
          ))}
        </div>
      </fieldset>
      <Check2 id="sf-show" checked={v.showProducts} onChange={(x) => setV({ ...v, showProducts: x })} label={l.showProducts} testid="sf-show-products" />
      <div className="space-y-2">
        <p className="text-sm font-medium">{f(l.featured, { max: maxFeatured })} <span className="text-muted-foreground">· {featured.length}</span></p>
        <Input placeholder={l.searchProducts} value={q} onChange={(e) => setQ(e.target.value)} aria-label={l.searchProducts} />
        <ul className="max-h-64 divide-y overflow-y-auto rounded-md border">
          {[...products.filter((p) => featured.includes(p.id)).sort((a, b) => featured.indexOf(a.id) - featured.indexOf(b.id)), ...list.filter((p) => !featured.includes(p.id))].map((p) => (
            <li key={p.id}>
              <label className="flex cursor-pointer items-center gap-2 p-2 text-sm hover:bg-muted/50">
                <input type="checkbox" checked={featured.includes(p.id)} onChange={() => toggle(p.id)} data-testid="sf-feature" value={p.id} />
                <span className="min-w-0 flex-1 break-words">{p.name} <span className="text-xs text-muted-foreground">· {p.packaging} · {p.sku}</span></span>
                {featured.includes(p.id) && <span className="text-xs tabular-nums text-muted-foreground">#{featured.indexOf(p.id) + 1}</span>}
              </label>
            </li>
          ))}
        </ul>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={save} disabled={pending} data-testid="sf-save"><Spin on={pending} icon={Save} /> {l.save}</Button>
        <Msg error={error} done={done} />
      </div>
    </div>
  );
}

export function ImageField({ l, kind, has, src, disabled }: { l: L; kind: "logo" | "banner"; has: boolean; src: string; disabled?: boolean }) {
  const { pending, error, run } = useRun();
  const ref = useRef<HTMLInputElement>(null);
  const [v, setVer] = useState(0);
  const upload = (file: File) => {
    const fd = new FormData(); fd.set("kind", kind); fd.set("file", file);
    run(() => uploadStorefrontImageAction(fd), () => setVer((x) => x + 1));
  };
  return (
    <div className="space-y-2" data-testid={`sf-${kind}`}>
      <p className="text-sm font-medium">{kind === "logo" ? l.logo : l.banner}</p>
      <div className={kind === "logo" ? "grid size-24 place-items-center overflow-hidden rounded-xl border bg-muted/40" : "grid aspect-[3/1] w-full place-items-center overflow-hidden rounded-xl border bg-muted/40"}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {has ? <img src={`${src}?v=${v}`} alt="" className={kind === "logo" ? "size-full object-contain" : "size-full object-cover"} /> : <ImageUp className="size-6 text-muted-foreground" />}
      </div>
      <div className="flex flex-wrap gap-2">
        <input ref={ref} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => { const x = e.target.files?.[0]; if (x) upload(x); e.target.value = ""; }} data-testid={`sf-${kind}-file`} />
        <Button size="sm" variant="outline" disabled={pending || disabled} onClick={() => ref.current?.click()}><Spin on={pending} icon={ImageUp} /> {l.upload}</Button>
        {has && <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => removeStorefrontImageAction({ kind }))}><Trash2 className="size-4" /> {l.remove}</Button>}
      </div>
      {disabled && <p className="text-xs text-muted-foreground">{l.saveFirst}</p>}
      <Msg error={error} />
    </div>
  );
}

export function PublishControls({ l, status, requireApproval, everPublished }: { l: L; status: string; requireApproval: boolean; everPublished: boolean }) {
  const { pending, error, run } = useRun();
  if (status === "SUSPENDED" || status === "PENDING") return null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      {status === "PUBLISHED"
        ? <Button variant="outline" onClick={() => run(() => unpublishStorefrontAction({}))} disabled={pending} data-testid="sf-unpublish"><Spin on={pending} icon={Undo2} /> {l.unpublish}</Button>
        : <Button onClick={() => run(() => publishStorefrontAction({}))} disabled={pending} data-testid="sf-publish"><Spin on={pending} icon={Rocket} /> {requireApproval && !everPublished ? l.askApproval : l.publish}</Button>}
      <Msg error={error} />
    </div>
  );
}

export function CopyLink({ l, url }: { l: L; url: string }) {
  const [ok, setOk] = useState(false);
  return (
    <Button size="sm" variant="outline" onClick={async () => { await navigator.clipboard?.writeText(url).catch(() => null); setOk(true); setTimeout(() => setOk(false), 1500); }} data-testid="sf-copy">
      {ok ? <Check className="size-4" /> : <Copy className="size-4" />} {ok ? l.copied : l.copy}
    </Button>
  );
}

// ── FIRINGI (English) ───────────────────────────────────────────────────────

export function AdminStoreActions({ companyId, status }: { companyId: string; status: string }) {
  const { pending, error, run } = useRun();
  const [note, setNote] = useState("");
  const act = (action: "APPROVE" | "REJECT" | "SUSPEND" | "RESTORE") => run(() => decideStorefrontAction({ companyId, action, note: note.trim() || null }));
  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="sf-admin-actions">
      {(status === "PENDING" || status === "PUBLISHED" || status === "DRAFT") && <Input className="h-8 w-48" placeholder="Reason (refuse / suspend)" value={note} onChange={(e) => setNote(e.target.value)} />}
      {status === "PENDING" && <Button size="sm" onClick={() => act("APPROVE")} disabled={pending} data-testid="sf-approve">Approve</Button>}
      {status === "PENDING" && <Button size="sm" variant="outline" onClick={() => act("REJECT")} disabled={pending}>Refuse</Button>}
      {status !== "SUSPENDED" && <Button size="sm" variant="outline" onClick={() => act("SUSPEND")} disabled={pending} data-testid="sf-suspend">Suspend</Button>}
      {status === "SUSPENDED" && <Button size="sm" onClick={() => act("RESTORE")} disabled={pending} data-testid="sf-restore">Restore</Button>}
      <Msg error={error} />
    </div>
  );
}

export function AdminStorefrontSettings({ s }: { s: StorefrontSettings }) {
  const { pending, error, done, run } = useRun();
  const [v, setV] = useState(s);
  return (
    <div className="space-y-3" data-testid="sf-admin-settings">
      <div className="grid gap-3 sm:grid-cols-2">
        <Check2 id="sfa-on" checked={v.enabled} onChange={(x) => setV({ ...v, enabled: x })} label="Storefronts on — wholesalers and distributors can publish their page" testid="sfa-enabled" />
        <Check2 id="sfa-appr" checked={v.requireApproval} onChange={(x) => setV({ ...v, requireApproval: x })} label="FIRINGI approves a store before its first publication" />
        <Check2 id="sfa-pub" checked={v.publicProducts} onChange={(x) => setV({ ...v, publicProducts: x })} label="Visitors who aren't signed in may see products (never prices)" />
        <div className="space-y-1"><Label htmlFor="sfa-max">Featured products per store (max)</Label><Input id="sfa-max" type="number" min={0} max={24} value={v.maxFeatured} onChange={(e) => setV({ ...v, maxFeatured: Math.round(Number(e.target.value) || 0) })} className="w-28" /></div>
      </div>
      <div className="flex items-center gap-3">
        <Button onClick={() => run(() => saveStorefrontSettingsAction(v), undefined, "Saved.")} disabled={pending} data-testid="sfa-save"><Spin on={pending} icon={Save} /> Save</Button>
        <Msg error={error} done={done} />
      </div>
    </div>
  );
}
