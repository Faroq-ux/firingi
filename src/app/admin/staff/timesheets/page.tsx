import { TimesheetsView } from "@/components/staff/pages";

export const metadata = { title: "Timesheets" };
export const dynamic = "force-dynamic";

export default async function Page({ searchParams }: { searchParams: Promise<{ week?: string }> }) {
  return <TimesheetsView portal="admin" week={(await searchParams).week} />;
}
