"use client";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { runHealthChecksAction } from "@/server/actions/ops";

export function RunHealthChecks() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <span className="inline-flex items-center gap-2">
      {msg && <span className="text-sm text-muted-foreground" role="status">{msg}</span>}
      <Button variant="outline" disabled={pending} data-testid="run-checks" onClick={() => start(async () => {
        const r = await runHealthChecksAction({});
        setMsg(r.ok ? `${r.data.problems} problem(s) · ${r.data.opened} new alert(s) · ${r.data.resolved} resolved` : r.error);
        router.refresh();
      })}><RefreshCw className={`size-4 ${pending ? "animate-spin" : ""}`} aria-hidden /> Run checks now</Button>
    </span>
  );
}
