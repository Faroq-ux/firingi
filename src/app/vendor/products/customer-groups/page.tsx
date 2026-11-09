import { getTranslations } from "next-intl/server";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { eligibleBuyers, listOwnGroups } from "@/server/services/pricing";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { GroupMembers, NewGroupForm } from "@/components/vendor/pricing-controls";

export const metadata = { title: "Customer groups" };

export default async function GroupsPage() {
  const ctx = await pagePortal("vendor");
  pagePermission(ctx, "vendor.pricing.manage");
  const [groups, buyers, t] = await Promise.all([listOwnGroups(ctx), eligibleBuyers(ctx), getTranslations("catalogue.vendor")]);
  const candidates = buyers.map((b) => ({ id: b.id, label: `${b.country.flag ?? ""} ${b.tradeName ?? b.legalName}` }));
  return (
    <>
      <PageHeader title={t("groups")} />
      <Card className="mb-4"><CardContent className="pt-5"><NewGroupForm /></CardContent></Card>
      <div className="grid gap-4 lg:grid-cols-2">
        {groups.map((g) => (
          <Card key={g.id}>
            <CardHeader><CardTitle>{g.name}</CardTitle>{g.description && <CardDescription>{g.description}</CardDescription>}</CardHeader>
            <CardContent>
              <GroupMembers groupId={g.id} members={g.members.map((m) => ({ id: m.company.id, label: m.company.legalName }))} candidates={candidates} />
            </CardContent>
          </Card>
        ))}
      </div>
    </>
  );
}
