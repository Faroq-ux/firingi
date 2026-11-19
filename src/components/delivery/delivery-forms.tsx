"use client";
/** Client forms for dispatching, the driver app, returns and fleet management. */
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import {
  addDriverAction, addServiceAreaAction, addVehicleAction, assignDeliveryAction, completeDeliveryAction, driverStepAction, failDeliveryAction,
  receiveReturnAction, removeServiceAreaAction, requestReturnAction, returnToSupplierAction, reviewReturnAction, setAvailabilityAction, setCarrierAction,
  setDriverActiveAction, setVehicleStatusAction, setVendorMultiOrderAction,
} from "@/server/actions/delivery";
import type { ActionResult } from "@/server/actions/_action";
import { EmptiesCounter, type StopItem } from "@/components/returnables/client";
import { StopWeights, type StopWeightLine } from "@/components/catchweight/client";
import { HandoverTemps, type Cls } from "@/components/coldchain/client";

const sel = "h-9 rounded-md border border-input bg-background px-2 text-sm";

function useAct() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const run = (fn: () => Promise<ActionResult<unknown>>, after?: () => void) =>
    start(async () => {
      setError(null);
      const r = await fn();
      if (r.ok) { after?.(); router.refresh(); } else setError(r.error);
    });
  return { pending, error, run };
}
const Err = ({ e }: { e: string | null }) => (e ? <p className="w-full text-sm text-destructive">{e}</p> : null);

// ── dispatching ─────────────────────────────────────────────────────────────

