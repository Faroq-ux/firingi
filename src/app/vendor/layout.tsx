import { PortalShell } from "@/components/layout/portal-shell";

export default function VendorLayout({ children }: { children: React.ReactNode }) {
  return <PortalShell portal="vendor">{children}</PortalShell>;
}
