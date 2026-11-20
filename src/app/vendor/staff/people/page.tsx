import { PeopleView } from "@/components/staff/pages";

export const metadata = { title: "Staff" };
export const dynamic = "force-dynamic";

export default function Page() {
  return <PeopleView portal="vendor" />;
}
