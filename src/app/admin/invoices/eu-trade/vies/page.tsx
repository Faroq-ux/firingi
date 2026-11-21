import Link from "next/link";
import { ShieldCheck } from "lucide-react";
import { can, pagePermission, pagePortal } from "@/server/rbac/guard";
import { viesHistory, viesPartners } from "@/server/trade/service";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { RecheckButton } from "@/components/trade/admin";

export const metadata = { title: "VAT Number Checks (VIES)" };
export const dynamic = "force-dynamic";

const Result = ({ r }: { r: string | null }) => (r === "VALID" ? <Badge variant="success">Valid</Badge> : r === "INVALID" ? <Badge variant="destructive">Not valid</Badge> : r === "ERROR" ? <Badge variant="warning">VIES didn&apos;t answer</Badge> : <Badge variant="secondary">Never checked</Badge>);

export default async function EuTradeViesPage({ searchParams }: { searchParams: Promise<{ company?: string }> }) {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.finance.view", "admin.finance.manage", "admin.tax.manage", "admin.invoices.view"]);
  const { company } = await searchParams;
  const [rows, hist] = await Promise.all([viesPartners(ctx), company ? viesHistory(ctx, company) : Promise.resolve(null)]);
  const manage = can(ctx, ["admin.tax.manage", "admin.finance.manage"]);
  return (
    <>
      <PageHeader title="VAT Number Checks (VIES)" icon={ShieldCheck} description="Business partners in other EU countries and their latest VIES answer. Before FIRINGI invoices without VAT, the buyer's number is checked again and the answer kept with the invoice as proof." />
      {hist && (
        <Card className="mb-6">
          <CardHeader><CardTitle>History — {rows.find((r) => r.id === company)?.name ?? ""}</CardTitle><CardDescription><Link className="underline" href="?">Back to all partners</Link></CardDescription></CardHeader>
          <CardContent>
            <ul className="divide-y text-sm" data-testid="vies-history">
              {hist.map((h) => <li key={h.id} className="flex flex-wrap items-center gap-2 py-1.5"><span className="tabular-nums">{h.at.slice(0, 16).replace("T", " ")}</span><Result r={h.result} /><span className="font-mono text-xs">{h.vat}</span><span className="text-xs text-muted-foreground">{h.purpose ?? "ONBOARDING"}{h.invoice ? ` · invoice ${h.invoice}` : ""}</span><span className="min-w-0 flex-1 basis-40 break-words text-xs">{h.ref ? `Proof: ${h.ref}` : ""}{h.name ? ` · ${h.name}` : ""}</span></li>)}
            </ul>
          </CardContent>
        </Card>
      )}
      <Card>
        <CardContent className="pt-5">
          {!rows.length ? <p className="text-sm text-muted-foreground">No partners in other EU countries yet.</p> : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-sm" data-testid="vies-partners">
                <thead><tr className="text-left text-xs text-muted-foreground"><th className="py-1">Business</th><th>Country</th><th>VAT number</th><th>Latest check</th><th>Proof</th><th /></tr></thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id} className="border-t" data-testid={`vies-row-${r.id}`}>
                      <td className="py-1.5 pr-2"><Link className="underline-offset-2 hover:underline" href={`?company=${r.id}`}>{r.name}</Link><span className="block text-xs text-muted-foreground">{r.type.toLowerCase()}</span></td>
                      <td>{r.country}</td>
                      <td className="font-mono text-xs">{r.vat ?? "—"}</td>
                      <td><Result r={r.result} />{r.checkedAt && <span className="block text-xs text-muted-foreground">{r.checkedAt.slice(0, 10)}</span>}</td>
                      <td className="max-w-[220px] break-words text-xs">{r.ref ?? ""}</td>
                      <td>{manage && r.vat && <RecheckButton companyId={r.id} />}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </>
  );
}
