import { LeaveView } from "@/components/staff/pages";

export const metadata = { title: "Leave & Swaps" };
export const dynamic = "force-dynamic";

export default function Page() {
  return <LeaveView portal="buy" />;
}
