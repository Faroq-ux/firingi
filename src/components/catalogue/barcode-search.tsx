"use client";
/**
 * Search box for barcodes / names. Works with USB or Bluetooth barcode scanners (they
 * type the digits + Enter) and, where the browser supports it (Chrome on Android,
 * recent desktop Chrome), with the camera via the BarcodeDetector API.
 */
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { ScanBarcode, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Detector = { detect: (src: HTMLVideoElement) => Promise<{ rawValue: string }[]> };
declare global { interface Window { BarcodeDetector?: new (o: { formats: string[] }) => Detector } }

export function BarcodeSearch({ action, defaultValue, hidden }: { action: string; defaultValue?: string; hidden?: Record<string, string> }) {
  const t = useTranslations("catalogue");
  const router = useRouter();
  const [scanning, setScanning] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const video = useRef<HTMLVideoElement>(null);
  const go = (q: string) => router.push(`${action}?${new URLSearchParams({ ...(hidden ?? {}), q })}`);

  useEffect(() => {
    if (!scanning) return;
    let stream: MediaStream | null = null;
    let stop = false;
    (async () => {
      if (!window.BarcodeDetector || !navigator.mediaDevices?.getUserMedia) { setMessage(t("scanUnsupported")); setScanning(false); return; }
      try {
        const detector = new window.BarcodeDetector({ formats: ["ean_13", "ean_8", "upc_a", "upc_e", "itf", "code_128"] });
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
        if (!video.current) return;
        video.current.srcObject = stream;
        await video.current.play();
        while (!stop) {
          const codes = await detector.detect(video.current).catch(() => []);
          if (codes[0]?.rawValue) { stop = true; setScanning(false); go(codes[0].rawValue); break; }
          await new Promise((r) => setTimeout(r, 250));
        }
      } catch { setMessage(t("scanUnsupported")); setScanning(false); }
    })();
    return () => { stop = true; stream?.getTracks().forEach((tr) => tr.stop()); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scanning]);

  return (
    <div className="space-y-2">
      <form className="flex gap-2" action={action}>
        {Object.entries(hidden ?? {}).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
        <Input name="q" defaultValue={defaultValue} placeholder={t("searchGoods")} className="flex-1" inputMode="search" autoComplete="off" />
        <Button type="submit"><Search /></Button>
        <Button type="button" variant="outline" onClick={() => { setMessage(null); setScanning((s) => !s); }}>
          <ScanBarcode /> {scanning ? t("stopScan") : t("scan")}
        </Button>
      </form>
      {scanning && (
        <div className="space-y-1">
          <video ref={video} className="max-h-64 w-full rounded-lg bg-black object-cover" muted playsInline />
          <p className="text-xs text-muted-foreground">{t("scanning")}</p>
        </div>
      )}
      {message && <p className="text-xs text-muted-foreground">{message}</p>}
    </div>
  );
}
