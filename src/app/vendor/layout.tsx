import { PortalShell } from "@/components/layout/portal-shell";
import { appMetadata } from "@/server/app/metadata";

/** Phase 39: installable as an app (manifest + iPhone settings). */
export const generateMetadata = () => appMetadata("vendor");

export default function VendorLayout({ children }: { children: React.ReactNode }) {
  return <PortalShell portal="vendor">{children}</PortalShell>;
}
