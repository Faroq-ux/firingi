export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-dvh place-items-center bg-gradient-to-br from-sidebar to-[oklch(0.3_0.08_255)] p-4">
      <div className="w-full max-w-md">
        <div className="mb-6 flex items-center justify-center gap-2 text-white">
          <div className="grid size-10 place-items-center rounded-lg bg-sidebar-active text-lg font-bold">F</div>
          <span className="text-2xl font-semibold tracking-wide">FIRINGI</span>
        </div>
        {children}
      </div>
    </div>
  );
}
