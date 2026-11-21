import Link from "next/link";
import { Globe } from "lucide-react";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { landingEditor } from "@/server/landing/service";
import { defaultLegal } from "@/lib/landing-legal";
import { LEGAL_PAGES, type LegalPage } from "@/lib/landing";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { LandingSettingsForm, LandingTextsForm, LegalPagesForm } from "@/components/landing/admin";
import { languageList } from "@/components/landing/view";

export const metadata = { title: "Landing Page" };
export const dynamic = "force-dynamic";

/** Phase 56: FIRINGI edits the public landing page — sections on/off, contact details, numbers, every text in every language, legal pages. */
export default async function Page({ searchParams }: { searchParams: Promise<{ lang?: string }> }) {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, "admin.marketing.manage");
  const { lang } = await searchParams;
  const ed = await landingEditor(ctx, lang ?? "en");
  const locales = languageList("en").sort((a, b) => (a.code === "en" ? -1 : b.code === "en" ? 1 : a.name.localeCompare(b.name)));
  const co = { ...ed.settings.company, email: ed.settings.email };
  const starting = Object.fromEntries(LEGAL_PAGES.map((p) => [p, { en: defaultLegal(p, "en", co), pt: defaultLegal(p, "pt-PT", co) }])) as unknown as Record<LegalPage, Record<string, string>>;
  return (
    <>
      <PageHeader title="Landing Page" icon={Globe} description="The public page at the main address: switch sections on or off and change every text, in every language."
        actions={<span className="flex flex-wrap gap-3 text-sm"><a href="/welcome" target="_blank" rel="noopener" className="text-primary hover:underline">Open the page →</a><Link href="/admin/marketing/newsletter" className="text-primary hover:underline">Newsletter →</Link></span>} />
      <Card className="mb-6">
        <CardHeader><CardTitle>Page, sections and contact details</CardTitle><CardDescription>New contact and vendor messages arrive as leads in CRM (source: Website).</CardDescription></CardHeader>
        <CardContent><LandingSettingsForm initial={ed.settings} /></CardContent>
      </Card>
      <Card className="mb-6" id="texts">
        <CardHeader><CardTitle>Texts</CardTitle><CardDescription>Every word on the page, per language. Visitors see the language of their browser (or the one they pick); their country is found automatically.</CardDescription></CardHeader>
        <CardContent><LandingTextsForm key={ed.locale} settings={ed.settings} locale={ed.locale} locales={locales} rows={ed.rows} /></CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Legal pages</CardTitle><CardDescription>Terms of use, privacy policy (EU GDPR) and cookies, linked from the footer.</CardDescription></CardHeader>
        <CardContent><LegalPagesForm settings={ed.settings} locales={locales} starting={starting} /></CardContent>
      </Card>
    </>
  );
}
