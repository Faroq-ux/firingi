import Link from "next/link";

const TABS = [
  { href: "/admin/marketing/loyalty", label: "Overview & rules" },
  { href: "/admin/marketing/loyalty/campaigns", label: "Bonus campaigns" },
  { href: "/admin/marketing/loyalty/members", label: "Members" },
];

/** Sub-pages of Marketing › Loyalty & Rewards. */
export function LoyaltyTabs({ active }: { active: string }) {
  return (
    <nav className="mb-4 flex flex-wrap gap-2" aria-label="Loyalty">
      {TABS.map((t) => (
        <Link key={t.href} href={t.href} aria-current={t.href === active ? "page" : undefined}
          className={`rounded-full border px-3 py-1.5 text-sm transition ${t.href === active ? "border-transparent bg-[linear-gradient(90deg,var(--vivid-blue),var(--vivid-violet))] text-white shadow-sm" : "bg-card hover:border-[var(--vivid-violet)]"}`}>{t.label}</Link>
      ))}
    </nav>
  );
}
