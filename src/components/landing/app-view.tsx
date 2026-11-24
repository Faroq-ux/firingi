/**
 * Phase 56 (design 2): the app-first landing page — "Buy, sell and run your business in one app". Few words, big moving
 * pictures of the real customer dashboard: buy (one cart, every wholesaler), till, manage (margins, stock, staff), save.
 * FIRINGI's colours; every text from the landing texts (editable in admin, 25 languages).
 */
import "./landing.css";
import "./app-landing.css";
import Link from "next/link";
import { landingPage } from "@/server/landing/service";
import { fill, listItems, lookup, planBullets, type LandingSection } from "@/lib/landing";
import { Icon, type IconName } from "./icons";
import { ContactForm, Faq, LandingFx, LangSelect, MobileMenu, NewsletterForm } from "./client";
import { appScreen } from "./tour";
import { LandingFooter, languageList, RouteChart } from "./view";
import { Wordmark } from "@/components/brand/wordmark";

const BANDS: { key: "buy" | "till" | "manage" | "save"; icon: IconName }[] = [
  { key: "buy", icon: "cart" }, { key: "till", icon: "card" }, { key: "manage", icon: "sliders" }, { key: "save", icon: "tag" },
];
const CAT_COLORS = ["#D9231A", "#0f172a", "#E9B949", "#3F7CAC", "#7FA650", "#a855f7", "#f97316"];