export function AssignForm(props: {
  deliveryId: string; driverId: string | null; vehicleId: string | null; scheduledFor: string | null; notes: string | null; retry: boolean;
  drivers: { id: string; name: string; availability: string }[]; vehicles: { id: string; label: string }[];
}) {
  const t = useTranslations("delivery");
  const ta = useTranslations("delivery.availabilityStatus");
  const { pending, error, run } = useAct();
  const [driverId, setDriver] = useState(props.driverId ?? "");
  const [vehicleId, setVehicle] = useState(props.vehicleId ?? "");
  const [when, setWhen] = useState(props.scheduledFor ?? "");
  const [notes, setNotes] = useState(props.notes ?? "");
  return (
    <div className="space-y-2">
      {props.retry && <p className="text-sm text-warning">{t("retryHint")}</p>}
      <div className="grid gap-2">
        <Label>{t("driver")}</Label>
        <select name="driverId" className={sel} value={driverId} onChange={(e) => setDriver(e.target.value)}>
          <option value="">—</option>
          {props.drivers.map((d) => <option key={d.id} value={d.id}>{d.name} · {ta(d.availability as never)}</option>)}
        </select>
        <Label>{t("vehicle")}</Label>
        <select name="vehicleId" className={sel} value={vehicleId} onChange={(e) => setVehicle(e.target.value)}>
          <option value="">—</option>
          {props.vehicles.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
        </select>
        <Label>{t("scheduled")}</Label>
        <Input type="date" value={when} onChange={(e) => setWhen(e.target.value)} />
        <Label>{t("notes")}</Label>
        <Input value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={500} />
      </div>
      <Button disabled={pending} onClick={() => run(() => assignDeliveryAction({ id: props.deliveryId, driverId: driverId || null, vehicleId: vehicleId || null, scheduledFor: when || null, notes }))}>{t("assign")}</Button>
      <Err e={error} />
    </div>
  );
}

export function CarrierForm({ deliveryId, carrierName, trackingNumber }: { deliveryId: string; carrierName: string | null; trackingNumber: string | null }) {
  const t = useTranslations("delivery");
  const { pending, error, run } = useAct();
  const [name, setName] = useState(carrierName ?? "");
  const [track, setTrack] = useState(trackingNumber ?? "");
  return (
    <div className="grid gap-2">
      <Label>{t("carrier")}</Label><Input value={name} onChange={(e) => setName(e.target.value)} />
      <Label>{t("tracking")}</Label><Input value={track} onChange={(e) => setTrack(e.target.value)} />
      <Button disabled={pending || name.trim().length < 2} onClick={() => run(() => setCarrierAction({ id: deliveryId, carrierName: name, trackingNumber: track }))}>{t("saveCarrier")}</Button>
      <Err e={error} />
    </div>
  );
}

export function ReturnToSupplierButton({ deliveryId }: { deliveryId: string }) {
  const t = useTranslations("delivery");
  const { pending, error, run } = useAct();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  if (!open) return <Button variant="outline" onClick={() => setOpen(true)}>{t("returnToSupplier")}</Button>;
  return (
    <div className="grid gap-2">
      <Label>{t("reason")}</Label><Input value={reason} onChange={(e) => setReason(e.target.value)} />
      <div className="flex gap-2">
        <Button variant="destructive" disabled={pending || reason.trim().length < 2} onClick={() => run(() => returnToSupplierAction({ id: deliveryId, reason }))}>{t("returnToSupplier")}</Button>
        <Button variant="ghost" onClick={() => setOpen(false)}>{t("cancel")}</Button>
      </div>
      <Err e={error} />
    </div>
  );
}

// ── driver app ──────────────────────────────────────────────────────────────

export function AvailabilitySwitch({ current }: { current: string }) {
  const t = useTranslations("delivery.availabilityStatus");
  const { pending, error, run } = useAct();
  return (
    <div className="flex flex-wrap items-center gap-2">
      {(["AVAILABLE", "OFF_DUTY"] as const).map((a) => (
        <Button key={a} size="sm" variant={current === a ? "default" : "outline"} disabled={pending || current === a} onClick={() => run(() => setAvailabilityAction({ availability: a }))}>{t(a)}</Button>
      ))}
      {current === "BUSY" && <span className="text-sm text-muted-foreground">{t("BUSY")}</span>}
      <Err e={error} />
    </div>
  );
}

export function DriverStepButton({ deliveryId, step }: { deliveryId: string; step: "PICK_UP" | "START" }) {
  const t = useTranslations("delivery");
  const { pending, error, run } = useAct();
  return (
    <div className="w-full">
      <Button className="h-12 w-full text-base" disabled={pending} onClick={() => run(() => driverStepAction({ id: deliveryId, step }))}>{step === "PICK_UP" ? t("pickUp") : t("start")}</Button>
      <Err e={error} />
    </div>
  );
}

function useLocation() {
  const [loc, setLoc] = useState<{ lat: number; lng: number } | null>(null);
  const [err, setErr] = useState(false);
  const ask = () => {
    if (!navigator.geolocation) return setErr(true);
    navigator.geolocation.getCurrentPosition((p) => setLoc({ lat: p.coords.latitude, lng: p.coords.longitude }), () => setErr(true), { enableHighAccuracy: true, timeout: 10000 });
  };
  return { loc, err, ask };
}

/** Shrink camera photos before upload (long side ≤ 1600 px, JPEG). */
export async function shrink(file: File): Promise<File> {
  if (!file.type.startsWith("image/") || file.size < 400_000) return file;
  try {
    const bmp = await createImageBitmap(file);
    const k = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
    const c = document.createElement("canvas");
    c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
    c.getContext("2d")!.drawImage(bmp, 0, 0, c.width, c.height);
    const blob: Blob | null = await new Promise((r) => c.toBlob(r, "image/jpeg", 0.82));
    return blob ? new File([blob], file.name.replace(/\.\w+$/, ".jpg"), { type: "image/jpeg" }) : file;
  } catch {
    return file;
  }
}

function SignaturePad({ onChange }: { onChange: (dataUrl: string | null) => void }) {
  const t = useTranslations("delivery");
  const ref = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const drawn = useRef(false);
  useEffect(() => {
    const c = ref.current!;
    const ratio = window.devicePixelRatio || 1;
    c.width = c.offsetWidth * ratio; c.height = c.offsetHeight * ratio;
    const g = c.getContext("2d")!;
    g.scale(ratio, ratio); g.lineWidth = 2.2; g.lineCap = "round"; g.strokeStyle = "#111827";
  }, []);
  const pos = (e: React.PointerEvent<HTMLCanvasElement>) => { const r = e.currentTarget.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top] as const; };
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between"><Label>{t("signHere")}</Label>
        <button type="button" className="text-xs text-primary" onClick={() => { const c = ref.current!; c.getContext("2d")!.clearRect(0, 0, c.width, c.height); drawn.current = false; onChange(null); }}>{t("clear")}</button>
      </div>
      <canvas
        ref={ref}
        data-testid="signature"
        className="h-40 w-full touch-none rounded-md border bg-white"
        onPointerDown={(e) => { drawing.current = true; const g = e.currentTarget.getContext("2d")!; const [x, y] = pos(e); g.beginPath(); g.moveTo(x, y); e.currentTarget.setPointerCapture(e.pointerId); }}
        onPointerMove={(e) => { if (!drawing.current) return; const g = e.currentTarget.getContext("2d")!; const [x, y] = pos(e); g.lineTo(x, y); g.stroke(); drawn.current = true; }}
        onPointerUp={(e) => { drawing.current = false; if (drawn.current) onChange(e.currentTarget.toDataURL("image/png")); }}
      />
    </div>
  );
}

