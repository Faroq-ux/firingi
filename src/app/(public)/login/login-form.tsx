"use client";
import { useRouter, useSearchParams } from "next/navigation";
import { useState, useTransition } from "react";
import { authClient } from "@/lib/auth-client";
import { afterLoginAction } from "@/server/actions/session";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";

type Labels = {
  email: string; password: string; submit: string; submitting: string; invalid: string; tooMany: string;
  codeTitle: string; codeHint: string; backupHint: string; code: string; verify: string; useBackup: string; useApp: string; badCode: string;
};

export function LoginForm({ labels }: { labels: Labels }) {
  const router = useRouter();
  const next = useSearchParams().get("next");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [step, setStep] = useState<"password" | "totp" | "backup">("password");

  const finish = async () => {
    const { redirectTo } = await afterLoginAction();
    // Only follow same-site relative "next" paths (no open redirects).
    router.push(next && next.startsWith("/") && !next.startsWith("//") ? next : redirectTo);
    router.refresh();
  };

  if (step !== "password")
    return (
      <form
        className="space-y-4"
        data-testid="two-factor-step"
        onSubmit={(e) => {
          e.preventDefault();
          const code = String(new FormData(e.currentTarget).get("code") ?? "").trim();
          setError(null);
          start(async () => {
            const r = step === "totp" ? await authClient.twoFactor.verifyTotp({ code }) : await authClient.twoFactor.verifyBackupCode({ code });
            if (r.error) return setError(r.error.status === 429 ? labels.tooMany : labels.badCode);
            await finish();
          });
        }}
      >
        <div>
          <h2 className="font-semibold">{labels.codeTitle}</h2>
          <p className="text-sm text-muted-foreground">{step === "totp" ? labels.codeHint : labels.backupHint}</p>
        </div>
        {error && <p role="alert" className="rounded-md bg-destructive/10 p-2 text-sm text-destructive">{error}</p>}
        <div className="space-y-1.5">
          <Label htmlFor="code">{labels.code}</Label>
          <Input id="code" name="code" inputMode={step === "totp" ? "numeric" : "text"} autoComplete="one-time-code" required autoFocus />
        </div>
        <Button type="submit" className="w-full" disabled={pending}>{pending ? labels.submitting : labels.verify}</Button>
        <button type="button" className="w-full text-center text-sm text-primary hover:underline" onClick={() => { setError(null); setStep(step === "totp" ? "backup" : "totp"); }}>
          {step === "totp" ? labels.useBackup : labels.useApp}
        </button>
      </form>
    );

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        setError(null);
        start(async () => {
          const { data, error } = await authClient.signIn.email({ email: String(fd.get("email")), password: String(fd.get("password")) });
          if (error) return setError(error.status === 429 ? labels.tooMany : labels.invalid);
          if ((data as { twoFactorRedirect?: boolean } | null)?.twoFactorRedirect) return setStep("totp");
          await finish();
        });
      }}
    >
      {error && <p role="alert" className="rounded-md bg-destructive/10 p-2 text-sm text-destructive">{error}</p>}
      <div className="space-y-1.5">
        <Label htmlFor="email">{labels.email}</Label>
        <Input id="email" name="email" type="email" autoComplete="email" required autoFocus />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="password">{labels.password}</Label>
        <Input id="password" name="password" type="password" autoComplete="current-password" required />
      </div>
      <Button type="submit" className="w-full" disabled={pending}>{pending ? labels.submitting : labels.submit}</Button>
    </form>
  );
}
