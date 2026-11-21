"use client";
/** FIRINGI's landing page editor (Phase 56, English): sections, contact and company details, numbers, every text in every language, legal pages. */
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Eye, EyeOff, Plus, RotateCcw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";
import { Msg, Spin, useRun } from "@/components/shared/run";
import { deleteSubscriberAction, saveLandingSettingsAction } from "@/server/actions/landing";
import { LANDING_SECTIONS, LEGAL_PAGES, SOCIALS, type LandingSection, type LandingSettings, type LegalPage } from "@/lib/landing";

const TA = "w-full rounded-lg border border-input bg-card/80 px-3 py-2 text-sm";
const SECTION_LABEL: Record<LandingSection, string> = {
  stats: "Numbers strip (black, under the top)", cats: "Categories (gliding rows)", buy: "Buy (cart screen)", till: "Till (POS screen)", manage: "Manage (margins, stock, staff)",
  save: "Save (rewards, pay later)", start: "Start in three steps", faq: "Questions (FAQ)", contact: "Contact form + WhatsApp", newsletter: "Newsletter sign-up",
  final: "Final red call to action", vendors: "Sell on FIRINGI page (/sell, linked from the menu and footer)", plans: "Vendor plans on /sell (live from Plan settings)",
};
const GROUP_LABEL: Record<string, string> = {
  meta: "Search engines (title, description)", app: "Main page (top, numbers, categories, sections, steps, screen texts)", tour: "Dashboard pictures (menu, labels)",
  chart: "Sell page picture (vendors and slots)", vendors: "Sell page (vendors)", sellPage: "Sell page (headings)", plans: "Vendor plans", faq: "Questions (FAQ)",
  final: "Final call to action", contact: "Contact form", news: "Newsletter", mail: "E-mails sent to visitors", foot: "Footer", legal: "Legal page titles",
};

type Row = { key: string; en: string; built: string; own: string | null };

