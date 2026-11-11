/** Order journey as a glowing stepper: placed → confirmed → ready / shipped → out for delivery → delivered. */
import { getLocale, getTranslations } from "next-intl/server";
import { CheckCircle2, ClipboardCheck, PackageCheck, PackageOpen, Truck } from "lucide-react";
import type { OrderStatus } from "@prisma/client";
import { cn } from "@/lib/utils";

const STEPS: { key: OrderStatus; icon: typeof Truck; reached: OrderStatus[] }[] = [
  { key: "PENDING_CONFIRMATION", icon: ClipboardCheck, reached: ["NEW", "ON_HOLD", "PENDING_CONFIRMATION", "SUPPLIER_PROCESSING", "READY_FOR_PICKUP", "DISPATCHED", "OUT_FOR_DELIVERY", "DELIVERED"] },
  { key: "SUPPLIER_PROCESSING", icon: PackageOpen, reached: ["SUPPLIER_PROCESSING", "READY_FOR_PICKUP", "DISPATCHED", "OUT_FOR_DELIVERY", "DELIVERED"] },
  { key: "DISPATCHED", icon: PackageCheck, reached: ["READY_FOR_PICKUP", "DISPATCHED", "OUT_FOR_DELIVERY", "DELIVERED"] },
  { key: "OUT_FOR_DELIVERY", icon: Truck, reached: ["OUT_FOR_DELIVERY", "DELIVERED"] },
  { key: "DELIVERED", icon: CheckCircle2, reached: ["DELIVERED"] },
];

export async function OrderProgress({ status, history }: { status: OrderStatus; history: { toStatus: OrderStatus; at: Date }[] }) {
  if (["CANCELLED", "RETURNED", "EXCEPTION"].includes(status)) return null;
  const [t, locale] = await Promise.all([getTranslations("orders.statuses"), getLocale()]);
  const at = (s: OrderStatus) => history.filter((h) => h.toStatus === s || (s === "DISPATCHED" && h.toStatus === "READY_FOR_PICKUP")).at(-1)?.at;
  const currentIdx = STEPS.reduce((acc, s, i) => (s.reached.includes(status) ? i : acc), 0);
  return (
    <ol className="glass-panel mb-5 grid grid-cols-5 gap-1 rounded-2xl border p-4" aria-label="Progress" data-testid="order-progress">
      {STEPS.map((s, i) => {
        const done = s.reached.includes(status), current = i === currentIdx && status !== "DELIVERED";
        const Icon = s.icon, when = at(s.key);
        return (
          <li key={s.key} className="relative flex flex-col items-center text-center" aria-current={current ? "step" : undefined}>
            {i > 0 && <span aria-hidden className={cn("absolute right-1/2 top-5 h-0.5 w-full -translate-y-1/2", done ? "bg-[linear-gradient(90deg,var(--vivid-blue),var(--vivid-violet))]" : "bg-border")} />}
            <span className={cn("relative z-10 grid size-10 place-items-center rounded-full border-2 transition-all", done ? "border-transparent bg-[linear-gradient(135deg,var(--vivid-blue),var(--vivid-violet))] text-white shadow-[0_0_20px_-4px_var(--vivid-violet)]" : "border-border bg-card text-muted-foreground", current && "motion-float ring-4 ring-[color:color-mix(in_oklch,var(--vivid-violet)_25%,transparent)]")}>
              <Icon className="size-5" aria-hidden />
            </span>
            <span className={cn("mt-2 text-[11px] font-semibold leading-tight sm:text-xs", done ? "text-foreground" : "text-muted-foreground")}>{t(s.key)}</span>
            {when && <span className="hidden text-[10px] text-muted-foreground sm:block" suppressHydrationWarning>{when.toLocaleString(locale, { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</span>}
          </li>
        );
      })}
    </ol>
  );
}
