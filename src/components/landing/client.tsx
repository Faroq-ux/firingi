"use client";
/** Phase 56: the landing page's interactive parts — menu, language, price calculator, questions, contact and newsletter forms. */
import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "./icons";
import { setLandingLocaleAction, submitApplicationAction, submitContactAction, subscribeNewsletterAction } from "@/server/actions/landing";


export function LangSelect({ locale, locales, label }: { locale: string; locales: { code: string; name: string }[]; label: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <select className="fg-langsel" aria-label={label} value={locale} disabled={pending} data-testid="landing-lang"
      onChange={(e) => { const v = e.target.value; start(async () => { await setLandingLocaleAction(v); router.refresh(); }); }}>
      {locales.map((l) => <option key={l.code} value={l.code}>{l.name}</option>)}
    </select>
  );
}

export function MobileMenu({ links, cta, ctaHref, login, open: openL, close: closeL }: { links: { href: string; label: string }[]; cta: string; ctaHref: string; login: string; open: string; close: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className="fg-burger" aria-label={open ? closeL : openL} aria-expanded={open} onClick={() => setOpen(!open)} data-testid="landing-burger">
        <Icon name={open ? "close" : "menu"} size={22} />
      </button>
      <div className={"fg-drawer" + (open ? " open" : "")}>
        {links.map((l) => <a key={l.href} href={l.href} onClick={() => setOpen(false)}>{l.label}</a>)}
        <a href="/login" onClick={() => setOpen(false)}>{login}</a>
        <a className="fg-btn red" href={ctaHref} onClick={() => setOpen(false)}>{cta}</a>
      </div>
    </>
  );
}

export function Faq({ items }: { items: { q: string; a: string }[] }) {
  const [open, setOpen] = useState(0);
  return (
    <div className="fg-faq" data-testid="landing-faq">
      {items.map((f, i) => (
        <div className="fg-q" key={i}>
          <h3>
            <button aria-expanded={open === i} aria-controls={`fg-a${i}`} onClick={() => setOpen(open === i ? -1 : i)}>
              {f.q}<Icon name="plus" />
            </button>
          </h3>
          <div className={"fg-acc" + (open === i ? " open" : "")} id={`fg-a${i}`} aria-hidden={open !== i} inert={open !== i}>
            <div><p className="fg-a">{f.a}</p></div>
          </div>
        </div>
      ))}
    </div>
  );
}

export type ContactTexts = {
  vendorType?: string; vendorTypes?: { WHOLESALER: string; DISTRIBUTOR: string };
  name: string; company: string; email: string; phone: string; nif: string; type: string; types: string[]; msg: string; vendorMsg: string;
  consent: string; send: string; sending: string; sent: string; errRequired: string; errEmail: string; errConsent: string; errSpam: string; errBusy: string;
};

const errText = (p: string, l: { errRequired: string; errEmail: string; errConsent: string; errSpam: string; errBusy: string }) =>
  p === "EMAIL" ? l.errEmail : p === "CONSENT" ? l.errConsent : p === "BUSY" ? l.errBusy : p === "SPAM" ? l.errSpam : l.errRequired;

/** A question (landing page) or a vendor application (/sell): both become CRM leads. */
export function ContactForm({ kind, l }: { kind: "QUESTION" | "VENDOR"; l: ContactTexts }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const started = useRef(0);
  useEffect(() => { started.current = Date.now(); }, []);
  const vendor = kind === "VENDOR";
  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget), s = (k: string) => String(f.get(k) ?? "");
    const form = e.currentTarget;
    start(async () => {
      const r = await submitContactAction({
        kind, name: s("name"), company: s("company"), email: s("email"), phone: s("phone"), nif: vendor ? s("nif") : "",
        type: vendor ? "" : s("type"), vendorType: vendor ? (s("vendorType") === "WHOLESALER" ? "WHOLESALER" : "DISTRIBUTOR") : undefined, message: s("message"), consent: f.get("consent") === "on", website: s("website"), startedAt: started.current,
      });
      if (r.ok) { setMsg({ ok: true, text: l.sent }); form.reset(); started.current = Date.now(); }
      else setMsg({ ok: false, text: errText(r.problem, l) });
    });
  };
  return (
    <form className="fg-form" onSubmit={onSubmit} noValidate data-testid={vendor ? "vendor-form" : "contact-form"}>
      <div className="fg-fields">
        {vendor && l.vendorTypes && (
          <label className="fg-field wide">{l.vendorType}<select name="vendorType" defaultValue="WHOLESALER" data-testid="vendor-type">
            <option value="WHOLESALER">{l.vendorTypes.WHOLESALER}</option><option value="DISTRIBUTOR">{l.vendorTypes.DISTRIBUTOR}</option>
          </select></label>
        )}
        <label className="fg-field">{l.name}<input name="name" autoComplete="name" required maxLength={120} /></label>
        <label className="fg-field">{l.company}<input name="company" autoComplete="organization" required maxLength={160} /></label>
        <label className="fg-field">{l.email}<input name="email" type="email" autoComplete="email" required maxLength={254} /></label>
        <label className="fg-field">{l.phone}<input name="phone" type="tel" autoComplete="tel" maxLength={40} /></label>
        {vendor
          ? <label className="fg-field">{l.nif}<input name="nif" maxLength={20} /></label>
          : <label className="fg-field">{l.type}<select name="type">{l.types.map((t) => <option key={t}>{t}</option>)}</select></label>}
        <label className="fg-field wide">{vendor ? l.vendorMsg : l.msg}<textarea name="message" maxLength={4000} /></label>
      </div>
      <label className="fg-hp" aria-hidden="true">Website<input name="website" tabIndex={-1} autoComplete="off" /></label>
      <label className="fg-consent"><input type="checkbox" name="consent" /><span>{l.consent}</span></label>
      <button className="fg-btn red" type="submit" disabled={pending} data-testid="contact-send">{pending ? l.sending : l.send}</button>
      {msg && <p className={"fg-msg" + (msg.ok ? "" : " err")} role={msg.ok ? "status" : "alert"} data-testid="contact-msg">{msg.text}</p>}
    </form>
  );
}

