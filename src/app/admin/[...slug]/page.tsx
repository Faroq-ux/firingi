import { ComingSoon } from "@/components/layout/coming-soon";

/** Every admin sidebar page that is not built yet lands here (permission-checked). */
export default async function AdminPlaceholder({ params }: { params: Promise<{ slug: string[] }> }) {
  return <ComingSoon portal="admin" slug={(await params).slug} />;
}
