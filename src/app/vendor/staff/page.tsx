import { StaffOverview } from "@/components/staff/pages";

export const metadata = { title: "Who's In" };
export const dynamic = "force-dynamic";

export default function Page() {
  return <StaffOverview portal="vendor" />;
}
