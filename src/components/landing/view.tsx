/** Phase 56: shared parts of the public pages — language list, footer and the vendors' route picture. */
import { UI_LOCALES } from "@/i18n/config";
import type { LandingSettings } from "@/lib/landing";
import { Icon, type IconName } from "./icons";
import { LangSelect } from "./client";
import { Wordmark } from "@/components/brand/wordmark";

const FOOT: Record<"buy" | "sell" | "help" | "legal", string[]> = {
  buy: ["#buy", "#till", "#manage", "#save"],
  sell: ["/sell", "/sell#plans"],
  help: ["#faq", "#contact", "/status", "/login"],
  legal: ["/legal/terms", "/legal/privacy", "/legal/cookies", "/legal/company"],
};
/** FIRINGI's own pages (FIRINGI only), each shown when FIRINGI switched it on. */
const COMPANY: { page: "sustainability" | "careers"; href: string; n: number }[] = [{ page: "sustainability", href: "/sustainability", n: 1 }, { page: "careers", href: "/careers", n: 2 }];

export function languageList(locale: string) {
  return (UI_LOCALES as readonly string[]).map((code) => {
    let name = code;
    try { name = new Intl.DisplayNames([code], { type: "language" }).of(code) ?? code; } catch { /* keep the code */ }
    return { code, name: name.charAt(0).toLocaleUpperCase(code) + name.slice(1) };
  }).sort((a, b) => (a.code === locale ? -1 : b.code === locale ? 1 : a.name.localeCompare(b.name)));
}

type TFn = (key: string, v?: Record<string, string | number>) => string;

/** The footer (links, contact, socials, language, Livro de Reclamações, company line) and the floating WhatsApp button. */
export function LandingFooter({ s, t, locale, home, buy, whatsapp }: { s: LandingSettings; t: TFn; locale: string; home: boolean; buy?: { href: string; label: string }[]; whatsapp?: string }) {
  const langs = languageList(locale);
  const number = whatsapp ?? s.whatsapp;
  const wa = number ? `https://wa.me/${number}` : null;
  const year = new Date().getFullYear();
  const fix = (href: string) => (href.startsWith("#") && !home ? `/${href}` : href);
  return (
    <>
      <footer className="fg-foot">
        <div className="fg-wrap">
          <div className="fg-footcols">
            <div>
              <span className="fg-mark"><Wordmark /></span>
              <p className="fg-tagline">{t("foot.tag")}</p>
              <LangSelect locale={locale} locales={langs} label={t("langPicker")} />
              {(s.email || s.phone || wa) && (
                <div className="fg-contactline">
                  {s.email && <a href={`mailto:${s.email}`}>{s.email}</a>}
                  {s.phone && <a href={`tel:${s.phone.replace(/\s/g, "")}`}>{s.phone}</a>}
                </div>
              )}
              <div className="fg-social" data-testid="landing-social">
                {/* every icon shows; it becomes a link once FIRINGI enters it in admin (Marketing → Landing Page) */}
                {([
                  { k: "mail", label: "Email", href: s.email ? `mailto:${s.email}` : null, ext: false },
                  { k: "phone", label: "Phone", href: s.phone ? `tel:${s.phone.replace(/\s/g, "")}` : null, ext: false },
                  { k: "wa", label: "WhatsApp", href: wa, ext: true },
                  ...(["instagram", "facebook", "linkedin", "youtube", "tiktok"] as const).map((k) => ({ k, label: k.charAt(0).toUpperCase() + k.slice(1), href: s.social[k] || null, ext: true })),
                ] as { k: IconName; label: string; href: string | null; ext: boolean }[]).map((x) => x.href
                  ? <a key={x.k} href={x.href} aria-label={x.label} title={x.label} {...(x.ext ? { target: "_blank", rel: "noopener noreferrer" } : {})}><Icon name={x.k} size={20} /></a>
                  : <span key={x.k} className="off" title={x.label} aria-hidden="true"><Icon name={x.k} size={20} /></span>)}
              </div>
            </div>
            {(["buy", "sell", "help", "legal"] as const).map((g) => (
              <nav key={g} aria-label={t(`foot.${g}`)}>
                <h4>{t(`foot.${g}`)}</h4>
                {(g === "buy" && buy ? buy : FOOT[g].map((href, i) => ({ href: fix(href), label: t(`foot.links.${g}.${i + 1}`) }))).map((l) => <a key={l.href} href={l.href}>{l.label}</a>)}
              </nav>
            ))}
            {COMPANY.some((c) => s.about[c.page].on) && (
              <nav aria-label={t("foot.company")} data-testid="foot-company">
                <h4>{t("foot.company")}</h4>
                {COMPANY.filter((c) => s.about[c.page].on).map((c) => <a key={c.href} href={c.href} data-testid={`foot-${c.page}`}>{t(`foot.links.company.${c.n}`)}</a>)}
              </nav>
            )}
          </div>
          <div className="fg-legalrow">
            <span>{t("foot.rights", { year })}{(s.company.legalName || s.company.nif) && ` ${[s.company.legalName, s.company.nif && `NIF ${s.company.nif}`, s.company.address].filter(Boolean).join(" · ")}`}</span>
            <a className="fg-livro" href={s.livroUrl} target="_blank" rel="noopener noreferrer"><Icon name="book" size={18} />{t("foot.livro")}</a>
          </div>
        </div>
      </footer>
      {wa && <a className="fg-float" href={wa} aria-label="WhatsApp" target="_blank" rel="noopener noreferrer" data-testid="landing-float"><Icon name="wa" size={28} /></a>}
    </>
  );
}

