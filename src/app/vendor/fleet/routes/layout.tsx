import { PlanGate } from "@/components/plans/plan-gate";

/** Phase 36: only on plans that include ROUTES. */
export default function Layout({ children }: { children: React.ReactNode }) {
  return <PlanGate feature="ROUTES">{children}</PlanGate>;
}
