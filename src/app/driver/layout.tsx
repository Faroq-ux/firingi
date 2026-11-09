import { PortalShell } from "@/components/layout/portal-shell";

export default function DriverLayout({ children }: { children: React.ReactNode }) {
  return <PortalShell portal="driver">{children}</PortalShell>;
}
