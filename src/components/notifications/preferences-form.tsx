"use client";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { markReadAction, savePreferencesAction, subscribePushAction } from "@/server/actions/notifications";

type Cat = { category: string; critical: boolean; channels: { channel: string; enabled: boolean }[] };

export function PreferencesForm({ categories, phone, smsConsent, whatsappConsent, smsAvailable, whatsappAvailable }: {
  categories: Cat[]; phone: string; smsConsent: boolean; whatsappConsent: boolean; smsAvailable: boolean; whatsappAvailable: boolean;
}) {
  const t = useTranslations("notifications");
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [state, setState] = useState(() => Object.fromEntries(categories.flatMap((c) => c.channels.map((ch) => [`${c.category}:${ch.channel}`, ch.enabled]))));
  const [ph, setPh] = useState(phone);
  const [sms, setSms] = useState(smsConsent);
  const [wa, setWa] = useState(whatsappConsent);
  const allChannels = [...new Set(categories.flatMap((c) => c.channels.map((x) => x.channel)))].filter((c) => c !== "IN_APP");
  const save = () => start(async () => {
    setError(null); setSaved(false);
    const prefs = Object.entries(state).map(([k, enabled]) => { const [category, channel] = k.split(":"); return { category, channel: channel as never, enabled }; });
    const r = await savePreferencesAction({ prefs, phone: ph, smsConsent: sms, whatsappConsent: wa });
    if (r.ok) { setSaved(true); router.refresh(); } else setError(r.error);
  });
  return (
    <div className="space-y-5">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr className="border-b text-left text-xs uppercase text-muted-foreground"><th className="py-2 pr-3">{t("category")}</th><th className="px-2 text-center">{t("channels.IN_APP")}</th>{allChannels.map((c) => <th key={c} className="px-2 text-center">{t(`channels.${c}` as never)}</th>)}</tr></thead>
          <tbody>
            {categories.map((c) => (
              <tr key={c.category} className="border-b last:border-0">
                <td className="py-2 pr-3">{t(`categories.${c.category}` as never)}</td>
                <td className="px-2 text-center text-xs text-muted-foreground">
                  {c.channels.some((x) => x.channel === "IN_APP")
                    ? <input type="checkbox" aria-label={`${c.category} IN_APP`} name={`${c.category}:IN_APP`} checked={!!state[`${c.category}:IN_APP`]} onChange={(e) => setState({ ...state, [`${c.category}:IN_APP`]: e.target.checked })} />
                    : t("alwaysOn")}
                </td>
                {allChannels.map((ch) => {
                  const has = c.channels.some((x) => x.channel === ch);
                  const k = `${c.category}:${ch}`;
                  return (
                    <td key={ch} className="px-2 text-center">
                      {has ? <input type="checkbox" aria-label={`${c.category} ${ch}`} name={k} checked={!!state[k]} onChange={(e) => setState({ ...state, [k]: e.target.checked })} /> : <span className="text-muted-foreground">—</span>}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {(smsAvailable || whatsappAvailable) && (
        <div className="max-w-lg space-y-2 rounded-md border p-3">
          <div className="space-y-1"><Label htmlFor="phone">{t("phone")}</Label><Input id="phone" name="phone" inputMode="tel" value={ph} onChange={(e) => setPh(e.target.value)} placeholder="+351 912 345 678" /></div>
          {smsAvailable && <label className="flex items-start gap-2 text-sm"><input type="checkbox" name="smsConsent" className="mt-1" checked={sms} onChange={(e) => setSms(e.target.checked)} /> {t("smsConsent")}</label>}
          {whatsappAvailable && <label className="flex items-start gap-2 text-sm"><input type="checkbox" name="whatsappConsent" className="mt-1" checked={wa} onChange={(e) => setWa(e.target.checked)} /> {t("whatsappConsent")}</label>}
          {!ph.trim() && <p className="text-xs text-muted-foreground">{t("needsPhone")}</p>}
        </div>
      )}
      <div className="flex items-center gap-3">
        <Button disabled={pending} onClick={save}>{t("save")}</Button>
        {saved && <span className="text-sm text-success">{t("saved")}</span>}
        {error && <span className="text-sm text-destructive">{error}</span>}
      </div>
    </div>
  );
}

const b64ToBytes = (b64: string) => {
  const s = atob((b64 + "=".repeat((4 - (b64.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
};

export function PushToggle({ vapidPublicKey }: { vapidPublicKey: string | null }) {
  const t = useTranslations("notifications");
  const [state, setState] = useState<"unknown" | "unsupported" | "denied" | "off" | "on">("unknown");
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!("serviceWorker" in navigator) || !("PushManager" in window) || !vapidPublicKey) return setState("unsupported");
    if (Notification.permission === "denied") return setState("denied");
    navigator.serviceWorker.getRegistration("/sw.js").then(async (r) => setState((await r?.pushManager.getSubscription()) ? "on" : "off"));
  }, [vapidPublicKey]);
  const enable = async () => {
    setError(null);
    try {
      const reg = await navigator.serviceWorker.register("/sw.js");
      if ((await Notification.requestPermission()) !== "granted") return setState("denied");
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(vapidPublicKey!) });
      const j = sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } };
      const r = await subscribePushAction({ endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth, userAgent: navigator.userAgent });
      if (r.ok) setState("on"); else setError(r.error);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  if (state === "unsupported") return <p className="text-sm text-muted-foreground">{t("pushUnsupported")}</p>;
  if (state === "denied") return <p className="text-sm text-muted-foreground">{t("pushDenied")}</p>;
  if (state === "on") return <p className="text-sm text-success">{t("pushOn")}</p>;
  return (<div className="space-y-1"><Button variant="outline" onClick={enable} disabled={state === "unknown"}>{t("pushEnable")}</Button>{error && <p className="text-sm text-destructive">{error}</p>}</div>);
}

export function MarkAllRead() {
  const t = useTranslations("notifications");
  const router = useRouter();
  const [pending, start] = useTransition();
  return <Button variant="outline" size="sm" disabled={pending} onClick={() => start(async () => { await markReadAction({ id: "ALL" }); router.refresh(); })}>{t("markAllRead")}</Button>;
}
