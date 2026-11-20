import { RotaView } from "@/components/staff/pages";

export const metadata = { title: "Rota" };
export const dynamic = "force-dynamic";

export default async function Page({ searchParams }: { searchParams: Promise<{ week?: string }> }) {
  return <RotaView portal="admin" week={(await searchParams).week} />;
}