export async function AppLandingView({ locale }: { locale: string }) {
  const { settings: s, src } = await landingPage(locale);
  const t = (key: string, v?: Record<string, string | number>) => fill(lookup(src, key), v);
  const items = (prefix: string) => listItems(src, prefix, s.hidden);
  const on = (k: LandingSection) => s.sections[k];
  const ctx = { t, locale, vendors: [1, 2, 3].map((v) => t(`chart.vendors.${v}.name`)) };
  const nav = [
    ...BANDS.filter((b) => on(b.key)).map((b) => ({ href: `#${b.key}`, label: t(`app.nav.${b.key}`) })),
    ...(on("faq") ? [{ href: "#faq", label: t("app.nav.faq") }] : []),
    ...(on("vendors") ? [{ href: "/sell", label: t("app.nav.vendors") }] : []),
  ];
  const cats = items("app.cats.items").map((n) => t(`app.cats.items.${n}`));
  const half = Math.ceil(cats.length / 2);
  const wa = s.whatsapp ? `https://wa.me/${s.whatsapp}` : null;

  return (
    <div className="fg fa" lang={locale} data-testid="landing">
      <a className="fg-skip" href="#main">FIRINGI</a>
      <LandingFx />
      <header className="fa-head">
        <SiteHeader t={t} locale={locale} nav={nav} />
        <section className="fa-hero">
          <div className="fg-wrap fa-herogrid">
            <div className="copy">
              <span className="fa-eyebrow"><i />{t("app.hero.eyebrow")}</span>
              <h1 className="fg-disp" data-testid="landing-h1">{t("app.hero.h1a")} <span className="hl">{t("app.hero.h1b")}</span> {t("app.hero.h1c")}</h1>
              <p className="lead">{t("app.hero.lead")}</p>
              <div className="fg-cta">
                <Link className="fg-btn red" href="/register">{t("open")} <Icon name="right" size={18} /></Link>
                <a className="fg-btn line" href="#buy">{t("app.hero.cta2")}</a>
              </div>
              <p className="note"><Icon name="check" size={16} /> {t("app.hero.note")}</p>
            </div>
            <div className="fa-stage" aria-hidden="false">
              <span className="glow" aria-hidden="true" />
              <div className="fa-shot in tilt">{appScreen("dashboard", ctx)}</div>
              <span className="fa-chip c1" aria-hidden="true"><i className="g"><Icon name="truck" size={15} /></i>{t("app.float.1")}</span>
              <span className="fa-chip c2" aria-hidden="true"><i className="b"><Icon name="receipt" size={15} /></i>{t("app.float.2")}</span>
              <span className="fa-chip c3" aria-hidden="true"><i className="r"><Icon name="tag" size={15} /></i>{t("app.float.3")}</span>
            </div>
          </div>
        </section>
      </header>

      <main id="main">
        {on("stats") && <div className="fa-statswrap">
          <div className="fg-wrap">
            <dl className="fa-stats">
              {items("app.stats").map((n) => <div key={n}><dt>{t(`app.stats.${n}.v`)}</dt><dd>{t(`app.stats.${n}.l`)}</dd></div>)}
            </dl>
          </div>
        </div>}

        {on("cats") && cats.length > 0 && (
          <section className="fa-sec fa-cats" aria-labelledby="fa-cats-h">
            <div className="fg-wrap"><h2 className="fg-disp" id="fa-cats-h">{t("app.cats.h")}</h2><p className="sub">{t("app.cats.p")}</p></div>
            {[cats.slice(0, half), cats.slice(half)].map((row, r) => (
              <div className={"fa-marq" + (r ? " rev" : "")} key={r}>
                <div className="trk">
                  {[0, 1].map((dup) => row.map((c, i) => (
                    <span className="fa-cat" key={`${dup}-${i}`} aria-hidden={dup === 1}><i style={{ background: CAT_COLORS[(i + r * 3) % CAT_COLORS.length] }} />{c}</span>
                  )))}
                </div>
              </div>
            ))}
          </section>
        )}

        {BANDS.filter((b) => on(b.key)).map((b, i) => (
          <section className={"fa-band" + (i % 2 ? " flip" : "")} id={b.key} key={b.key}>
            <div className="fg-wrap fa-bandgrid">
              <div className="copy">
                <span className="fa-tag"><Icon name={b.icon} size={16} />{t(`app.bands.${b.key}.tag`)}</span>
                <h2 className="fg-disp">{t(`app.bands.${b.key}.h`)}</h2>
                <p>{t(`app.bands.${b.key}.p`)}</p>
                <ul className="fa-checks">{items(`app.bands.${b.key}.b`).map((n) => <li key={n}><Icon name="check" size={18} />{t(`app.bands.${b.key}.b.${n}`)}</li>)}</ul>
              </div>
              <div className="fa-shot">{appScreen(b.key, ctx)}</div>
            </div>
          </section>
        ))}

        {on("start") && <section className="fa-sec fa-start">
          <div className="fg-wrap">
            <h2 className="fg-disp">{t("app.start.h")}</h2>
            <div className="fa-steps">
              {items("app.start.steps").map((n, i) => (
                <div className="fa-step" key={n}><b className="n">{i + 1}</b><h3 className="fg-disp">{t(`app.start.steps.${n}.t`)}</h3><p>{t(`app.start.steps.${n}.p`)}</p></div>
              ))}
            </div>
            <div className="fg-cta" style={{ justifyContent: "center" }}><Link className="fg-btn red" href="/register">{t("open")} <Icon name="right" size={18} /></Link></div>
          </div>
        </section>}

        {on("faq") && (
          <section className="fa-sec" id="faq">
            <div className="fg-wrap"><h2 className="fg-disp">{t("faq.h2")}</h2>
              <Faq items={items("faq.items").map((n) => ({ q: t(`faq.items.${n}.q`), a: t(`faq.items.${n}.a`) })).filter((f) => f.q && f.a)} />
            </div>
          </section>
        )}

        {on("contact") && (
          <section className="fa-sec alt" id="contact">
            <div className="fg-wrap">
              <h2 className="fg-disp">{t("contact.h2")}</h2><p className="sub">{t("contact.sub")}</p>
              <div className="fg-two">
                <ContactForm kind="QUESTION" l={{
                  name: t("contact.name"), company: t("contact.company"), email: t("contact.email"), phone: t("contact.phone"), nif: t("contact.nif"), type: t("contact.type"),
                  types: items("contact.types").map((n) => t(`contact.types.${n}`)), msg: t("contact.msg"), vendorMsg: t("contact.vendorMsg"), consent: t("contact.consent"),
                  send: t("contact.send"), sending: t("contact.sending"), sent: t("contact.sent"), errRequired: t("contact.errRequired"), errEmail: t("contact.errEmail"),
                  errConsent: t("contact.errConsent"), errSpam: t("contact.errSpam"), errBusy: t("contact.errBusy"),
                }} />
                {wa && (
                  <div className="fg-tile fg-wa"><Icon name="wa" /><h3 className="fg-disp">{t("contact.waT")}</h3><p>{t("contact.waP")}</p>
                    <div className="fg-cta" style={{ marginTop: 14 }}><a className="fg-btn white sm" href={wa} target="_blank" rel="noopener noreferrer" data-testid="landing-wa">{t("contact.waB")}</a></div></div>
                )}
              </div>
            </div>
          </section>
        )}

        {(on("final") || on("newsletter")) && (
          <section className="fg-final fa-final" id="start">
            <div className="fg-wrap">
              {on("final") && <><h2 className="fg-disp">{t("final.h2")}</h2><p>{t("final.p")}</p>
                <div className="fg-cta"><Link className="fg-btn black" href="/register">{t("open")}</Link></div></>}
              {on("newsletter") && <div style={{ marginTop: on("final") ? 44 : 0 }} id="newsletter">
                <p style={{ fontWeight: 700 }}>{t("news.label")}</p>
                <NewsletterForm l={{ ph: t("news.ph"), btn: t("news.btn"), consent: t("news.consent"), sent: t("news.sent"), sending: t("contact.sending"), errEmail: t("contact.errEmail"), errConsent: t("contact.errConsent"), errSpam: t("contact.errSpam"), errBusy: t("contact.errBusy"), errRequired: t("contact.errRequired") }} />
                <p style={{ fontSize: 13.5, marginTop: 8, opacity: 0.85 }}>{t("news.note")}</p>
              </div>}
            </div>
          </section>
        )}
      </main>

      <LandingFooter s={s} t={t} locale={locale} home />
    </div>
  );
}