/** Hero illustration: three vendors, one business, three routes drawn like a sea chart. */
export function RouteChart({ label, shop, vendors }: { label: string; shop: string; vendors: { name: string; slot: string }[] }) {
  const routes = ["M190 71 C 300 71, 330 200, 442 226", "M190 231 C 280 231, 350 232, 442 232", "M190 391 C 300 391, 330 262, 442 238"];
  const ys = [48, 208, 368];
  const trucks = [[325, 148], [327, 230], [325, 312]];
  return (
    <svg className="fg-chart" viewBox="0 0 560 460" role="img" aria-label={label}>
      <defs><pattern id="fg-grid" width="40" height="40" patternUnits="userSpaceOnUse"><path d="M40 0H0V40" fill="none" stroke="#fff" strokeOpacity=".2" strokeWidth="1" /></pattern></defs>
      <rect width="560" height="460" fill="url(#fg-grid)" />
      <g transform="translate(490 62)">
        <circle r="26" fill="none" stroke="#fff" strokeWidth="2" />
        <path d="M0 -22 L6 0 L0 22 L-6 0Z" fill="#fff" /><path d="M0 -22 L6 0 L-6 0Z" fill="#000" /><path d="M-22 0H22" stroke="#fff" strokeWidth="1.5" />
        <text y="-33" textAnchor="middle" fontFamily="Archivo Variable, Archivo, Arial, sans-serif" fontWeight="800" fontSize="13" fill="#fff">N</text>
      </g>
      {routes.map((d, i) => (
        <g key={i}>
          <path d={d} className="fg-flow" fill="none" stroke="#fff" strokeOpacity=".55" strokeWidth="3" strokeDasharray="2 9" strokeLinecap="round" />
          <path d={d} pathLength={1} fill="none" stroke="#fff" strokeWidth="4" strokeLinecap="round" className={"fg-draw d" + (i + 1)} />
        </g>
      ))}
      {vendors.map((v, i) => (
        <g key={i}>
          <rect x="14" y={ys[i]} width="178" height="46" rx="10" fill="#000" />
          <text x="28" y={ys[i] + 20} fontFamily="Archivo Variable, Archivo, Arial, sans-serif" fontWeight="800" fontSize="14.5" fill="#fff">{v.name}</text>
          <text x="28" y={ys[i] + 37} fontFamily="Public Sans, Arial, sans-serif" fontSize="12" fill="#fff" fillOpacity=".85">{v.slot}</text>
        </g>
      ))}
      {trucks.map(([x, y], i) => <g key={i} className="fg-truck-still"><circle cx={x} cy={y} r="13" fill="#000" stroke="#fff" strokeWidth="3" /><circle cx={x} cy={y} r="4" fill="#fff" /></g>)}
      {routes.map((d, i) => (
        <g key={i} className="fg-truck-move" opacity="0">
          <circle r="13" fill="#000" stroke="#fff" strokeWidth="3" /><circle r="4" fill="#fff" />
          <animateMotion dur="4.2s" begin={`${1.6 + i * 0.9}s`} repeatCount="indefinite" path={d} calcMode="spline" keyTimes="0;1" keySplines=".45 0 .25 1" />
          <animate attributeName="opacity" dur="4.2s" begin={`${1.6 + i * 0.9}s`} repeatCount="indefinite" values="0;1;1;0" keyTimes="0;.12;.82;1" />
        </g>
      ))}
      <rect className="fg-ping" x="440" y="204" width="64" height="64" rx="14" fill="none" stroke="#fff" strokeWidth="3" />
      <rect x="440" y="204" width="64" height="64" rx="14" fill="#fff" />
      <g fill="none" stroke="#D9231A" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M452 227l4-11h32l4 11zM452 227v29h40v-29M480 256v-14h-14v14" /></g>
      <text x="472" y="292" textAnchor="middle" fontFamily="Archivo Variable, Archivo, Arial, sans-serif" fontWeight="800" fontSize="15" fill="#fff">{shop}</text>
    </svg>
  );
}
