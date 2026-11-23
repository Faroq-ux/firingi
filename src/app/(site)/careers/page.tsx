import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getLocale } from "next-intl/server";
import { landingSettings, landingTexts } from "@/server/landing/service";
import { aboutPage } from "@/server/landing/careers";
import { lookup } from "@/lib/landing";
import { PlainPage } from "@/components/landing/plain";
import { LandingFooter } from "@/components/landing/view";
import { ApplyForm } from "@/components/landing/client";

export const dynamic = "force-dynamic";
export async function generateMetadata(): Promise<Metadata> {
  return { title: lookup(await landingTexts(await getLocale()), "about.careers.title") };
}

/** Footer page (FIRINGI only): working at FIRINGI — FIRINGI's text, its open positions and the application form. */
export default async function Page() {
  const locale = await getLocale();
  const p = await aboutPage("careers", locale);
  if (!p.on) notFound();
  const s = await landingSettings();
  const src = await landingTexts(locale, s);
  const t = (k: string, v?: Record<string, string | number>) => lookup(src, k).replace(/\{(\w+)\}/g, (_, x: string) => String(v?.[x] ?? `{${x}}`));
  return (
    <PlainPage locale={locale} langLabel={t("langPicker")} back={t("legal.back")} footer={<LandingFooter s={s} t={t} locale={locale} home={false} />}>
      <h1 className="fg-disp" data-testid="about-title">{t("about.careers.title")}</h1>
      <p className="meta">{t("about.careers.lead")}</p>
      <div className="body" data-testid="about-body">{p.text}</div>
      <h2 style={{ marginTop: 40, fontSize: 26, fontWeight: 900 }}>{t("about.careers.openings")}</h2>
      {!p.jobs.length ? <p className="meta" data-testid="jobs-none">{t("about.careers.none")}</p> : (
        <ul style={{ listStyle: "none", padding: 0, margin: "16px 0 0" }} data-testid="jobs">
          {p.jobs.map((j) => (
            <li key={j.id} id={j.id} data-testid="job" style={{ padding: "18px 0", borderTop: "1px solid rgba(0,0,0,.12)" }}>
              <h3 style={{ margin: 0, fontSize: 20, fontWeight: 800 }}>{j.title}</h3>
              <p className="meta" style={{ marginTop: 4 }}>{[j.location, t(`about.careers.type.${j.type}`)].filter(Boolean).join(" · ")}</p>
              {j.text && <div style={{ marginTop: 10, whiteSpace: "pre-line" }}>{j.text}</div>}
            </li>
          ))}
        </ul>
      )}
      <h2 style={{ marginTop: 40, fontSize: 26, fontWeight: 900 }} id="apply">{t("about.careers.applyTitle")}</h2>
      <p className="meta">{t("about.careers.applyLead")}</p>
      <div style={{ marginTop: 18 }}>
        <ApplyForm jobs={p.jobs.map((j) => ({ id: j.id, title: j.title }))} l={{
          position: t("about.careers.position"), openApplication: t("about.careers.openApplication"), name: t("contact.name"), email: t("contact.email"), phone: t("contact.phone"),
          link: t("about.careers.link"), linkHint: t("about.careers.linkHint"), msg: t("about.careers.msg"), consent: t("about.careers.consent"), send: t("about.careers.send"), sending: t("contact.sending"),
          sent: t("about.careers.sent"), errRequired: t("contact.errRequired"), errEmail: t("contact.errEmail"), errConsent: t("contact.errConsent"), errSpam: t("contact.errSpam"), errBusy: t("contact.errBusy"),
          errLink: t("about.careers.errLink"), errOff: t("about.careers.errOff"),
        }} />
      </div>
    </PlainPage>
  );
}
