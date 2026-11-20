"use client";
/**
 * Photo and barcode input for the Assistant. Photos are shrunk in the browser (max 1600 px, JPEG)
 * before upload — smaller and cheaper for the AI. The barcode scanner uses the camera through the
 * browser's BarcodeDetector (Chrome / Edge on Android and desktop); where the browser can't, the
 * scan button doesn't show (a photo of the barcode still works with the AI).
 */
import { useEffect, useRef, useState } from "react";
import { Camera, ImagePlus, ScanBarcode, X } from "lucide-react";

export const MAX_CHAT_PHOTOS = 3;
const MAX_SIDE = 1600;

/** Shrinks a photo to at most 1600 px on its longest side, as JPEG. Falls back to the original. */
export async function shrinkPhoto(file: File): Promise<File> {
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bmp.width * scale); canvas.height = Math.round(bmp.height * scale);
    canvas.getContext("2d")!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.85));
    return blob ? new File([blob], file.name.replace(/\.[^.]+$/, "") + ".jpg", { type: "image/jpeg" }) : file;
  } catch { return file; }
}

export type MediaLabels = { photo: string; scan: string; stopScan: string; scanning: string; removePhoto: string; photoHint: string; tooMany: string; cameraBlocked: string; photo1: string };

/** 🖼️ Add up to three photos (camera or gallery). */
export function PhotoButton({ count, onAdd, l, disabled, onPreparing }: { count: number; onAdd: (files: File[]) => void; l: MediaLabels; disabled?: boolean; onPreparing?: (busy: boolean) => void }) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <input ref={input} type="file" accept="image/jpeg,image/png,image/webp,image/*" multiple hidden data-testid="photo-input"
        onChange={async (e) => {
          const files = [...(e.target.files ?? [])]; e.target.value = "";
          // shrinking takes a moment: the chat waits for it, so a question sent meanwhile goes out with its photos
          onPreparing?.(true);
          try { onAdd(await Promise.all(files.map(shrinkPhoto))); } finally { onPreparing?.(false); }
        }} />
      <button type="button" onClick={() => input.current?.click()} disabled={disabled || count >= MAX_CHAT_PHOTOS} aria-label={l.photo} title={`${l.photo} — ${l.photoHint}`} data-testid="photo-btn"
        className="inline-grid size-10 shrink-0 place-items-center rounded-full border bg-background transition hover:border-[var(--vivid-violet)] hover:text-[var(--vivid-violet)] disabled:opacity-40">
        <ImagePlus className="size-4" aria-hidden />
      </button>
    </>
  );
}

/** Selected photos waiting to be sent, each with a remove button. */
export function PhotoTray({ photos, onRemove, l }: { photos: { url: string }[]; onRemove: (i: number) => void; l: MediaLabels }) {
  if (!photos.length) return null;
  return (
    <div className="flex flex-wrap items-center gap-2 px-3 pt-3" data-testid="photo-tray">
      {photos.map((p, i) => (
        <div key={p.url} className="relative">
          {/* eslint-disable-next-line @next/next/no-img-element -- local preview (object URL) */}
          <img src={p.url} alt={`${l.photo1} ${i + 1}`} className="size-16 rounded-lg border object-cover" />
          <button type="button" onClick={() => onRemove(i)} aria-label={`${l.removePhoto} ${i + 1}`} data-testid="photo-remove"
            className="absolute -right-1.5 -top-1.5 grid size-5 place-items-center rounded-full bg-foreground text-background shadow"><X className="size-3" aria-hidden /></button>
        </div>
      ))}
      <span className="text-xs text-muted-foreground">{l.photoHint}</span>
    </div>
  );
}

type Detector = { detect: (src: HTMLVideoElement) => Promise<{ rawValue: string }[]> };
const detectorCtor = () => (typeof window === "undefined" ? null : (window as unknown as { BarcodeDetector?: new (o: { formats: string[] }) => Detector }).BarcodeDetector ?? null);

/** 📷 Scan a barcode with the camera; the digits are handed to `onCode`. Hidden where the browser can't. */
export function ScanButton({ onCode, l }: { onCode: (code: string) => void; l: MediaLabels }) {
  const [supported, setSupported] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const video = useRef<HTMLVideoElement>(null);
  useEffect(() => { setSupported(!!detectorCtor() && !!navigator.mediaDevices?.getUserMedia); }, []);
  useEffect(() => {
    if (!scanning) return;
    let stream: MediaStream | null = null, stop = false;
    (async () => {
      try {
        const Ctor = detectorCtor()!;
        const detector = new Ctor({ formats: ["ean_13", "ean_8", "upc_a", "upc_e", "itf", "code_128"] });
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
        if (!video.current) return;
        video.current.srcObject = stream;
        await video.current.play().catch(() => {});
        while (!stop) {
          const codes = await detector.detect(video.current).catch(() => []);
          if (codes[0]?.rawValue) { stop = true; setScanning(false); onCode(codes[0].rawValue); break; }
          await new Promise((r) => setTimeout(r, 250));
        }
      } catch { setMessage(l.cameraBlocked); setScanning(false); }
    })();
    return () => { stop = true; stream?.getTracks().forEach((t) => t.stop()); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scanning]);
  if (!supported) return null;
  return (
    <span className="relative inline-flex flex-col">
      <button type="button" onClick={() => { setMessage(null); setScanning((s) => !s); }} aria-pressed={scanning} aria-label={scanning ? l.stopScan : l.scan} title={scanning ? l.stopScan : l.scan} data-testid="scan-btn"
        className={`inline-grid size-10 shrink-0 place-items-center rounded-full border transition ${scanning ? "border-transparent bg-[linear-gradient(135deg,var(--vivid-teal),var(--vivid-blue))] text-white" : "bg-background hover:border-[var(--vivid-violet)] hover:text-[var(--vivid-violet)]"}`}>
        {scanning ? <Camera className="size-4" aria-hidden /> : <ScanBarcode className="size-4" aria-hidden />}
      </button>
      {scanning && (
        <span className="fixed inset-x-4 bottom-24 z-50 mx-auto max-w-md space-y-1 rounded-2xl border bg-card p-2 shadow-xl sm:absolute sm:inset-x-auto sm:bottom-14 sm:right-0 sm:w-80" data-testid="scan-view">
          <video ref={video} className="aspect-video w-full rounded-xl bg-black object-cover" muted playsInline />
          <span className="block px-1 text-xs text-muted-foreground">{l.scanning}</span>
        </span>
      )}
      {message && <span role="status" className="mt-1 max-w-56 text-xs text-destructive" data-testid="scan-status">{message}</span>}
    </span>
  );
}
