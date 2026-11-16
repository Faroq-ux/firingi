import { PlanGate } from "@/components/plans/plan-gate";

/** Phase 36: only on plans that include PRICE_INSIGHTS. */
export default function Layout({ children }: { children: React.ReactNode }) {
  return <PlanGate feature="PRICE_INSIGHTS">{children}</PlanGate>;
}
