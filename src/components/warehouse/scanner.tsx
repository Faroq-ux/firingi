"use client";
/**
 * Scan input (Phase 25), phone-first:
 *  • the phone camera — the browser's BarcodeDetector where there is one (Chrome / Android), the
 *    ZXing decoder elsewhere (iPhone Safari, Firefox) — reads QR codes and EAN / Code 128 barcodes;
 *  • USB / Bluetooth scanners type the code and press Enter into the field (kept focused);
 *  • or the code is typed by hand.
 * The same code read twice within 2 seconds counts once.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Camera, CameraOff, ScanLine } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Detector = { detect: (src: CanvasImageSource) => Promise<{ rawValue: string }[]> };
type Stopper = { stop: () => void };
const FORMATS = ["qr_code", "ean_13", "ean_8", "upc_a", "upc_e", "code_128", "code_39", "itf", "data_matrix"];

export function Scanner({ onCode, busy, autoFocus = true, testId = "scan-input", placeholder }: { onCode: (code: string) => void; busy?: boolean; autoFocus?: boolean; testId?: string; placeholder?: string }) {
  const t = useTranslations("warehouse");
  const [value, setValue] = useState("");
  const [camera, setCamera] = useState(false);
  const [camError, setCamError] = useState<string | null>(null);
  const video = useRef<HTMLVideoElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const last = useRef<{ code: string; at: number }>({ code: "", at: 0 });
  const stopper = useRef<Stopper | null>(null);

  const emit = useCallback((raw: string) => {
    const code = raw.trim();
    if (!code) return;
    const now = Date.now();
    if (code === last.current.code && now - last.current.at < 2000) return;
    last.current = { code, at: now };
    if (typeof navigator !== "undefined" && "vibrate" in navigator) navigator.vibrate?.(40);
    onCode(code);
  }, [onCode]);

  const stop = useCallback(() => {
    stopper.current?.stop();
    stopper.current = null;
    const v = video.current;
    const stream = v?.srcObject as MediaStream | null;
    stream?.getTracks().forEach((tr) => tr.stop());
    if (v) v.srcObject = null;
  }, []);

  useEffect(() => {
    if (!camera) { stop(); return; }
    let cancelled = false;
    (async () => {
      setCamError(null);
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error("no-camera");
        const Native = (globalThis as unknown as { BarcodeDetector?: new (o: { formats: string[] }) => Detector }).BarcodeDetector;
        if (Native) {
          const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
          if (cancelled) { stream.getTracks().forEach((tr) => tr.stop()); return; }
          const v = video.current!;
          v.srcObject = stream;
          await v.play();
          const det = new Native({ formats: FORMATS });
          let running = true;
          stopper.current = { stop: () => { running = false; } };
          const tick = async () => {
            if (!running || cancelled) return;
            try { const found = await det.detect(v); if (found[0]?.rawValue) emit(found[0].rawValue); } catch { /* frame not ready */ }
            setTimeout(tick, 180);
          };
          tick();
        } else {
          const { BrowserMultiFormatReader } = await import("@zxing/browser");
          const reader = new BrowserMultiFormatReader();
          const controls = await reader.decodeFromConstraints({ video: { facingMode: { ideal: "environment" } } }, video.current!, (res) => { if (res) emit(res.getText()); });
          if (cancelled) { controls.stop(); return; }
          stopper.current = controls;
        }
      } catch (e) {
        setCamError((e as Error).name === "NotAllowedError" ? t("cameraDenied") : t("cameraUnavailable"));
        setCamera(false);
      }
    })();
    return () => { cancelled = true; stop(); };
  }, [camera, emit, stop, t]);

  useEffect(() => { if (autoFocus && !busy) input.current?.focus(); }, [autoFocus, busy]);

  return (
    <div className="space-y-2">
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); emit(value); last.current.at = 0; setValue(""); }}>
        <div className="relative flex-1">
          <ScanLine className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input ref={input} data-testid={testId} value={value} onChange={(e) => setValue(e.target.value)} placeholder={placeholder ?? t("scanPlaceholder")} aria-label={t("scanPlaceholder")}
            className="h-12 pl-9 text-base" autoComplete="off" autoCapitalize="off" spellCheck={false} inputMode="text" enterKeyHint="go" />
        </div>
        <Button type="button" variant={camera ? "default" : "outline"} className="h-12 px-3" onClick={() => setCamera((c) => !c)} aria-pressed={camera} aria-label={camera ? t("cameraOff") : t("cameraOn")} data-testid="camera-toggle">
          {camera ? <CameraOff className="size-5" /> : <Camera className="size-5" />}<span className="hidden sm:inline">{camera ? t("cameraOff") : t("cameraOn")}</span>
        </Button>
      </form>
      {camError && <p className="text-sm text-destructive" role="alert">{camError}</p>}
      <div className={camera ? "relative overflow-hidden rounded-xl border bg-black" : "hidden"}>
        <video ref={video} className="aspect-[4/3] w-full object-cover" muted playsInline />
        <div className="pointer-events-none absolute inset-x-8 top-1/2 h-0.5 -translate-y-1/2 animate-pulse bg-red-500/80 shadow-[0_0_12px_rgba(239,68,68,.8)]" />
      </div>
    </div>
  );
}
