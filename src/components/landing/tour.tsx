/**
 * Phase 56: "See inside FIRINGI" — the wholesale customer's dashboard, drawn in code (sidebar, top bar, panels as in
 * the real app) so every word comes from the landing texts (25 languages, FIRINGI can edit them). Screens: overview,
 * cart (one €150 minimum for the whole cart, delivery today), till, margins/stock/staff, rewards and pay later.
 * The screens are pictures for visitors: hidden from screen readers (the slide caption says the same) and not clickable.
 */
import { Icon, type IconName } from "./icons";
import { Wordmark } from "@/components/brand/wordmark";

type T = (key: string, v?: Record<string, string | number>) => string;
type Ctx = { t: T; locale: string; vendors: string[] };

const PRODUCTS = [
  { price: 10.9, tier: 9.8, min: 10, hue: "#E9B949" },
  { price: 27.5, tier: 25.9, min: 5, hue: "#7FA650" },
  { price: 21.6, tier: 19.9, min: 10, hue: "#3F7CAC" },
  { price: 8.4, tier: 7.95, min: 20, hue: "#9AA5B1" },
];
const MINIMUM = 150;
/** Sidebar: [text number, icon] in the app's order. */
const NAV: [number, IconName][] = [[1, "list"], [2, "search"], [3, "cart"], [4, "receipt"], [7, "card"], [8, "file"], [5, "tag"], [6, "chat"]];

