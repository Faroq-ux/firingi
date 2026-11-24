import { BRAND_SLOGAN } from "@/config/brand";
import { PublicThemeToggle } from "@/components/theme/public-theme-toggle";
import { Wordmark } from "@/components/brand/wordmark";

export default function OnboardingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh bg-background">
      <header className="border-b bg-sidebar text-white">
        <div className="mx-auto flex h-14 max-w-5xl items-center gap-2 px-4">
          <Wordmark className="text-[26px]" />
          <span className="hidden text-[10px] tracking-[0.2em] text-white/60 sm:inline">{BRAND_SLOGAN}</span>
          <PublicThemeToggle className="ml-auto" />
        </div>
      </header>
      <main className="animate-page mx-auto max-w-5xl p-4 md:p-6">{children}</main>
    </div>
  );
}
