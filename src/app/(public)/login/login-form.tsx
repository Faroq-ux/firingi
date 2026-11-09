"use client";
import { useRouter, useSearchParams } from "next/navigation";
import { useState, useTransition } from "react";
import { authClient } from "@/lib/auth-client";
import { afterLoginAction } from "@/server/actions/session";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";

export function LoginForm({ labels }: { labels: { email: string; password: string; submit: string; submitting: string; invalid: string; tooMany: string } }) {
  const router = useRouter();
  const next = useSearchParams().get("next");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        setError(null);
        start(async () => {
          const { error } = await authClient.signIn.email({ email: String(fd.get("email")), password: String(fd.get("password")) });
          if (error) return setError(error.status === 429 ? labels.tooMany : labels.invalid);
          const { redirectTo } = await afterLoginAction();
          // Only follow same-site relative "next" paths (no open redirects).
          router.push(next && next.startsWith("/") && !next.startsWith("//") ? next : redirectTo);
          router.refresh();
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
