/** Phase 56: the landing page's line icons (FIRINGI's own set). */
const ICONS = {
  check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  plus: <path d="M12 5v14M5 12h14" />,
  menu: <path d="M4 7h16M4 12h16M4 17h16" />,
  close: <path d="M6 6l12 12M18 6 6 18" />,
  sliders: <path d="M4 7h10M18 7h2M4 17h2M10 17h10M14 4v6M6 14v6" />,
  queue: <path d="M4 6h16M4 12h16M4 18h10" />,
  truck: <><path d="M2.5 6h11v10h-11zM13.5 9.5H18l3 3.5v3h-7.5" /><circle cx="7" cy="17.5" r="1.8" /><circle cx="17" cy="17.5" r="1.8" /></>,
  wallet: <path d="M3 7h16a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7zm0 0 2-3h11M16.5 14h.01" />,
  card: <path d="M3 6h18v12H3zM3 10h18M7 15h4" />,
  phone: <path d="M8 3h8v18H8zM11 18h2" />,
  bank: <path d="M3 9l9-5 9 5M5 9v9M9.5 9v9M14.5 9v9M19 9v9M3 20h18" />,
  receipt: <path d="M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6" />,
  repeat: <path d="M4 11V9a3 3 0 0 1 3-3h12M16 3l3 3-3 3M20 13v2a3 3 0 0 1-3 3H5M8 21l-3-3 3-3" />,
  calendar: <path d="M4 6h16v14H4zM4 10h16M8 3v4M16 3v4" />,
  users: <><circle cx="9" cy="8" r="3.2" /><path d="M3 20c.6-3.4 3-5 6-5s5.4 1.6 6 5M16 5.5a3 3 0 0 1 0 5.5M18 15.5c1.7.6 2.6 2 3 4.5" /></>,
  pin: <path d="M12 21s7-6 7-11a7 7 0 1 0-14 0c0 5 7 11 7 11zM12 12.5h.01" />,
  list: <path d="M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01" />,
  file: <path d="M6 3h8l4 4v14H6zM14 3v4h4M9 12h6M9 16h6" />,
  shield: <path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z" />,
  download: <path d="M12 4v11M7 11l5 5 5-5M5 20h14" />,
  credit: <path d="M5 4h14v16l-3-2-2 2-2-2-2 2-2-2-3 2zM9 9h6M9 13h6" />,
  clock: <path d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2" />,
  camera: <path d="M4 8h3l2-3h6l2 3h3v11H4zM12 16.5a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4z" />,
  swap: <path d="M4 8h13M14 4l4 4-4 4M20 16H7M10 12l-4 4 4 4" />,
  tag: <path d="M3 12V4h8l10 10-8 8L3 12zM7.5 8.5h.01" />,
  bell: <path d="M6 16V11a6 6 0 1 1 12 0v5l2 2H4zM10 21h4" />,
  wa: <path d="M5 19l1.2-3.6A7.5 7.5 0 1 1 9 18.6zM9.5 9.2c.3 2.2 2.1 4 4.3 4.4l1-1.1 1.9.8-.3 1.6c-3.7.3-7.5-3.4-7.2-7.2l1.6-.3.8 1.9z" />,
  building: <path d="M4 21V4h11v17M15 9h5v12M8 8h3M8 12h3M8 16h3M3 21h18" />,
  mail: <path d="M3 6h18v12H3zM3 7l9 6 9-6" />,
  book: <path d="M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3zM5 17a3 3 0 0 1 3-3h11" />,
  instagram: <><rect x="4" y="4" width="16" height="16" rx="4.5" /><circle cx="12" cy="12" r="3.6" /><path d="M16.6 7.4h.01" /></>,
  facebook: <path d="M14 8h2.5V4.5H14a4 4 0 0 0-4 4V11H7.5v3.5H10V21h3.5v-6.5H16l.5-3.5h-3v-2a1 1 0 0 1 1-1z" />,
  linkedin: <path d="M5 9.5h3V19H5zM6.5 5.2a1.6 1.6 0 1 1 0 3.2 1.6 1.6 0 0 1 0-3.2zM10.5 9.5h2.9v1.4c.5-.9 1.6-1.6 3.1-1.6 2.8 0 3.5 1.8 3.5 4.3V19h-3v-4.8c0-1.2-.2-2.3-1.6-2.3s-1.9 1-1.9 2.3V19h-3z" />,
  youtube: <path d="M3.5 8.5c.2-1.6 1.2-2.5 2.8-2.6C8 5.8 10 5.7 12 5.7s4 .1 5.7.2c1.6.1 2.6 1 2.8 2.6.2 1.2.2 2.3.2 3.5s0 2.3-.2 3.5c-.2 1.6-1.2 2.5-2.8 2.6-1.7.1-3.7.2-5.7.2s-4-.1-5.7-.2c-1.6-.1-2.6-1-2.8-2.6-.2-1.2-.2-2.3-.2-3.5s0-2.3.2-3.5zM10.3 9.3v5.4l4.6-2.7z" />,
  tiktok: <path d="M14 4v10.5a3.5 3.5 0 1 1-3.5-3.5M14 4c.3 2.4 1.9 4 4.5 4.2" />,
  search: <path d="M10.5 17a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13zM15.5 15.5 20 20" />,
  cart: <path d="M3 4h2.5l2.2 10.5h10.6L20.5 7H6.4M9.5 19.5h.01M17 19.5h.01" />,
  chat: <path d="M5 18.5V6.5A1.5 1.5 0 0 1 6.5 5h11A1.5 1.5 0 0 1 19 6.5v8a1.5 1.5 0 0 1-1.5 1.5H8z" />,
  left: <path d="M15 5l-7 7 7 7" />,
  right: <path d="M9 5l7 7-7 7" />,
  pause: <path d="M9 5v14M15 5v14" />,
  play: <path d="M7 5v14l12-7z" />,
} as const;
export type IconName = keyof typeof ICONS;

export function Icon({ name, size = 24 }: { name: IconName; size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {ICONS[name]}
    </svg>
  );
}
