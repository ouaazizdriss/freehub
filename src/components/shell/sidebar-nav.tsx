"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Role } from "@/generated/prisma/enums";
import { NAV, ROUTES, type RouteKey } from "@/lib/navigation";

type Props = { role: Role; badges: Partial<Record<RouteKey, number>> };

export function SidebarNav({ role, badges }: Props) {
  const pathname = usePathname();

  return (
    <nav aria-label="Navigation principale">
      <ul className="flex flex-col gap-1">
        {NAV[role].map(({ route, label }) => {
          const { href, icon: Icon } = ROUTES[route];
          const active = pathname === href || pathname.startsWith(`${href}/`);
          const badge = badges[route];
          return (
            <li key={route}>
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={`flex items-center gap-2.5 rounded-control px-[11px] py-2.5 text-[13px] transition-colors duration-150 ${
                  active ? "bg-purple font-semibold text-white" : "font-medium text-ink-3 hover:bg-lavender-light"
                }`}
              >
                <Icon aria-hidden size={18} strokeWidth={1.75} />
                <span className="flex-1">{label}</span>
                {badge ? (
                  <span
                    className={`rounded-pill px-1.5 py-0.5 text-[11px] font-bold ${active ? "bg-white text-purple" : "bg-pink-ink text-white"}`}
                  >
                    {badge}
                    <span className="sr-only"> en attente</span>
                  </span>
                ) : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
