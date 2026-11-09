"use client";
/**
 * Slim animated progress bar at the top of the screen during navigation. Starts when
 * an internal link is clicked or a form is submitted, completes when the new URL is shown.
 */
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";

export function NavProgress() {
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const [width, setWidth] = useState(0);
  const [visible, setVisible] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const done = () => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
    setWidth(100);
    setTimeout(() => { setVisible(false); setWidth(0); }, 250);
  };

  useEffect(() => {
    const start = () => {
      if (timer.current) return;
      setVisible(true);
      setWidth(12);
      // Ease towards 90 % until the page arrives.
      timer.current = setInterval(() => setWidth((w) => (w < 90 ? w + (90 - w) * 0.12 : w)), 120);
    };
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as HTMLElement).closest("a");
      if (!a || a.target === "_blank" || a.hasAttribute("download")) return;
      const url = new URL(a.href, location.href);
      if (url.origin !== location.origin || url.pathname.startsWith("/api/")) return;
      if (url.pathname === location.pathname && url.search === location.search) return;
      start();
    };
    const onSubmit = (e: SubmitEvent) => { if ((e.target as HTMLFormElement).method?.toLowerCase() === "get") start(); };
    document.addEventListener("click", onClick, true);
    document.addEventListener("submit", onSubmit, true);
    return () => { document.removeEventListener("click", onClick, true); document.removeEventListener("submit", onSubmit, true); };
  }, []);

  useEffect(() => { if (timer.current) done(); }, [pathname, search]);

  if (!visible) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 top-0 z-[60] h-0.5" aria-hidden>
      <div className="h-full bg-primary shadow-[0_0_8px_var(--primary)] transition-[width] duration-200 ease-out" style={{ width: `${width}%` }} />
    </div>
  );
}
