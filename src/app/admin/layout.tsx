import { PortalShell } from "@/components/layout/portal-shell";
import { appMetadata } from "@/server/app/metadata";

/** Phase 39: installable as an app (manifest + iPhone settings). */
export const generateMetadata = () => appMetadata("admin");

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <PortalShell portal="admin">{children}</PortalShell>;
}
