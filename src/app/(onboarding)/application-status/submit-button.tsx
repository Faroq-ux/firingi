"use client";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { submitApplicationAction } from "@/server/actions/onboarding";

export function SubmitApplicationButton({ disabled }: { disabled: boolean }) {
  const t = useTranslations("onboarding.hub");
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="space-y-2">
      <Button size="lg" disabled={disabled || pending} onClick={() => start(async () => {
        const r = await submitApplicationAction({});
        if (r.ok) router.refresh(); else setError(r.error);
      })}>
        <Send /> {pending ? t("submitting") : t("submit")}
      </Button>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
