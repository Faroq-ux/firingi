import { BRAND_SLOGAN } from "@/config/brand";
import { PublicThemeToggle } from "@/components/theme/public-theme-toggle";

/** Sign-in, registration, payment links: deep night sky with a moving aurora and a crisp glass card. */
export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="public-shell motion-aurora relative grid min-h-dvh place-items-center overflow-hidden bg-[radial-gradient(80rem_50rem_at_10%_-10%,oklch(0.36_0.16_290),transparent_60%),radial-gradient(70rem_50rem_at_110%_110%,oklch(0.38_0.14_220),transparent_55%),linear-gradient(160deg,oklch(0.16_0.04_265),oklch(0.12_0.03_262))] p-4">
      <span className="aurora-blob a" aria-hidden /><span className="aurora-blob b" aria-hidden /><span className="aurora-blob c" aria-hidden />
      <span aria-hidden className="pointer-events-none absolute inset-0 opacity-[0.07] [background-image:linear-gradient(white_1px,transparent_1px),linear-gradient(90deg,white_1px,transparent_1px)] [background-size:48px_48px] [mask-image:radial-gradient(ellipse_at_center,black,transparent_75%)]" />
      <PublicThemeToggle className="absolute right-3 top-3 z-10 text-white" />
      <div className="animate-page relative z-10 w-full max-w-md">
        <div className="mb-7 flex flex-col items-center gap-2 text-white">
          <div className="flex items-center gap-3">
            <div className="grid size-12 place-items-center rounded-2xl bg-[linear-gradient(135deg,var(--vivid-blue),var(--vivid-violet))] text-xl font-bold shadow-[0_0_40px_-6px_var(--vivid-violet)]">F</div>
            <span className="text-3xl font-bold tracking-[0.14em]">FIRINGI</span>
          </div>
          <span className="text-[11px] font-medium tracking-[0.3em] text-white/70">{BRAND_SLOGAN}</span>
        </div>
        {children}
      </div>
    </div>
  );
}
