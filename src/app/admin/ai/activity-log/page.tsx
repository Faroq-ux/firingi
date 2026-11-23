import { redirect } from "next/navigation";

/** Phase 67: the AI Activity Log is the Audit trail of AI Governance. */
export default async function Page({ searchParams }: { searchParams: Promise<{ kind?: string; page?: string }> }) {
  const sp = await searchParams;
  redirect(`/admin/ai/governance?tab=AUDIT${sp.kind ? `&kind=${encodeURIComponent(sp.kind)}` : ""}${sp.page ? `&page=${encodeURIComponent(sp.page)}` : ""}`);
}
