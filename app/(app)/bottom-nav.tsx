"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  {
    href: "/",
    label: "Voorraad",
    icon: (
      <>
        <rect x="3.5" y="3" width="17" height="18" rx="2.5" />
        <path d="M3.5 9.5h17M3.5 15h17M9 6.5h6" />
      </>
    ),
  },
  {
    href: "/bijbestellen",
    label: "Bijbestellen",
    icon: <path d="M8 6h12M8 12h12M8 18h12M3.5 6h.01M3.5 12h.01M3.5 18h.01" />,
  },
  {
    href: "/weekmenu",
    label: "Weekmenu",
    icon: (
      <>
        <rect x="3" y="4.5" width="18" height="16" rx="3" />
        <path d="M3 9.5h18M8 2.5v4M16 2.5v4" />
      </>
    ),
  },
  {
    href: "/huis",
    label: "Huis",
    icon: <path d="M3.5 10.5 12 3.5l8.5 7V20a1 1 0 0 1-1 1h-5v-6h-5v6h-5a1 1 0 0 1-1-1z" />,
  },
];

export function BottomNav() {
  const pathname = usePathname();

  return (
    <nav className="bottom-nav" aria-label="Hoofdmenu">
      {TABS.map((tab) => {
        const active =
          tab.href === "/"
            ? pathname === "/" || pathname.startsWith("/picnic")
            : pathname.startsWith(tab.href);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className="bottom-nav-link"
            aria-current={active ? "page" : undefined}
          >
            <svg
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              {tab.icon}
            </svg>
            <span>{tab.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