export function CompleteDeliveryForm({ deliveryId, empties, emptiesLabels, weights, weightLabels, locale, cold, coldLabels, licenceCheck }: {
  deliveryId: string; empties?: StopItem[]; emptiesLabels?: Record<string, string>;
  /** Phase 41: sold-by-weight lines the driver may weigh again */ weights?: { correction: boolean; lines: StopWeightLine[] }; weightLabels?: Record<string, string>; locale?: string;
  /** Phase 42: cold classes to record at the handover */ cold?: { refuse: boolean; block: boolean; required: boolean; classes: Cls[] }; coldLabels?: Record<string, string>;
  /** Phase 43: licensed goods — the driver confirms the licence / ID check (label in the driver's language) */ licenceCheck?: string;
}) {
  const t = useTranslations("delivery");
  const { pending, error, run } = useAct();
  const [name, setName] = useState("");
  // Phase 40: empties taken back at the stop (refills: the empties swapped for the full ones)
  const [counted, setCounted] = useState<Record<string, number>>(Object.fromEntries((empties ?? []).map((i) => [i.typeId, i.kind === "EXCHANGE" ? Math.min(i.fullOut, i.held) : 0])));
  const [kg, setKg] = useState<Record<string, string>>({});
  const [acceptOver, setAcceptOver] = useState(false);
  const [temps, setTemps] = useState<Record<string, string>>({});
  const [refused, setRefused] = useState<string[]>([]);
  const [checked, setChecked] = useState(false);
  const [sig, setSig] = useState<string | null>(null);
  const [photos, setPhotos] = useState<File[]>([]);
  const { loc, ask } = useLocation();
  const submit = () =>
    run(async () => {
      const fd = new FormData();
      fd.set("id", deliveryId); fd.set("recipientName", name);
      if (sig) fd.set("signature", sig);
      for (const p of photos) fd.append("photos", await shrink(p));
      if (loc) { fd.set("latitude", String(loc.lat)); fd.set("longitude", String(loc.lng)); }
      for (const i of empties ?? []) fd.set(`empty:${i.typeId}`, String(counted[i.typeId] ?? 0));
      for (const [lineId, v] of Object.entries(kg)) if (v.trim()) fd.set(`weight:${lineId}`, v.trim());
      if (acceptOver) fd.set("acceptOver", "true");
      for (const [cid, v] of Object.entries(temps)) if (v.trim()) fd.set(`temp:${cid}`, v.trim());
      for (const cid of refused) fd.append("refuse", cid);
      if (checked) fd.set("licenceChecked", "true");
      return completeDeliveryAction(fd);
    });
  return (
    <div className="space-y-3">
      <div className="space-y-1"><Label htmlFor="recipientName">{t("recipientName")}</Label><Input id="recipientName" value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" /></div>
      <SignaturePad onChange={setSig} />
      {empties && empties.length > 0 && emptiesLabels && <EmptiesCounter l={emptiesLabels} items={empties} value={counted} onChange={setCounted} />}
      {cold && coldLabels && <HandoverTemps l={coldLabels} classes={cold.classes} value={temps} onChange={setTemps} refused={refused} onRefuse={setRefused} refuse={cold.refuse} block={cold.block} required={cold.required} />}
      {licenceCheck && <label className="flex items-start gap-2 rounded-xl border p-3 text-sm" data-testid="licence-check"><input type="checkbox" className="mt-0.5 size-5" checked={checked} onChange={(e) => setChecked(e.target.checked)} /> {licenceCheck}</label>}
      {weights && weightLabels && <StopWeights l={weightLabels} locale={locale ?? "pt-PT"} lines={weights.lines} correction={weights.correction} value={kg} onChange={setKg} accept={acceptOver} onAccept={setAcceptOver} />}
      <div className="space-y-1"><Label htmlFor="photos">{t("addPhotos")}</Label><Input id="photos" type="file" accept="image/*" capture="environment" multiple onChange={(e) => setPhotos([...(e.target.files ?? [])].slice(0, 4))} /></div>
      <Button type="button" variant="outline" size="sm" onClick={ask} disabled={!!loc}>{loc ? t("locationAdded") : t("useLocation")}</Button>
      <Button className="h-12 w-full text-base" disabled={pending || name.trim().length < 2 || (!sig && !photos.length) || (!!licenceCheck && !checked)} onClick={submit}>{t("confirmDelivery")}</Button>
      <Err e={error} />
    </div>
  );
}

