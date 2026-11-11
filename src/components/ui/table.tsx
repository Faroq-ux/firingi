import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * On phones (< 640 px) every row becomes a stacked card: the first cell is the card title and
 * each other cell shows its column name (labels are filled in by <TableLabeler />, see
 * globals.css › .ft-stack). Pass stack={false} for wide grids that should scroll instead.
 */
export function Table({ className, stack = true, ...props }: React.HTMLAttributes<HTMLTableElement> & { stack?: boolean }) {
  return (
    <div className="w-full overflow-x-auto rounded-xl border bg-card">
      <table className={cn("w-full caption-bottom text-sm", stack && "ft-stack", className)} {...props} />
    </div>
  );
}
export const THead = (p: React.HTMLAttributes<HTMLTableSectionElement>) => <thead className="bg-[linear-gradient(90deg,color-mix(in_oklch,var(--vivid-blue)_12%,var(--card)),color-mix(in_oklch,var(--vivid-violet)_10%,var(--card)),color-mix(in_oklch,var(--vivid-pink)_8%,var(--card)))] [&_tr]:border-b" {...p} />;
export const TBody = (p: React.HTMLAttributes<HTMLTableSectionElement>) => <tbody className="[&_tr:last-child]:border-0" {...p} />;
export const TR = ({ className, ...p }: React.HTMLAttributes<HTMLTableRowElement>) => (
  <tr className={cn("border-b transition-colors hover:bg-[color-mix(in_oklch,var(--vivid-blue)_6%,transparent)]", className)} {...p} />
);
export const TH = ({ className, ...p }: React.ThHTMLAttributes<HTMLTableCellElement>) => (
  <th className={cn("h-10 px-3 text-left align-middle text-xs font-semibold uppercase tracking-wide text-[color:color-mix(in_oklch,var(--vivid-violet)_70%,var(--foreground))]", className)} {...p} />
);
export const TD = ({ className, ...p }: React.TdHTMLAttributes<HTMLTableCellElement>) => (
  <td className={cn("px-3 py-2.5 align-middle", className)} {...p} />
);
export function EmptyRow({ colSpan, children }: { colSpan: number; children: React.ReactNode }) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-3 py-10 text-center text-sm text-muted-foreground">{children}</td>
    </tr>
  );
}
