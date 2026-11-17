import { PortalShell } from "@/components/layout/portal-shell";
import { appMetadata } from "@/server/app/metadata";

/** Phase 39: installable as an app (manifest + iPhone settings). */
export const generateMetadata = () => appMetadata("driver");

export default function DriverLayout({ children }: { children: React.ReactNode }) {
  return <PortalShell portal="driver">{children}</PortalShell>;
}
