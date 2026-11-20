import { KioskView } from "@/components/staff/pages";

export const metadata = { title: "Clock-in Kiosk" };
export const dynamic = "force-dynamic";

export default function Page() {
  return <KioskView portal="admin" />;
}
