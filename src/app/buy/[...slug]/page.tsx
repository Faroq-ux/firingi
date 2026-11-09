import { ComingSoon } from "@/components/layout/coming-soon";

export default async function Placeholder({ params }: { params: Promise<{ slug: string[] }> }) {
  return <ComingSoon portal="buy" slug={(await params).slug} />;
}
