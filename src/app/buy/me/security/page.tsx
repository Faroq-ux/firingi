import { getTranslations } from "next-intl/server";
import { pagePortal } from "@/server/rbac/guard";
import { MySecurity } from "@/components/security/my-security";

export async function generateMetadata() {
  return { title: (await getTranslations("security"))("title") };
}

export default async function Page({ searchParams }: { searchParams: Promise<{ required?: string }> }) {
  const ctx = await pagePortal("buy", { securitySetup: true });
  return <MySecurity ctx={ctx} required={(await searchParams).required === "1"} />;
}