export function LandingSettingsForm({ initial }: { initial: LandingSettings }) {
  const { pending, error, done, run } = useRun();
  const [s, setS] = useState(initial);
  const set = <K extends keyof LandingSettings>(k: K, v: LandingSettings[K]) => setS({ ...s, [k]: v });
  return (
    <form className="space-y-8" data-testid="ls-form" onSubmit={(e) => { e.preventDefault(); run(() => saveLandingSettingsAction(s), undefined, "Saved — the page shows it now."); }}>
      <section className="space-y-3">
        <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-0.5" checked={s.enabled} onChange={(e) => set("enabled", e.target.checked)} data-testid="ls-enabled" />
          <span>Show the landing page to visitors at the main address<span className="block text-xs text-muted-foreground">Off: visitors go straight to the login page. Signed-in users always go to their portal.</span></span></label>
        <h3 className="text-sm font-semibold">Sections</h3>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {LANDING_SECTIONS.map((k) => (
            <label key={k} className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-0.5" checked={s.sections[k]} onChange={(e) => set("sections", { ...s.sections, [k]: e.target.checked })} data-testid={`ls-sec-${k}`} /><span>{SECTION_LABEL[k]}</span></label>
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <h3 className="text-sm font-semibold">Contact and company details</h3>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <div><Label className="text-xs">WhatsApp for wholesale customers (optional)</Label><Input value={s.whatsapp} placeholder="351912345678" onChange={(e) => set("whatsapp", e.target.value)} data-testid="ls-wa" /><p className="mt-0.5 text-[11px] text-muted-foreground">With country code. Main page, contact section and footer. Empty = no WhatsApp buttons.</p></div>
          <div><Label className="text-xs">WhatsApp for suppliers (optional)</Label><Input value={s.whatsappVendors} placeholder="351912345679" onChange={(e) => set("whatsappVendors", e.target.value)} data-testid="ls-wa-vendors" /><p className="mt-0.5 text-[11px] text-muted-foreground">Wholesalers and distributors, on the “Become a supplier” page. Empty = the customers’ number.</p></div>
          <div><Label className="text-xs">Contact email</Label><Input type="email" value={s.email} onChange={(e) => set("email", e.target.value)} data-testid="ls-email" /></div>
          <div><Label className="text-xs">Phone</Label><Input value={s.phone} onChange={(e) => set("phone", e.target.value)} /></div>
          <div><Label className="text-xs">Company legal name</Label><Input value={s.company.legalName} onChange={(e) => set("company", { ...s.company, legalName: e.target.value })} data-testid="ls-company" /></div>
          <div><Label className="text-xs">NIF</Label><Input value={s.company.nif} onChange={(e) => set("company", { ...s.company, nif: e.target.value })} /></div>
          <div><Label className="text-xs">Registered address</Label><Input value={s.company.address} onChange={(e) => set("company", { ...s.company, address: e.target.value })} /></div>
          {SOCIALS.map((k) => <div key={k}><Label className="text-xs capitalize">{k} link</Label><Input value={s.social[k]} placeholder="https://" onChange={(e) => set("social", { ...s.social, [k]: e.target.value })} /></div>)}
          <div><Label className="text-xs">Livro de Reclamações link</Label><Input value={s.livroUrl} onChange={(e) => set("livroUrl", e.target.value)} /></div>
        </div>
      </section>

      <div className="sticky bottom-3 z-10 flex flex-wrap items-center gap-3 rounded-xl border bg-background/95 p-3 shadow-sm backdrop-blur">
        <Button type="submit" disabled={pending} data-testid="ls-save"><Spin on={pending} icon={Check} /> Save</Button>
        <a href="/welcome" target="_blank" rel="noopener" className="text-sm text-primary hover:underline">Open the page →</a>
        <Msg error={error} done={done} />
      </div>
    </form>
  );
}

/** Every text of the page in one language: the English text, the built-in translation and FIRINGI's own wording. */
export function LandingTextsForm({ settings, locale, locales, rows }: { settings: LandingSettings; locale: string; locales: { code: string; name: string }[]; rows: Row[] }) {
  const { pending, error, done, run } = useRun();
  const router = useRouter();
  const [own, setOwn] = useState<Record<string, string>>(() => ({ ...(settings.texts[locale] ?? {}) }));
  const [hidden, setHidden] = useState<string[]>(settings.hidden);
  const [q, setQ] = useState("");
  const [extra, setExtra] = useState<string[]>([]);
  const all = useMemo(() => [...rows, ...extra.filter((k) => !rows.some((r) => r.key === k)).map((k) => ({ key: k, en: "", built: "", own: null }))], [rows, extra]);
  const shown = all.filter((r) => !q || r.key.toLowerCase().includes(q.toLowerCase()) || r.en.toLowerCase().includes(q.toLowerCase()) || (own[r.key] ?? r.built).toLowerCase().includes(q.toLowerCase()));
  const groups = [...new Set(shown.map((r) => r.key.split(".")[0]))];
  const item = (key: string) => { const m = /^(.*\.\d+)(\.|$)/.exec(key); return m ? m[1] : null; };
  const faqNums = all.map((r) => /^faq\.items\.(\d+)\./.exec(r.key)?.[1]).filter(Boolean).map(Number);
  const save = () => run(() => saveLandingSettingsAction({ ...settings, hidden, texts: { ...settings.texts, [locale]: Object.fromEntries(Object.entries(own).filter(([, v]) => v.trim() !== "")) } }), undefined, "Saved.");
  return (
    <div className="space-y-4" data-testid="lt-form">
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-56"><Label className="text-xs">Language</Label>
          <Select value={locale} onChange={(e) => router.push(`/admin/marketing/landing?lang=${e.target.value}#texts`)} data-testid="lt-lang">{locales.map((l) => <option key={l.code} value={l.code}>{l.name} ({l.code})</option>)}</Select></div>
        <div className="min-w-48 flex-1"><Label className="text-xs">Find a text</Label><Input value={q} placeholder="e.g. minimum, delivery, FAQ…" onChange={(e) => setQ(e.target.value)} data-testid="lt-search" /></div>
        <Button type="button" variant="outline" size="sm" onClick={() => { const n = Math.max(0, ...faqNums) + 1; setExtra([...extra, `faq.items.${n}.q`, `faq.items.${n}.a`]); setQ(""); }}><Plus className="size-4" aria-hidden /> Add a question</Button>
      </div>
      <p className="text-xs text-muted-foreground">Empty boxes use the built-in text (shown in grey). A text you change in English shows in the other languages only where they have no text of their own. “Hide” removes a list item (a fact, step, FAQ question, delivery area…) in every language.</p>
      {groups.map((g) => (
        <details key={g} className="rounded-lg border" open={!!q}>
          <summary className="cursor-pointer px-3 py-2 text-sm font-semibold">{GROUP_LABEL[g] ?? g} <span className="font-normal text-muted-foreground">· {shown.filter((r) => r.key.startsWith(`${g}.`)).length}</span></summary>
          <div className="divide-y">
            {shown.filter((r) => r.key.split(".")[0] === g).map((r) => {
              const it = item(r.key), isHidden = it ? hidden.includes(it) : false;
              return (
                <div key={r.key} className={`grid gap-2 px-3 py-2 lg:grid-cols-[14rem_1fr] ${isHidden ? "opacity-50" : ""}`}>
                  <div className="text-xs"><code className="break-all">{r.key}</code>{locale !== "en" && r.en && <p className="mt-1 text-muted-foreground">EN: {r.en}</p>}</div>
                  <div className="flex items-start gap-2">
                    <textarea className={TA} rows={Math.min(6, Math.max(1, Math.ceil(((own[r.key] ?? r.built) || r.en).length / 90)))} placeholder={r.built || r.en} value={own[r.key] ?? ""}
                      onChange={(e) => setOwn({ ...own, [r.key]: e.target.value })} data-testid={`lt-${r.key}`} />
                    <div className="flex flex-col gap-1">
                      {own[r.key] != null && own[r.key] !== "" && <Button type="button" size="sm" variant="ghost" title="Back to the built-in text" onClick={() => { const n = { ...own }; delete n[r.key]; setOwn(n); }}><RotateCcw className="size-4" aria-hidden /></Button>}
                      {it && r.key.endsWith(".1") === false && (r.key === `${it}` || /\.(t|q|v|area|name|label)$/.test(r.key) || /\.\d+$/.test(r.key)) && (
                        <Button type="button" size="sm" variant="ghost" title={isHidden ? "Show" : "Hide"} onClick={() => setHidden(isHidden ? hidden.filter((h) => h !== it) : [...hidden, it])} data-testid={`lt-hide-${it}`}>
                          {isHidden ? <Eye className="size-4" aria-hidden /> : <EyeOff className="size-4" aria-hidden />}
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </details>
      ))}
      <div className="sticky bottom-3 z-10 flex flex-wrap items-center gap-3 rounded-xl border bg-background/95 p-3 shadow-sm backdrop-blur">
        <Button type="button" disabled={pending} onClick={save} data-testid="lt-save"><Spin on={pending} icon={Check} /> Save texts ({locale})</Button>
        <a href="/welcome" target="_blank" rel="noopener" className="text-sm text-primary hover:underline">Open the page →</a>
        <Msg error={error} done={done} />
      </div>
    </div>
  );
}

/** Terms, privacy (GDPR) and cookies per language; empty = the starting text with the company details. */
export function LegalPagesForm({ settings, locales, starting }: { settings: LandingSettings; locales: { code: string; name: string }[]; starting: Record<LegalPage, Record<string, string>> }) {
  const { pending, error, done, run } = useRun();
  const [page, setPage] = useState<LegalPage>("privacy");
  const [lang, setLang] = useState("en");
  const [legal, setLegal] = useState(settings.legal);
  const cur = legal[page][lang] ?? "";
  const start = starting[page][lang.startsWith("pt") ? "pt" : "en"];
  return (
    <div className="space-y-3" data-testid="lp-form">
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-56"><Label className="text-xs">Page</Label><Select value={page} onChange={(e) => setPage(e.target.value as LegalPage)}>{LEGAL_PAGES.map((p) => <option key={p} value={p}>{p === "privacy" ? "Privacy policy (GDPR)" : p === "terms" ? "Terms of use" : "Cookies"}</option>)}</Select></div>
        <div className="w-56"><Label className="text-xs">Language</Label><Select value={lang} onChange={(e) => setLang(e.target.value)}>{locales.map((l) => <option key={l.code} value={l.code}>{l.name} ({l.code})</option>)}</Select></div>
        <a href={`/legal/${page}`} target="_blank" rel="noopener" className="text-sm text-primary hover:underline">Open →</a>
      </div>
      <p className="text-xs text-muted-foreground">{cur ? "FIRINGI's own text." : "Empty: the page shows the starting text below (English, or Portuguese for pt), filled with the company details. Copy it in to change it."} Have the final texts checked by FIRINGI&apos;s lawyer.</p>
      <textarea className={TA} rows={18} value={cur} placeholder={start} onChange={(e) => setLegal({ ...legal, [page]: { ...legal[page], [lang]: e.target.value } })} data-testid="lp-text" />
      <div className="flex flex-wrap items-center gap-3">
        {!cur && <Button type="button" variant="outline" size="sm" onClick={() => setLegal({ ...legal, [page]: { ...legal[page], [lang]: start } })}>Copy the starting text in</Button>}
        <Button type="button" disabled={pending} data-testid="lp-save" onClick={() => run(() => saveLandingSettingsAction({ ...settings, legal: Object.fromEntries(LEGAL_PAGES.map((p) => [p, Object.fromEntries(Object.entries(legal[p]).filter(([, v]) => v.trim()))])) as LandingSettings["legal"] }), undefined, "Saved.")}>
          <Spin on={pending} icon={Check} /> Save legal pages
        </Button>
        <Msg error={error} done={done} />
      </div>
    </div>
  );
}

export function DeleteSubscriber({ id }: { id: string }) {
  const { pending, error, run } = useRun();
  return (
    <span className="inline-flex items-center gap-1">
      <Button size="sm" variant="ghost" disabled={pending} title="Delete (GDPR request)" onClick={() => { if (window.confirm("Delete this subscriber for good?")) run(() => deleteSubscriberAction({ id })); }}><Trash2 className="size-4" aria-hidden /></Button>
      <Msg error={error} />
    </span>
  );
}
