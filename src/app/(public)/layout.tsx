import { BRAND_SLOGAN } from "@/config/brand";
import { PublicThemeToggle } from "@/components/theme/public-theme-toggle";

export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative grid min-h-dvh place-items-center bg-gradient-to-br from-sidebar to-[oklch(0.3_0.08_255)] p-4">
      <PublicThemeToggle className="absolute right-3 top-3 text-white" />
      <div className="animate-page w-full max-w-md">
        <div className="mb-6 flex flex-col items-center gap-1 text-white">
          <div className="flex items-center gap-2">
            <div className="grid size-10 place-items-center rounded-lg bg-sidebar-active text-lg font-bold">F</div>
            <span className="text-2xl font-semibold tracking-wide">FIRINGI</span>
          </div>
          <span className="text-[11px] font-medium tracking-[0.25em] text-white/70">{BRAND_SLOGAN}</span>
        </div>
        {children}
      </div>
    </div>
  );
}
