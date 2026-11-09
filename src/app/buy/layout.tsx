import { PortalShell } from "@/components/layout/portal-shell";

export default function BuyLayout({ children }: { children: React.ReactNode }) {
  return <PortalShell portal="buy">{children}</PortalShell>;
}