export function FailDeliveryForm({ deliveryId, reasons }: { deliveryId: string; reasons: string[] }) {
  const t = useTranslations("delivery");
  const tr = useTranslations("delivery.reasons");
  const { pending, error, run } = useAct();
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState("");
  const [note, setNote] = useState("");
  const [photo, setPhoto] = useState<File | null>(null);
  const { loc, ask } = useLocation();
  if (!open) return <Button variant="outline" className="h-11 w-full" onClick={() => setOpen(true)}>{t("fail")}</Button>;
  return (
    <div className="space-y-3 rounded-md border border-destructive/40 p-3">
      <div className="space-y-1"><Label>{t("failReason")}</Label>
        <select name="reasonCode" className={`${sel} w-full`} value={code} onChange={(e) => setCode(e.target.value)}>
          <option value="">—</option>
          {reasons.map((r) => <option key={r} value={r}>{tr(r as never)}</option>)}
        </select>
      </div>
      <div className="space-y-1"><Label>{t("note")}</Label><Input value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} /></div>
      <div className="space-y-1"><Label>{t("photo")}</Label><Input type="file" accept="image/*" capture="environment" onChange={(e) => setPhoto(e.target.files?.[0] ?? null)} /></div>
      <Button type="button" variant="outline" size="sm" onClick={ask} disabled={!!loc}>{loc ? t("locationAdded") : t("useLocation")}</Button>
      <div className="flex gap-2">
        <Button variant="destructive" disabled={pending || !code} onClick={() => run(async () => {
          const fd = new FormData();
          fd.set("id", deliveryId); fd.set("reasonCode", code); fd.set("note", note);
          if (photo) fd.set("photo", await shrink(photo));
          if (loc) { fd.set("latitude", String(loc.lat)); fd.set("longitude", String(loc.lng)); }
          return failDeliveryAction(fd);
        })}>{t("reportFailure")}</Button>
        <Button variant="ghost" onClick={() => setOpen(false)}>{t("cancel")}</Button>
      </div>
      <Err e={error} />
    </div>
  );
}

// ── returns ─────────────────────────────────────────────────────────────────

export function ReturnRequestForm({ orderId, lines, days }: { orderId: string; lines: { id: string; label: string; returnable: number }[]; days: number }) {
  const t = useTranslations("delivery");
  const { pending, error, run } = useAct();
  const [open, setOpen] = useState(false);
  const [qty, setQty] = useState<Record<string, number>>({});
  const [reason, setReason] = useState("");
  const [photos, setPhotos] = useState<File[]>([]);
  const [sent, setSent] = useState(false);
  if (sent) return <p className="text-sm text-success">{t("returnSent")}</p>;
  if (!open) return <Button variant="outline" onClick={() => setOpen(true)}>{t("requestReturn")}</Button>;
  const any = Object.values(qty).some((q) => q > 0);
  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">{t("returnIntro", { days })}</p>
      {lines.map((l) => (
        <div key={l.id} className="flex items-center justify-between gap-2 text-sm">
          <span className="min-w-0 flex-1 truncate">{l.label}</span>
          <Input aria-label={t("qtyToReturn")} type="number" min={0} max={l.returnable} className="w-20" value={qty[l.id] ?? 0} onChange={(e) => setQty({ ...qty, [l.id]: Math.min(l.returnable, Math.max(0, Number(e.target.value))) })} />
          <span className="w-8 text-xs text-muted-foreground">/ {l.returnable}</span>
        </div>
      ))}
      <div className="space-y-1"><Label>{t("returnReason")}</Label><Input name="returnReason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} /></div>
      <div className="space-y-1"><Label>{t("addPhotos")}</Label><Input type="file" accept="image/*" multiple onChange={(e) => setPhotos([...(e.target.files ?? [])].slice(0, 4))} /></div>
      <div className="flex gap-2">
        <Button disabled={pending || !any || reason.trim().length < 5} onClick={() => run(async () => {
          const fd = new FormData();
          fd.set("orderId", orderId); fd.set("reason", reason);
          for (const [id, q] of Object.entries(qty)) if (q > 0) fd.append("line", `${id}:${q}`);
          for (const p of photos) fd.append("photos", await shrink(p));
          return requestReturnAction(fd);
        }, () => setSent(true))}>{t("sendRequest")}</Button>
        <Button variant="ghost" onClick={() => setOpen(false)}>{t("cancel")}</Button>
      </div>
      <Err e={error} />
    </div>
  );
}