function fmt(locale: string) {
  const money = (n: number) => new Intl.NumberFormat(locale, { style: "currency", currency: "EUR" }).format(n);
  const day = (plus: number, o: Intl.DateTimeFormatOptions = { weekday: "long" }) => {
    const d = new Date(); d.setDate(d.getDate() + plus);
    try { return new Intl.DateTimeFormat(locale, o).format(d); } catch { return d.toDateString(); }
  };
  const time = (h: number, m: number) => { const d = new Date(2026, 0, 1, h, m); try { return new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" }).format(d); } catch { return `${h}:${m}`; } };
  return { money, day, time };
}
const lineTotal = (p: number, q: number) => q * (q >= PRODUCTS[p].min ? PRODUCTS[p].tier : PRODUCTS[p].price);

/** The customer's dashboard window: dark sidebar menu, top bar, content. */
function Frame({ t, children, title, active }: { t: T; children: React.ReactNode; title: string; active: number }) {
  return (
    <div className="fg-device" role="img" aria-label={t("tour.frame", { title })}>
      <div className="fg-devbar" aria-hidden="true"><i /><i /><i /><span>{t("tour.ui.url")}</span></div>
      <div className="fg-dapp" aria-hidden="true">
        <aside className="fg-dside">
          <div className="brand"><span><b><Wordmark /></b><small>{t("tour.ui.role")}</small></span></div>
          {NAV.map(([k, ic]) => (
            <span key={k} className={"it" + (k === active ? " on" : "")}><Icon name={ic} size={14} /><span>{t(`tour.ui.nav.${k}`)}</span></span>
          ))}
        </aside>
        <div className="fg-dmain">
          <div className="fg-dtop">
            <span className="sr"><Icon name="search" size={13} /><span className="tx">{t("tour.ui.search")}</span><kbd>Ctrl K</kbd></span>
            <span className="ic"><Icon name="bell" size={15} /><em>2</em></span>
            <span className="ic"><Icon name="cart" size={15} /></span>
            <b className="co">{t("tour.ui.company")}</b>
          </div>
          <div className="fg-dbody">{children}</div>
        </div>
      </div>
    </div>
  );
}

function Pack({ hue }: { hue: string }) {
  return (
    <svg className="fg-pack" viewBox="0 0 64 48" aria-hidden="true">
      <rect x="6" y="12" width="52" height="32" rx="4" fill={hue} />
      <path d="M6 16 L18 4 H46 L58 16Z" fill={hue} opacity=".7" />
      <rect x="22" y="22" width="20" height="12" rx="2" fill="#fff" opacity=".85" />
    </svg>
  );
}

function DashboardScreen({ t, locale, vendors }: Ctx) {
  const { money, day } = fmt(locale);
  const kpis = ["3", "1", money(2480.6), money(312.4)];
  return (
    <Frame t={t} title={t("tour.ui.nav.1")} active={1}>
      <div className="fg-hero2 st" style={{ "--i": 0 } as React.CSSProperties}>
        <div className="top">
          <div><span className="live"><i />{t("tour.ui.live")} · {day(0, { weekday: "long", day: "numeric", month: "long" })}</span>
            <b className="wl">{t("tour.ui.welcome", { name: t("tour.ui.person") })}</b><small>{t("tour.ui.company")} · {t("tour.ui.role")}</small></div>
          <svg className="spark" viewBox="0 0 120 40" aria-hidden="true"><path d="M2 34 L30 32 L44 30 L58 12 L72 22 L88 16 L104 8 L118 4" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" pathLength={1} className="sp" /></svg>
        </div>
        <div className="kp">
          {kpis.map((v, i) => <span key={i} className="k"><small>{t(`tour.ui.kpi.${i + 1}`)}</small><b>{v}</b></span>)}
        </div>
      </div>
      <div className="fg-dcard st" style={{ "--i": 3 } as React.CSSProperties}>
        <div className="hd"><b><Icon name="repeat" size={14} /> {t("tour.ui.reorder")}</b></div>
        <div className="rw">{vendors.slice(0, 2).map((v, i) => (
          <span key={v} className="mini"><b>{v}</b><small>{t("tour.ui.lastTime", { n: i ? 6 : 10 })}</small><span className="fg-appbtn sm"><Icon name="cart" size={12} /> {t("tour.ui.fill")}</span></span>
        ))}</div>
      </div>
      <div className="fg-dcard st" style={{ "--i": 4 } as React.CSSProperties}>
        <div className="hd"><b>{t("tour.ui.recent")}</b></div>
        {([["FR-10428", 319.6, "steps.3"], ["FR-10391", 248.15, "steps.4"]] as const).map(([n, a, s]) => (
          <div className="ord" key={n}><i className={s === "steps.3" ? "or" : "gr"} /><b>{n}</b><span>{money(a)}</span><small>{t(`tour.ui.${s}`)}</small></div>
        ))}
      </div>
    </Frame>
  );
}

function CartScreen({ t, locale, vendors }: Ctx) {
  const { money } = fmt(locale);
  const groups = [{ v: vendors[0], lines: [[0, 10], [2, 6]] as const }, { v: vendors[1], lines: [[1, 3]] as const }];
  const total = groups.reduce((a, g) => a + g.lines.reduce((b, [p, q]) => b + lineTotal(p, q), 0), 0);
  return (
    <Frame t={t} title={t("app.bands.buy.h")} active={3}>
      <h4 className="fg-apptitle">{t("tour.ui.cart")}</h4>
      {groups.map((g, gi) => (
        <div className="fg-cgroup st" style={{ "--i": gi } as React.CSSProperties} key={gi}>
          <div className="hd"><b>{g.v}</b><span><Icon name="truck" size={13} /> {t("tour.ui.next")}</span></div>
          {g.lines.map(([p, q]) => (
            <div className="ln" key={p}><Pack hue={PRODUCTS[p].hue} /><span className="nm">{t(`tour.products.${p + 1}`)}</span><span className="q">× {q}</span><b>{money(lineTotal(p, q))}</b></div>
          ))}
        </div>
      ))}
      <div className="fg-cgroup st" style={{ "--i": 2 } as React.CSSProperties}>
        <div className="mn" style={{ marginTop: 0 }}><span className="bar"><i style={{ "--w": Math.min(1, total / MINIMUM) } as React.CSSProperties} className="ok" /></span>
          <span className="ok">{t("tour.ui.minOk")} ({money(MINIMUM)}) · {t("tour.ui.next")}</span></div>
      </div>
      <div className="fg-ctotal st" style={{ "--i": 3 } as React.CSSProperties}><span>{t("tour.ui.total")}</span><b>{money(total)}</b><span className="fg-appbtn">{t("tour.ui.checkout")}</span></div>
    </Frame>
  );
}

function TillScreen({ t, locale }: Ctx) {
  const { money } = fmt(locale);
  const items = [0.8, 1.3, 3.5, 1.0, 1.2, 1.8];
  const ticket: [number, number][] = [[0, 2], [4, 2], [2, 1]];
  const total = ticket.reduce((a, [i, q]) => a + items[i] * q, 0);
  return (
    <Frame t={t} title={t("app.bands.till.h")} active={7}>
      <div className="fa-pos">
        <div className="tiles">{items.map((pr, i) => (
          <span key={i} className={"tile st" + ([0, 4, 2].includes(i) ? " hit" : "")} style={{ "--i": i } as React.CSSProperties}><b>{t(`app.pos.items.${i + 1}`)}</b><small>{money(pr)}</small></span>
        ))}</div>
        <div className="tk st" style={{ "--i": 3 } as React.CSSProperties}>
          <b className="hd">{t("app.pos.ticket")} #0142</b>
          {ticket.map(([i, q], n) => <span key={i} className="ln" style={{ "--i": n } as React.CSSProperties}><span>{q} × {t(`app.pos.items.${i + 1}`)}</span><b>{money(items[i] * q)}</b></span>)}
          <span className="nif">{t("app.pos.nif")}: 245 *** 118</span>
          <span className="tot"><span>{t("app.pos.total")}</span><b>{money(total)}</b></span>
          <span className="pay"><span className="fg-appbtn">{t("app.pos.card")}</span><span className="fg-appbtn mb"><span className="mbw">MB WAY</span></span><span className="fg-appbtn ghost">{t("app.pos.cash")}</span></span>
        </div>
      </div>
    </Frame>
  );
}

function ManageScreen({ t, locale }: Ctx) {
  const { money, time } = fmt(locale);
  const cost = 1.12, price = 3.5, margin = Math.round((1 - cost / price) * 100);
  return (
    <Frame t={t} title={t("app.bands.manage.h")} active={8}>
      <div className="fa-mng">
        <div className="fg-dcard st" style={{ "--i": 0, marginTop: 0 } as React.CSSProperties}>
          <div className="hd"><b>{t("app.mng.recipe")}</b></div>
          <b className="dish">{t("app.mng.dish")}</b>
          <div className="ring" style={{ "--p": margin } as React.CSSProperties}><span><b>{margin}%</b><small>{t("app.mng.margin")}</small></span></div>
          <div className="cp"><span><small>{t("app.mng.cost")}</small><b>{money(cost)}</b></span><span><small>{t("app.mng.price")}</small><b>{money(price)}</b></span></div>
        </div>
        <div className="col">
          <div className="fg-dcard st" style={{ "--i": 1, marginTop: 0 } as React.CSSProperties}>
            <div className="hd"><b>{t("app.mng.stock")}</b></div>
            <div className="al"><i className="or" /><span>{t("tour.products.4")}</span><small>{t("app.mng.low", { n: 2 })}</small></div>
            <div className="al"><i className="rd" /><span>{t("tour.products.3")}</span><small>{t("app.mng.expiry", { n: 5 })}</small></div>
          </div>
          <div className="fg-dcard st" style={{ "--i": 2 } as React.CSSProperties}>
            <div className="hd"><b>{t("app.mng.staff")}</b></div>
            {[[8, 16], [11, 19], [16, 23]].map(([a, b], i) => (
              <div className="al" key={i}><i className="av">{t(`app.mng.people.${i + 1}`).charAt(0)}</i><span>{t(`app.mng.people.${i + 1}`)}</span><small>{time(a, 0)}–{time(b === 23 ? 23 : b, 0)}</small></div>
            ))}
          </div>
        </div>
      </div>
    </Frame>
  );
}

function SaveScreen({ t, locale }: Ctx) {
  const { money } = fmt(locale);
  const nf = new Intl.NumberFormat(locale);
  return (
    <Frame t={t} title={t("app.bands.save.h")} active={5}>
      <div className="fa-pts st" style={{ "--i": 0 } as React.CSSProperties}>
        <b>{t("app.sv.points", { n: nf.format(1240) })}</b>
        <span className="bar"><i style={{ "--w": 0.83 } as React.CSSProperties} /></span>
        <small>{t("app.sv.next", { n: nf.format(260) })}</small>
      </div>
      <h4 className="fg-apptitle" style={{ marginTop: 12 }}>{t("app.sv.rewards")}</h4>
      <div className="fa-rw">{[1000, 400, 2500].map((pts, i) => (
        <span key={i} className="st" style={{ "--i": i + 1 } as React.CSSProperties}><Icon name={(["tag", "truck", "check"] as IconName[])[i]} size={18} /><b>{t(`app.sv.items.${i + 1}`)}</b><small>{t("app.sv.pts", { n: nf.format(pts) })}</small></span>
      ))}</div>
      <div className="fa-two">
        <div className="fg-dcard st" style={{ "--i": 4 } as React.CSSProperties}><div className="hd"><b><Icon name="calendar" size={14} /> {t("app.sv.later")}</b></div><small>{t("app.sv.laterP", { amount: money(2000) })}</small></div>
        <div className="fg-dcard st" style={{ "--i": 5 } as React.CSSProperties}><div className="hd"><b><Icon name="users" size={14} /> {t("app.sv.group")}</b></div></div>
      </div>
    </Frame>
  );
}

/** The screens of the app-first landing page. */
export function appScreen(kind: "dashboard" | "buy" | "till" | "manage" | "save", c: Ctx) {
  const S = { dashboard: DashboardScreen, buy: CartScreen, till: TillScreen, manage: ManageScreen, save: SaveScreen }[kind];
  return <S {...c} />;
}
