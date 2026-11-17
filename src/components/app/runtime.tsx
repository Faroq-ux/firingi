"use client";
/**
 * Phase 39 — the installable app inside every portal page:
 *  • registers the service worker, keeps the offline data fresh and sends the outbox when online;
 *  • "No signal" banner (→ offline mode) and the outbox chip (actions waiting / to check);
 *  • the install card (Android / desktop prompt, iPhone instructions), remembered when dismissed;
 *  • the unread number on the app icon; records installs and home-screen opens for FIRINGI.
 */
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { CloudOff, Download, RefreshCw, Share, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { AppPortal } from "@/lib/app";

type InstallEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> };
const DISMISS_KEY = "firingi.install.dismissed";
const platform = () => {
  const ua = navigator.userAgent;
  return /iphone|ipad|ipod/i.test(ua) ? "ios" : /android/i.test(ua) ? "android" : "desktop";
};
const standalone = () => window.matchMedia?.("(display-mode: standalone)").matches || (navigator as unknown as { standalone?: boolean }).standalone === true;

export function AppRuntime({ portal, userId, installPrompt, unread }: { portal: AppPortal; userId: string; installPrompt: boolean; unread: number }) {
  const t = useTranslations("app");
  const [online, setOnline] = useState(true);
  const [counts, setCounts] = useState({ waiting: 0, attention: 0 });
  const [install, setInstall] = useState<InstallEvent | null>(null);
  const [ios, setIos] = useState(false);
  const [needsLogin, setNeedsLogin] = useState(false);

  const recount = useCallback(async () => {
    const { outbox, kvGet } = await import("@/lib/offline/store");
    const all = (await outbox().catch(() => [])).filter((e) => e.userId === userId);
    setCounts({ waiting: all.filter((e) => e.state === "WAITING" || e.state === "SENDING").length, attention: all.filter((e) => e.state === "NEEDS_CONFIRM" || e.state === "FAILED").length });
    setNeedsLogin(!!(await kvGet<boolean>("needsLogin").catch(() => false)));
  }, [userId]);

  // service worker, offline data, outbox
  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setInterval> | undefined;
    (async () => {
      const store = await import("@/lib/offline/store");
      // someone else signed in on this phone: forget the previous person's data
      const meta = await store.kvGet<{ userId: string }>("meta").catch(() => undefined);
      if (meta && meta.userId !== userId) await store.wipe();
      if ("serviceWorker" in navigator) {
        const reg = await navigator.serviceWorker.register("/sw.js").catch(() => null);
        navigator.serviceWorker.addEventListener("message", (e) => { if (e.data?.type === "flush") void store.flush(userId).then(recount); });
        // keep the saved offline app current (new release, language change)
        const shellFor = `${document.documentElement.lang}|${document.querySelector('script[src*="/_next/static/chunks/main"]')?.getAttribute("src") ?? ""}`;
        if (localStorage.getItem("firingi.shell") !== shellFor) {
          const sw = reg?.active ?? (await navigator.serviceWorker.ready.catch(() => null))?.active;
          sw?.postMessage({ type: "refresh-shell" });
          try { localStorage.setItem("firingi.shell", shellFor); } catch { /* private mode */ }
        }
      }
      const refresh = async () => {
        if (!navigator.onLine) return;
        const m = await store.kvGet<{ portal: string; at: string }>("meta").catch(() => undefined);
        const snap = await store.kvGet<{ at: string; settings: { refreshMinutes: number } }>(`snap:${portal}`).catch(() => undefined);
        const every = (snap?.settings.refreshMinutes ?? 15) * 60_000;
        if (!snap || !m || m.portal !== portal || Date.now() - Date.parse(snap.at) > every) await store.refreshSnapshot(portal, userId).catch(() => false);
        else await store.kvSet("lastPortal", portal);
        await store.flush(userId).catch(() => null);
        if (alive) await recount();
      };
      await refresh();
      timer = setInterval(refresh, 5 * 60_000);
      const on = () => { setOnline(true); void refresh(); };
      const off = () => setOnline(false);
      window.addEventListener("online", on);
      window.addEventListener("offline", off);
      window.addEventListener(store.OUTBOX_EVENT, recount);
      document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") void refresh(); });
      setOnline(navigator.onLine);
    })();
    return () => { alive = false; if (timer) clearInterval(timer); };
  }, [portal, userId, recount]);

  // install prompt + installs / opens
  useEffect(() => {
    const before = (e: Event) => { e.preventDefault(); setInstall(e as InstallEvent); };
    const installed = () => { setInstall(null); void fetch("/api/app/event", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ portal, kind: "INSTALLED", platform: platform() }) }); };
    window.addEventListener("beforeinstallprompt", before);
    window.addEventListener("appinstalled", installed);
    if (standalone() && !sessionStorage.getItem("firingi.opened")) {
      sessionStorage.setItem("firingi.opened", "1");
      void fetch("/api/app/event", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ portal, kind: "OPENED", platform: platform() }) });
    }
    let dismissed = false;
    try { dismissed = Number(localStorage.getItem(DISMISS_KEY) ?? 0) > Date.now() - 30 * 86_400_000; } catch { /* private mode */ }
    if (!standalone() && !dismissed && platform() === "ios" && /safari/i.test(navigator.userAgent) && !/crios|fxios/i.test(navigator.userAgent)) setIos(true);
    return () => { window.removeEventListener("beforeinstallprompt", before); window.removeEventListener("appinstalled", installed); };
  }, [portal]);

  // number on the app icon
  useEffect(() => {
    const nav = navigator as Navigator & { setAppBadge?: (n?: number) => Promise<void>; clearAppBadge?: () => Promise<void> };
    if (!nav.setAppBadge) return;
    void (unread > 0 ? nav.setAppBadge(unread) : nav.clearAppBadge?.())?.catch(() => null);
  }, [unread]);

  const dismiss = () => { setInstall(null); setIos(false); try { localStorage.setItem(DISMISS_KEY, String(Date.now())); } catch { /* private mode */ } };
  let dismissedRecently = false;
  try { dismissedRecently = typeof window !== "undefined" && Number(localStorage.getItem(DISMISS_KEY) ?? 0) > Date.now() - 30 * 86_400_000; } catch { /* private mode */ }
  const showInstall = installPrompt && !dismissedRecently && (install || ios);

  return (
    <>
      {!online && (
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-warning/60 bg-warning/10 px-3 py-2 text-sm" role="status" data-testid="offline-banner">
          <CloudOff className="size-4" /> <span className="flex-1">{t("offlineBanner")}</span>
          <Link href="/offline" className="font-medium text-primary hover:underline" data-testid="open-offline">{t("openOffline")}</Link>
        </div>
      )}
      {(counts.waiting > 0 || counts.attention > 0 || needsLogin) && (
        <Link href="/offline?tab=outbox" className="mb-4 flex items-center gap-2 rounded-lg border bg-card px-3 py-2 text-sm hover:bg-accent" data-testid="outbox-chip">
          <RefreshCw className={`size-4 ${counts.waiting && online ? "animate-spin" : ""}`} />
          <span className="flex-1">
            {needsLogin ? t("needsLogin") : counts.attention ? t("outboxAttention", { n: counts.attention }) : t("outboxWaiting", { n: counts.waiting })}
          </span>
          <span className="text-primary">{t("outboxOpen")}</span>
        </Link>
      )}
      {showInstall && (
        <div className="glass-panel fixed inset-x-3 bottom-20 z-40 mx-auto max-w-md rounded-2xl border p-4 shadow-2xl lg:bottom-6 lg:right-6 lg:left-auto" role="dialog" aria-label={t("installTitle")} data-testid="install-card">
          <div className="flex items-start gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/icons/icon-192.png" alt="" className="size-12 rounded-xl" />
            <div className="min-w-0 flex-1">
              <p className="font-semibold">{t("installTitle")}</p>
              <p className="text-sm text-muted-foreground">{ios && !install ? t("installIos") : t("installHint")}</p>
              {ios && !install && <p className="mt-1 flex items-center gap-1 text-sm"><Share className="size-4" /> {t("installIosSteps")}</p>}
            </div>
            <button type="button" onClick={dismiss} className="rounded-md p-1 hover:bg-accent" aria-label={t("notNow")} data-testid="install-dismiss"><X className="size-4" /></button>
          </div>
          {install && (
            <div className="mt-3 flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={dismiss}>{t("notNow")}</Button>
              <Button size="sm" data-testid="install-app" onClick={async () => { await install.prompt(); const c = await install.userChoice.catch(() => null); if (c?.outcome !== "accepted") dismiss(); setInstall(null); }}><Download className="size-4" /> {t("install")}</Button>
            </div>
          )}
        </div>
      )}
    </>
  );
}

/** Sign-out: forget everything this phone kept for the person (offline data, outbox, saved PDFs). */
export async function forgetPhoneData(userId: string) {
  try {
    const { flush, wipe } = await import("@/lib/offline/store");
    await Promise.race([flush(userId), new Promise((r) => setTimeout(r, 4000))]); // send what waits, if there is signal
    await wipe();
    const reg = await navigator.serviceWorker?.getRegistration("/sw.js");
    reg?.active?.postMessage({ type: "wipe" });
    localStorage.removeItem("firingi.shell");
  } catch { /* nothing kept */ }
}