export function NewsletterForm({ l }: { l: { ph: string; btn: string; consent: string; sent: string; sending: string; errEmail: string; errConsent: string; errSpam: string; errBusy: string; errRequired: string } }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const started = useRef(0);
  useEffect(() => { started.current = Date.now(); }, []);
  return (
    <form data-testid="news-form" noValidate onSubmit={(e) => {
      e.preventDefault();
      const f = new FormData(e.currentTarget), form = e.currentTarget;
      start(async () => {
        const r = await subscribeNewsletterAction({ email: String(f.get("email") ?? ""), consent: f.get("consent") === "on", website: String(f.get("website") ?? ""), startedAt: started.current });
        if (r.ok) { setMsg({ ok: true, text: l.sent }); form.reset(); } else setMsg({ ok: false, text: errText(r.problem, l) });
      });
    }}>
      <div className="fg-news">
        <input type="email" name="email" placeholder={l.ph} aria-label={l.ph} autoComplete="email" maxLength={254} />
        <button className="fg-btn black" type="submit" disabled={pending} data-testid="news-send">{pending ? l.sending : l.btn}</button>
      </div>
      <label className="fg-hp" aria-hidden="true">Website<input name="website" tabIndex={-1} autoComplete="off" /></label>
      <label className="fg-consent"><input type="checkbox" name="consent" /><span>{l.consent}</span></label>
      {msg && <p className={"fg-msg" + (msg.ok ? "" : " err")} role={msg.ok ? "status" : "alert"} data-testid="news-msg">{msg.text}</p>}
    </form>
  );
}

const REVEAL = [
  ".fg-sec h2", ".fg-sec .sub", ".fg-step", ".fg-feat", ".fg-tile", ".fg-plan", ".fg-q", ".fg-chip", ".fg-vrow", ".fg-scroll", ".fg-checks li",
  ".fg-calcgrid > *", ".fg-pnotes > div", ".fg-form", ".fg-final h2", ".fg-final p", ".fg-final .fg-cta", ".fg-footcols > *", ".fg-note", ".fg-h3",
  ".fa-band .copy > *", ".fa-shot:not(.in)", ".fa-step", ".fa-sec h2", ".fa-sec .sub",
].join(",");