export function ReturnActions({ id, canReview, canReceive }: { id: string; canReview: boolean; canReceive: boolean }) {
  const t = useTranslations("delivery");
  const { pending, error, run } = useAct();
  const [note, setNote] = useState("");
  const [restock, setRestock] = useState(true);
  return (
    <div className="flex flex-wrap items-center gap-2">
      {canReview && (<>
        <Input className="h-8 w-48" placeholder={t("reason")} value={note} onChange={(e) => setNote(e.target.value)} />
        <Button size="sm" disabled={pending} onClick={() => run(() => reviewReturnAction({ id, decision: "APPROVED", note }))}>{t("approve")}</Button>
        <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => reviewReturnAction({ id, decision: "REJECTED", note }))}>{t("reject")}</Button>
      </>)}
      {canReceive && (<>
        <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={restock} onChange={(e) => setRestock(e.target.checked)} /> {t("restock")}</label>
        <Button size="sm" disabled={pending} onClick={() => run(() => receiveReturnAction({ id, restock }))}>{t("receive")}</Button>
      </>)}
      <Err e={error} />
    </div>
  );
}

// ── fleet ───────────────────────────────────────────────────────────────────

export function AddDriverForm() {
  const t = useTranslations("delivery");
  const { pending, error, run } = useAct();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ name: "", email: "", phone: "", password: "", licenceNumber: "", licenceExpiry: "" });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  if (!open) return <Button onClick={() => setOpen(true)}>{t("addDriver")}</Button>;
  return (
    <div className="space-y-3 rounded-md border p-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1"><Label>{t("name")}</Label><Input name="driverName" value={f.name} onChange={set("name")} /></div>
        <div className="space-y-1"><Label>{t("email")}</Label><Input name="driverEmail" type="email" value={f.email} onChange={set("email")} /></div>
        <div className="space-y-1"><Label>{t("phone")}</Label><Input name="driverPhone" value={f.phone} onChange={set("phone")} /></div>
        <div className="space-y-1"><Label>{t("password")}</Label><Input name="driverPassword" type="password" value={f.password} onChange={set("password")} autoComplete="new-password" /></div>
        <div className="space-y-1"><Label>{t("licenceNumber")}</Label><Input name="licenceNumber" value={f.licenceNumber} onChange={set("licenceNumber")} /></div>
        <div className="space-y-1"><Label>{t("licenceExpiry")}</Label><Input name="licenceExpiry" type="date" value={f.licenceExpiry} onChange={set("licenceExpiry")} /></div>
      </div>
      <p className="text-xs text-muted-foreground">{t("driverLoginHint")}</p>
      <div className="flex gap-2">
        <Button disabled={pending} onClick={() => run(() => addDriverAction({ ...f, licenceExpiry: f.licenceExpiry || null }), () => { setOpen(false); setF({ name: "", email: "", phone: "", password: "", licenceNumber: "", licenceExpiry: "" }); })}>{t("save")}</Button>
        <Button variant="ghost" onClick={() => setOpen(false)}>{t("cancel")}</Button>
      </div>
      <Err e={error} />
    </div>
  );
}

