import { PlanGate } from "@/components/plans/plan-gate";

/** Phase 36: only on plans that include PLANNING. */
export default function Layout({ children }: { children: React.ReactNode }) {
  return <PlanGate feature="PLANNING">{children}</PlanGate>;
}
