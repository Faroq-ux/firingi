"use client";
/** My security: two-factor login (authenticator app) and signed-in devices. */
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import QRCode from "qrcode";
import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { endOtherSessionsAction, endSessionAction } from "@/server/actions/security";

export function TwoFactorPanel({ enabled, required }: { enabled: boolean; required: boolean }) {
  const t = useTranslations("security");
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [setup, setSetup] = useState<{ qr: string; key: string; backupCodes: string[] } | null>(null);
  const [code, setCode] = useState("");

  const turnOn = () => start(async () => {
    setError(null);
    const r = await authClient.twoFactor.enable({ password });
    if (r.error || !r.data) return setError(t("wrongPassword"));
    const key = new URL(r.data.totpURI).searchParams.get("secret") ?? "";
    setSetup({ qr: await QRCode.toDataURL(r.data.totpURI, { margin: 1, width: 192 }), key, backupCodes: r.data.backupCodes });
    setPassword("");
  });
  const verify = () => start(async () => {
    setError(null);
    const r = await authClient.twoFactor.verifyTotp({ code: code.trim() });
    if (r.error) return setError(t("badCode"));
    setSetup(null);
    router.refresh();
  });
  const turnOff = () => start(async () => {
    setError(null);
    const r = await authClient.twoFactor.disable({ password });
    if (r.error) return setError(t("wrongPassword"));
    setPassword("");
    router.refresh();
  });

  if (setup)
    return (
      <div className="space-y-4" data-testid="two-factor-setup">
        <p className="text-sm">{t("scan")}</p>
        <div className="flex flex-wrap items-start gap-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={setup.qr} alt="" className="size-48 rounded-md border bg-white p-1" />
          <div className="space-y-1 text-sm">
            <div className="text-muted-foreground">{t("key")}</div>
            <code className="block break-all rounded bg-muted p-2 font-mono text-xs" data-testid="totp-key">{setup.key}</code>
          </div>
        </div>
        <div>
          <p className="mb-1 text-sm">{t("backupCodes")}</p>
          <ul className="grid grid-cols-2 gap-1 font-mono text-xs sm:grid-cols-5" data-testid="backup-codes">{setup.backupCodes.map((c) => <li key={c} className="rounded bg-muted px-2 py-1">{c}</li>)}</ul>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-1"><Label htmlFor="totp">{t("enterCode")}</Label><Input id="totp" name="totp" inputMode="numeric" autoComplete="one-time-code" className="w-40" value={code} onChange={(e) => setCode(e.target.value)} /></div>
          <Button disabled={pending || code.trim().length < 6} onClick={verify}>{t("verify")}</Button>
        </div>
        {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
      </div>
    );

  return (
    <div className="space-y-3">
      {enabled ? <p className="text-sm font-medium text-success" data-testid="two-factor-on">{t("enabled")}</p> : <p className="text-sm text-muted-foreground">{t("twoFactorIntro")}</p>}
      {enabled && required ? <p className="text-xs text-muted-foreground">{t("cannotTurnOff")}</p> : (
        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-1"><Label htmlFor="pw">{t("password")}</Label><Input id="pw" name="password" type="password" autoComplete="current-password" className="w-64" value={password} onChange={(e) => setPassword(e.target.value)} /></div>
          <Button variant={enabled ? "outline" : "default"} disabled={pending || !password} onClick={enabled ? turnOff : turnOn}>{enabled ? t("turnOff") : t("turnOn")}</Button>
        </div>
      )}
      {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
    </div>
  );
}

export function EndSessionButton({ id }: { id: string }) {
  const t = useTranslations("security");
  const router = useRouter();
  const [pending, start] = useTransition();
  return <Button size="sm" variant="ghost" disabled={pending} onClick={() => start(async () => { await endSessionAction({ id }); router.refresh(); })}>{t("end")}</Button>;
}

export function EndOthersButton({ disabled }: { disabled: boolean }) {
  const t = useTranslations("security");
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <span className="inline-flex max-w-full flex-wrap items-center gap-2">
      <Button variant="outline" className="h-auto min-h-9 max-w-full whitespace-normal text-left" disabled={disabled || pending} onClick={() => start(async () => { const r = await endOtherSessionsAction({}); if (r.ok) setMsg(t("ended", { count: r.data })); router.refresh(); })}>{t("endOthers")}</Button>
      {msg && <span className="text-sm text-success">{msg}</span>}
    </span>
  );
}