export function DriverActiveToggle({ id, active }: { id: string; active: boolean }) {
  const t = useTranslations("delivery");
  const { pending, error, run } = useAct();
  const [reason, setReason] = useState("");
  const [ask, setAsk] = useState(false);
  if (active && ask)
    return (
      <div className="flex flex-wrap items-center gap-1">
        <Input className="h-8 w-40" placeholder={t("reason")} value={reason} onChange={(e) => setReason(e.target.value)} />
        <Button size="sm" variant="destructive" disabled={pending || !reason.trim()} onClick={() => run(() => setDriverActiveAction({ id, active: false, reason }))}>{t("suspend")}</Button>
        <Err e={error} />
      </div>
    );
  return (
    <div>
      <Button size="sm" variant="outline" disabled={pending} onClick={() => (active ? setAsk(true) : run(() => setDriverActiveAction({ id, active: true })))}>{active ? t("suspend") : t("reactivate")}</Button>
      <Err e={error} />
    </div>
  );
}

export function AddVehicleForm({ types }: { types: string[] }) {
  const t = useTranslations("delivery");
  const tt = useTranslations("delivery.vehicleTypes");
  const { pending, error, run } = useAct();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ plate: "", type: "VAN", make: "", model: "", capacityKg: "", capacityM3: "" });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  if (!open) return <Button onClick={() => setOpen(true)}>{t("addVehicle")}</Button>;
  return (
    <div className="space-y-3 rounded-md border p-3">
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="space-y-1"><Label>{t("plate")}</Label><Input name="plate" value={f.plate} onChange={set("plate")} /></div>
        <div className="space-y-1"><Label>{t("type")}</Label><select name="vehicleType" className={`${sel} w-full`} value={f.type} onChange={set("type")}>{types.map((x) => <option key={x} value={x}>{tt(x as never)}</option>)}</select></div>
        <div className="space-y-1"><Label>{t("make")}</Label><Input value={f.make} onChange={set("make")} /></div>
        <div className="space-y-1"><Label>{t("model")}</Label><Input value={f.model} onChange={set("model")} /></div>
        <div className="space-y-1"><Label>{t("capacityKg")}</Label><Input type="number" min={0} value={f.capacityKg} onChange={set("capacityKg")} /></div>
        <div className="space-y-1"><Label>{t("capacityM3")}</Label><Input type="number" min={0} step="0.1" value={f.capacityM3} onChange={set("capacityM3")} /></div>
      </div>
      <div className="flex gap-2">
        <Button disabled={pending || f.plate.trim().length < 2} onClick={() => run(() => addVehicleAction(f), () => { setOpen(false); setF({ plate: "", type: "VAN", make: "", model: "", capacityKg: "", capacityM3: "" }); })}>{t("save")}</Button>
        <Button variant="ghost" onClick={() => setOpen(false)}>{t("cancel")}</Button>
      </div>
      <Err e={error} />
    </div>
  );
}

export function VehicleStatusSelect({ id, status, statuses, needsReason }: { id: string; status: string; statuses: string[]; needsReason?: boolean }) {
  const t = useTranslations("delivery.vehicleStatus");
  const { pending, error, run } = useAct();
  return (
    <div>
      <select aria-label="status" className={sel} value={status} disabled={pending} onChange={(e) => {
        const to = e.target.value as "ACTIVE" | "MAINTENANCE" | "INACTIVE";
        const reason = needsReason && to === "INACTIVE" ? window.prompt("Reason") : null;
        if (needsReason && to === "INACTIVE" && !reason) return;
        run(() => setVehicleStatusAction({ id, status: to, reason }));
      }}>
        {[status, ...statuses.filter((s) => s !== status)].map((s) => <option key={s} value={s}>{t(s as never)}</option>)}
      </select>
      <Err e={error} />
    </div>
  );
}

