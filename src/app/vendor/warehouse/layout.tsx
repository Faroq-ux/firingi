import { PlanGate } from "@/components/plans/plan-gate";

/** Phase 36: only on plans that include WAREHOUSE. */
export default function Layout({ children }: { children: React.ReactNode }) {
  return <PlanGate feature="WAREHOUSE">{children}</PlanGate>;
}
