import { PlanGate } from "@/components/plans/plan-gate";

/** Phase 36: only on plans that include INVENTORY. */
export default function Layout({ children }: { children: React.ReactNode }) {
  return <PlanGate feature="INVENTORY">{children}</PlanGate>;
}