export function MultiOrderForm({ enabled, max, cap, allowed }: { enabled: boolean; max: number; cap: number; allowed: boolean }) {
  const t = useTranslations("delivery");
  const { pending, error, run } = useAct();
  const [on, setOn] = useState(enabled);
  const [m, setM] = useState(String(max));
  if (!allowed) return <p className="text-sm text-muted-foreground">{t("multiOrderOff")}</p>;
  return (
    <div className="flex flex-wrap items-end gap-3">
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="multiOrder" checked={on} onChange={(e) => setOn(e.target.checked)} /> {on ? t("on") : t("off")}</label>
      {on && <div className="space-y-1"><Label>{t("multiOrderMax")}</Label><Input name="multiOrderMax" type="number" min={2} max={cap} className="w-24" value={m} onChange={(e) => setM(e.target.value)} /></div>}
      <Button size="sm" disabled={pending || (on === enabled && Number(m) === max)} onClick={() => run(() => setVendorMultiOrderAction({ enabled: on, max: Number(m) || 2 }))}>{t("save")}</Button>
      <Err e={error} />
    </div>
  );
}

// ── service areas ───────────────────────────────────────────────────────────

type Opt = { id: string; name: string; countryId?: string };
export function AddAreaForm({ countries, regions, cities, zones, origins, ownCountryId, distributor }: {
  countries: { id: string; label: string }[]; regions: Opt[]; cities: Opt[]; zones: Opt[]; origins: Opt[]; ownCountryId: string; distributor: boolean;
}) {
  const t = useTranslations("delivery");
  const tt = useTranslations("delivery.areaTypes");
  const { pending, error, run } = useAct();
  type AreaType = "RADIUS_KM" | "CITY" | "REGION" | "ZONE" | "COUNTRY";
  const types: AreaType[] = ["RADIUS_KM", "CITY", "REGION", "ZONE", ...(distributor ? (["COUNTRY"] as const) : [])];
  const [type, setType] = useState<AreaType>("RADIUS_KM");
  const [countryId, setCountry] = useState(ownCountryId);
  const [pick, setPick] = useState("");
  const [radius, setRadius] = useState("25");
  const inCountry = (o: Opt) => !o.countryId || o.countryId === countryId;
  const list = type === "REGION" ? regions : type === "CITY" ? cities : type === "ZONE" ? zones : type === "RADIUS_KM" ? origins : [];
  const submit = () =>
    run(() => addServiceAreaAction({
      type, countryId: type === "COUNTRY" ? countryId : null, regionId: type === "REGION" ? pick : null, cityId: type === "CITY" ? pick : null,
      zoneId: type === "ZONE" ? pick : null, originAddressId: type === "RADIUS_KM" ? pick : null, radiusKm: type === "RADIUS_KM" ? Number(radius) : null,
    }), () => setPick(""));
  return (
    <div className="flex flex-wrap items-end gap-2">
      <div className="space-y-1"><Label>{t("areaType")}</Label>
        <select name="areaType" className={sel} value={type} onChange={(e) => { setType(e.target.value as never); setPick(""); }}>{types.map((x) => <option key={x} value={x}>{tt(x)}</option>)}</select>
      </div>
      {(type === "COUNTRY" || (distributor && type !== "RADIUS_KM")) && (
        <div className="space-y-1"><Label>{t("country")}</Label>
          <select name="areaCountry" className={sel} value={countryId} onChange={(e) => { setCountry(e.target.value); setPick(""); }}>{countries.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</select>
        </div>
      )}
      {type !== "COUNTRY" && (
        <div className="space-y-1"><Label>{type === "RADIUS_KM" ? t("origin") : tt(type)}</Label>
          <select name="areaPick" className={`${sel} max-w-64`} value={pick} onChange={(e) => setPick(e.target.value)}>
            <option value="">—</option>
            {list.filter(type === "RADIUS_KM" ? () => true : inCountry).map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
        </div>
      )}
      {type === "RADIUS_KM" && <div className="space-y-1"><Label>{t("radius")}</Label><Input name="radiusKm" type="number" min={1} max={1000} className="w-24" value={radius} onChange={(e) => setRadius(e.target.value)} /></div>}
      <Button disabled={pending || (type !== "COUNTRY" && !pick)} onClick={submit}>{t("addArea")}</Button>
      {type === "RADIUS_KM" && !origins.length && <p className="w-full text-xs text-muted-foreground">{t("noOrigins")}</p>}
      <Err e={error} />
    </div>
  );
}

export function RemoveAreaButton({ id }: { id: string }) {
  const t = useTranslations("delivery");
  const { pending, error, run } = useAct();
  return (<><Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => removeServiceAreaAction({ id }))}>{t("remove")}</Button><Err e={error} /></>);
}
