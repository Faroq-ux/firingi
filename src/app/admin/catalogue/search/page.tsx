import { Search } from "lucide-react";
import { can, pagePermission, pagePortal } from "@/server/rbac/guard";
import { searchAiStatus, searchSettings, synonymList } from "@/server/search/service";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { SearchSettingsForm, SynonymList } from "@/components/search/admin";

export const metadata = { title: "Smart Search" };

/** Phase 72: how customers' product search matches — typos, AI, synonyms, filters (English). */
export default async function SearchAdminPage({ searchParams }: { searchParams: Promise<{ q?: string; source?: string }> }) {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.catalogue.view", "admin.catalogue.manage"]);
  const sp = await searchParams;
  const [settings, ai, rows] = await Promise.all([searchSettings(), searchAiStatus(), synonymList(ctx, { q: sp.q, source: sp.source })]);
  const manage = can(ctx, "admin.catalogue.manage");
  return (
    <>
      <PageHeader icon={Search} title="Smart Search" description="How customers find products: typo-tolerant matching, the AI reading what they type (other languages, synonyms, filters like “gluten-free under 8 €”), and filters on the search page." />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
        <Card>
          <CardHeader><CardTitle>Switches</CardTitle><CardDescription>AI: {ai.ready ? "reading searches" : ai.on ? (ai.configured ? "stopped by AI Governance" : "switched on, but no AI is connected") : "switched off"}.</CardDescription></CardHeader>
          <CardContent>{manage ? <SearchSettingsForm initial={settings} aiConfigured={ai.configured} /> : <p className="text-sm text-muted-foreground">You can view these settings; changing them needs the catalogue manage right.</p>}</CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Synonyms</CardTitle>
            <CardDescription>Words that mean the same for search, in any language. Yours are never changed by the AI; untick “Not used” to switch one off.</CardDescription>
            <form className="flex flex-wrap gap-2 pt-2 text-sm" data-testid="syn-filter">
              <input name="q" defaultValue={sp.q ?? ""} placeholder="Find a word" className="h-9 rounded-md border bg-background px-2" />
              <select name="source" defaultValue={sp.source ?? ""} className="h-9 rounded-md border bg-background px-2"><option value="">All</option><option value="ADMIN">FIRINGI’s</option><option value="AI">Learnt by AI</option></select>
              <button className="h-9 rounded-md border px-3">Show</button>
            </form>
          </CardHeader>
          <CardContent><SynonymList rows={rows} canManage={manage} /></CardContent>
        </Card>
      </div>
    </>
  );
}
