/** Phase 56: plain pages in the landing page's look (legal pages, newsletter confirmation). */
import "./landing.css";
import Link from "next/link";
import { LangSelect } from "./client";
import { languageList } from "./view";
import { Wordmark } from "@/components/brand/wordmark";

export function PlainPage({ locale, langLabel, back, children, footer }: { locale: string; langLabel: string; back: string; children: React.ReactNode; footer?: React.ReactNode }) {
  return (
    <div className="fg" lang={locale}>
      <header className="fg-topbar">
        <div className="fg-wrap">
          <Link className="fg-mark" href="/" aria-label="FIRINGI"><Wordmark /></Link>
          <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
            <LangSelect locale={locale} locales={languageList(locale)} label={langLabel} />
          </div>
        </div>
      </header>
      <main className="fg-plain">
        {children}
        <p style={{ marginTop: 40 }}><Link className="fg-btn ink" href="/">{back}</Link></p>
      </main>
      {footer}
    </div>
  );
}