type TFn = (key: string, v?: Record<string, string | number>) => string;

/** The white top bar of the public pages (docks to the top when scrolling). */
function SiteHeader({ t, locale, nav }: { t: TFn; locale: string; nav: { href: string; label: string }[] }) {
  return (
    <div className="fg-navbar"><div className="fg-navin"><div className="fg-wrap">
      <div className="fg-nav">
        <Link className="fg-mark" href="/" aria-label="FIRINGI"><Wordmark /></Link>
        <div className="fg-navr">
          <nav className="fg-links" aria-label="Main">
            {nav.map((l) => <a key={l.href} href={l.href}>{l.label}</a>)}
            <a href="/login" data-testid="landing-login">{t("login")}</a>
            <Link className="fg-btn red sm" href="/register" data-testid="landing-open">{t("open")}</Link>
          </nav>
          <LangSelect locale={locale} locales={languageList(locale)} label={t("langPicker")} />
          <MobileMenu links={nav} cta={t("open")} ctaHref="/register" login={t("login")} open={t("menuOpen")} close={t("menuClose")} />
        </div>
      </div>
    </div></div></div>
  );
}

const VROW_ICONS: IconName[] = ["sliders", "queue", "truck", "wallet"];

/** "Sell on FIRINGI" (/sell): the vendors' page, reached only from the menu and the footer. */
export async function SellLandingView({ locale }: { locale: string }) {
  const { settings: s, src, plans } = await landingPage(locale);
  const t = (key: string, v?: Record<string, string | number>) => fill(lookup(src, key), v);
  const items = (prefix: string) => listItems(src, prefix, s.hidden);
  const money = (n: number) => new Intl.NumberFormat(locale, { style: "currency", currency: "EUR", maximumFractionDigits: n % 1 ? 2 : 0 }).format(n);
  const nav = [
    ...BANDS.map((b) => ({ href: `/#${b.key}`, label: t(`app.nav.${b.key}`) })),
    { href: "#types", label: t("sellPage.types.wholesaler.t") + " / " + t("sellPage.types.distributor.t") },
    ...(s.sections.plans && plans.length ? [{ href: "#plans", label: t("sellPage.navPlans") }] : []),
    { href: "#vendor-form", label: t("vendors.cta") },
  ];
  const waNumber = s.whatsappVendors || s.whatsapp;
  const wa = waNumber ? `https://wa.me/${waNumber}` : null;
  return (
    <div className="fg fa" lang={locale} data-testid="landing">
      <a className="fg-skip" href="#main">FIRINGI</a>
      <LandingFx />
      <header className="fa-head">
        <SiteHeader t={t} locale={locale} nav={nav} />
        <section className="fa-hero">
          <div className="fg-wrap fa-herogrid">
            <div className="copy">
              <span className="fa-eyebrow"><i />{t("app.nav.vendors")}</span>
              <h1 className="fg-disp" data-testid="landing-h1">{t("vendors.h2")}</h1>
              <p className="lead">{t("vendors.sub")}</p>
              <div className="fg-cta">
                <a className="fg-btn red" href="#vendor-form">{t("vendors.cta")} <Icon name="right" size={18} /></a>
                <Link className="fg-btn line" href="/login">{t("login")}</Link>
              </div>
            </div>
            <div className="fa-routes">
              <RouteChart label={t("chart.label")} shop={t("chart.shop")} vendors={items("chart.vendors").slice(0, 3).map((n) => ({ name: t(`chart.vendors.${n}.name`), slot: t(`chart.vendors.${n}.slot`) }))} />
            </div>
          </div>
        </section>
      </header>

      <main id="main">
        <section className="fa-sec" id="types">
          <div className="fg-wrap">
            <h2 className="fg-disp">{t("sellPage.typesH2")}</h2><p className="sub">{t("sellPage.typesSub")}</p>
            <div className="fa-types">
              {(["wholesaler", "distributor"] as const).map((k) => (
                <div className={"fa-type " + k} key={k} data-testid={`sell-type-${k}`}>
                  <span className="ic"><Icon name={k === "wholesaler" ? "pin" : "truck"} size={26} /></span>
                  <h3 className="fg-disp">{t(`sellPage.types.${k}.t`)}</h3>
                  <p>{t(`sellPage.types.${k}.p`)}</p>
                  <ul className="fa-checks">{items(`sellPage.types.${k}.b`).map((n) => <li key={n}><Icon name="check" size={18} />{t(`sellPage.types.${k}.b.${n}`)}</li>)}</ul>
                  <Link className={"fg-btn " + (k === "distributor" ? "red" : "ink")} href={`/register/${k}`}>{t(`sellPage.types.${k}.cta`)} <Icon name="right" size={18} /></Link>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="fa-sec alt" id="vendors">
          <div className="fg-wrap">
            <h2 className="fg-disp">{t("sellPage.rowsH2")}</h2>
            <div className="fa-vgrid">
              {items("vendors.rows").map((n, i) => (
                <div className="fa-step" key={n}><b className="n"><Icon name={VROW_ICONS[i % 4]} size={20} /></b><h3 className="fg-disp">{t(`vendors.rows.${n}.t`)}</h3><p>{t(`vendors.rows.${n}.p`)}</p></div>
              ))}
            </div>
          </div>
        </section>

        {s.sections.plans && plans.length > 0 && (
          <section className="fa-sec" id="plans">
            <div className="fg-wrap">
              <h2 className="fg-disp">{t("plans.h2")}</h2><p className="sub">{t("plans.sub")}</p>
              <div className="fg-plans" data-testid="landing-plans">
                {plans.map((p, i) => {
                  const top = plans.length >= 3 ? i === 1 : false;
                  return (
                    <div className={"fg-plan" + (top ? " top" : "")} key={p.code} data-testid="landing-plan">
                      {top && <span className="fg-badge">{t("plans.top")}</span>}
                      <h3 className="pn fg-disp">{p.name}</h3>
                      <div className="pp"><b>{money(p.monthlyPrice)}</b><span>{t("plans.per")}</span></div>
                      <p className="pd">{p.description}</p>
                      <ul className="fg-checks">{planBullets(p, t, locale).map((x, j) => <li key={j}><Icon name="check" /><span>{x}</span></li>)}</ul>
                      <Link className={"fg-btn " + (top ? "red" : "ink")} href="/register">{p.monthlyPrice === 0 ? t("plans.start") : t("plans.choose", { name: p.name })}</Link>
                    </div>
                  );
                })}
              </div>
              <p className="fg-note">{t("plans.note")}</p>
            </div>
          </section>
        )}

        <section className="fa-sec alt" id="vendor-form">
          <div className="fg-wrap">
            <h2 className="fg-disp">{t("sellPage.formH2")}</h2><p className="sub">{t("sellPage.formSub")}</p>
            <div className="fg-two">
              <ContactForm kind="VENDOR" l={{
                vendorType: t("contact.vendorType"), vendorTypes: { WHOLESALER: t("contact.vendorTypes.WHOLESALER"), DISTRIBUTOR: t("contact.vendorTypes.DISTRIBUTOR") },
                name: t("contact.name"), company: t("contact.company"), email: t("contact.email"), phone: t("contact.phone"), nif: t("contact.nif"), type: t("contact.type"),
                types: items("contact.types").map((n) => t(`contact.types.${n}`)), msg: t("contact.msg"), vendorMsg: t("contact.vendorMsg"), consent: t("contact.consent"),
                send: t("contact.send"), sending: t("contact.sending"), sent: t("contact.sent"), errRequired: t("contact.errRequired"), errEmail: t("contact.errEmail"),
                errConsent: t("contact.errConsent"), errSpam: t("contact.errSpam"), errBusy: t("contact.errBusy"),
              }} />
              {wa && (
                <div className="fg-tile fg-wa"><Icon name="wa" /><h3 className="fg-disp">{t("contact.waT")}</h3><p>{t("contact.waP")}</p>
                  <div className="fg-cta" style={{ marginTop: 14 }}><a className="fg-btn white sm" href={wa} target="_blank" rel="noopener noreferrer">{t("contact.waB")}</a></div></div>
              )}
            </div>
          </div>
        </section>
      </main>

      <LandingFooter s={s} t={t} locale={locale} home={false} whatsapp={waNumber} />
    </div>
  );
}