/** The page's motion: reveals on scroll, the docking menu, the menu marking where you are, facts counting up. Nothing runs for "reduce motion". */
export function LandingFx() {
  useEffect(() => {
    const root = document.querySelector<HTMLElement>(".fg");
    if (!root) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const cleanups: (() => void)[] = [];

    // docking menu
    const bar = root.querySelector<HTMLElement>(".fg-navbar"), inner = root.querySelector<HTMLElement>(".fg-navin");
    if (bar && inner) {
      let docked = false, ticking = false;
      const check = () => {
        ticking = false;
        const dock = window.scrollY > bar.offsetTop + bar.offsetHeight + 120;
        if (dock === docked) return;
        docked = dock;
        if (dock) bar.style.height = `${inner.offsetHeight}px`; else bar.style.height = "";
        root.classList.toggle("scrolled", dock);
      };
      const onScroll = () => { if (!ticking) { ticking = true; requestAnimationFrame(check); } };
      window.addEventListener("scroll", onScroll, { passive: true });
      check();
      cleanups.push(() => window.removeEventListener("scroll", onScroll));
    }

    // menu marks the section on screen
    const links = [...root.querySelectorAll<HTMLAnchorElement>('.fg-links a[href^="#"]')];
    const secs = links.map((a) => document.getElementById(a.hash.slice(1))).filter((x): x is HTMLElement => !!x);
    if (secs.length && "IntersectionObserver" in window) {
      const io = new IntersectionObserver((es) => {
        for (const e of es) if (e.isIntersecting) for (const a of links) a.setAttribute("aria-current", String(a.hash === `#${e.target.id}`));
      }, { rootMargin: "-45% 0px -50% 0px" });
      secs.forEach((x) => io.observe(x));
      cleanups.push(() => io.disconnect());
    }
    if (reduced || !("IntersectionObserver" in window)) return () => cleanups.forEach((f) => f());

    // reveals, one after the other within a row
    const els = [...root.querySelectorAll<HTMLElement>(REVEAL)];
    const io = new IntersectionObserver((es) => {
      for (const e of es) if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); }
    }, { rootMargin: "0px 0px -8% 0px", threshold: 0.08 });
    for (const el of els) {
      const sib = el.parentElement ? [...el.parentElement.children].filter((c) => c.matches(REVEAL)) : [el];
      el.style.setProperty("--d", `${Math.min(sib.indexOf(el), 7) * 70}ms`);
      el.classList.add("fg-rv");
      if (el.getBoundingClientRect().top < window.innerHeight) el.classList.add("in"); else io.observe(el);
    }
    root.classList.add("fx");
    cleanups.push(() => io.disconnect());

    // facts count up (only a single whole number, e.g. "24 h" or "€50"; anything else stays as written)
    const facts = [...root.querySelectorAll<HTMLElement>(".fg-facts dt, .fa-stats dt")];
    const cio = new IntersectionObserver((es) => {
      for (const e of es) {
        if (!e.isIntersecting) continue;
        cio.unobserve(e.target);
        const el = e.target as HTMLElement, text = el.textContent ?? "", m = /^(\D*)(\d{1,4})(\D*)$/.exec(text);
        if (!m) continue;
        const end = Number(m[2]), t0 = performance.now();
        el.setAttribute("aria-label", text);
        const step = (now: number) => {
          const k = Math.min(1, (now - t0) / 1100), n = Math.round(end * (1 - Math.pow(1 - k, 3)));
          el.textContent = `${m[1]}${n}${m[3]}`;
          if (k < 1) requestAnimationFrame(step); else el.textContent = text;
        };
        requestAnimationFrame(step);
      }
    }, { threshold: 0.6 });
    facts.forEach((f) => cio.observe(f));
    cleanups.push(() => cio.disconnect());
    return () => cleanups.forEach((f) => f());
  }, []);
  return <div className="fg-progress" aria-hidden="true" />;
}

/** Footer pages (FIRINGI only): a job application on /careers — an opening or an open application; a link to a CV, no files. */
export function ApplyForm({ jobs, l }: {
  jobs: { id: string; title: string }[];
  l: { position: string; openApplication: string; name: string; email: string; phone: string; link: string; linkHint: string; msg: string; consent: string; send: string; sending: string; sent: string; errRequired: string; errEmail: string; errConsent: string; errSpam: string; errBusy: string; errLink: string; errOff: string };
}) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const started = useRef(0);
  useEffect(() => { started.current = Date.now(); }, []);
  return (
    <form className="fg-form" noValidate data-testid="apply-form" onSubmit={(e) => {
      e.preventDefault();
      const f = new FormData(e.currentTarget), s = (k: string) => String(f.get(k) ?? ""), form = e.currentTarget;
      start(async () => {
        const r = await submitApplicationAction({ jobId: s("jobId"), name: s("name"), email: s("email"), phone: s("phone"), link: s("link"), message: s("message"), consent: f.get("consent") === "on", website: s("website"), startedAt: started.current });
        if (r.ok) { setMsg({ ok: true, text: l.sent }); form.reset(); started.current = Date.now(); }
        else setMsg({ ok: false, text: r.problem === "LINK" ? l.errLink : r.problem === "OFF" ? l.errOff : errText(r.problem, l) });
      });
    }}>
      <div className="fg-fields">
        <label className="fg-field wide">{l.position}<select name="jobId" defaultValue={jobs[0]?.id ?? ""} data-testid="apply-job">
          {jobs.map((j) => <option key={j.id} value={j.id}>{j.title}</option>)}<option value="">{l.openApplication}</option>
        </select></label>
        <label className="fg-field">{l.name}<input name="name" autoComplete="name" required maxLength={120} /></label>
        <label className="fg-field">{l.email}<input name="email" type="email" autoComplete="email" required maxLength={254} /></label>
        <label className="fg-field">{l.phone}<input name="phone" type="tel" autoComplete="tel" maxLength={40} /></label>
        <label className="fg-field">{l.link}<input name="link" type="url" inputMode="url" placeholder="https://" maxLength={500} /><span style={{ fontSize: 12.5, opacity: 0.75 }}>{l.linkHint}</span></label>
        <label className="fg-field wide">{l.msg}<textarea name="message" maxLength={4000} /></label>
      </div>
      <label className="fg-hp" aria-hidden="true">Website<input name="website" tabIndex={-1} autoComplete="off" /></label>
      <label className="fg-consent"><input type="checkbox" name="consent" /><span>{l.consent}</span></label>
      <button className="fg-btn red" type="submit" disabled={pending} data-testid="apply-send">{pending ? l.sending : l.send}</button>
      {msg && <p className={"fg-msg" + (msg.ok ? "" : " err")} role={msg.ok ? "status" : "alert"} data-testid="apply-msg">{msg.text}</p>}
    </form>
  );
}
