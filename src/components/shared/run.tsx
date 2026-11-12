"use client";
/** Run a server action with pending state, error / done message and a refresh. */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";

type Res = { ok: boolean; error?: string; data?: unknown };
export function useRun() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const run = (fn: () => Promise<Res>, after?: (data: unknown) => void, okText?: string) =>
    start(async () => {
      setError(null); setDone(null);
      const r = await fn();
      if (r.ok) { after?.(r.data); if (okText) setDone(okText); router.refresh(); } else setError(r.error ?? "Error");
    });
  return { pending, error, done, run, router };
}
export function Msg({ error, done }: { error: string | null; done?: string | null }) {
  if (error) return <p className="text-sm text-destructive" role="alert">{error}</p>;
  if (done) return <p className="text-sm text-[color:var(--success,#16a34a)]" role="status">{done}</p>;
  return null;
}
export const Spin = ({ on, icon: I }: { on: boolean; icon: React.ElementType }) => (on ? <Loader2 className="size-4 animate-spin" /> : <I className="size-4" />);
export type Opt = { id: string; label: string };
