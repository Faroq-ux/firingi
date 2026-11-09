import { getTranslations } from "next-intl/server";
import type { AccountStatus } from "@prisma/client";
import { Badge } from "@/components/ui/badge";

const VARIANT: Record<AccountStatus, "success" | "warning" | "destructive" | "secondary" | "default"> = {
  APPROVED: "success",
  PENDING: "warning",
  UNDER_REVIEW: "default",
  REJECTED: "destructive",
  SUSPENDED: "destructive",
};

export async function AccountStatusBadge({ status }: { status: AccountStatus }) {
  const t = await getTranslations("accountStatus");
  return <Badge variant={VARIANT[status]}>{t(status)}</Badge>;
}
