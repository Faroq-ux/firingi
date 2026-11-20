import { MyShifts } from "@/components/staff/pages";

export const metadata = { title: "My Shifts & Hours" };
export const dynamic = "force-dynamic";

export default function Page() {
  return <MyShifts portal="buy" />;
}
