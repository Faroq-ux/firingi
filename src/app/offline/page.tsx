/**
 * Phase 39: offline mode. The service worker keeps this page and opens it when there is no signal;
 * it works from what the phone saved (no server data here — the page itself holds nothing personal).
 */
import type { Metadata } from "next";
import { OfflineApp } from "@/components/app/offline-app";

export const metadata: Metadata = { title: "Offline", robots: { index: false, follow: false } };

export default function OfflinePage() {
  return <OfflineApp />;
}
