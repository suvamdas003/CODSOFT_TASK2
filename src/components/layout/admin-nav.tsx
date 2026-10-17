"use client";

import {
  BarChart3,
  CalendarDays,
  ClipboardList,
  FolderTree,
  LayoutDashboard,
  ScrollText,
  Settings,
  Tag,
  Users,
  UtensilsCrossed,
  Armchair,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const LINKS = [
  { href: "/admin", label: "Dashboard", icon: LayoutDashboard },
  { href: "/admin/orders", label: "Orders", icon: ClipboardList },
  { href: "/admin/menu", label: "Menu items", icon: UtensilsCrossed },
  { href: "/admin/categories", label: "Categories", icon: FolderTree },
  { href: "/admin/reservations", label: "Reservations", icon: CalendarDays },
  { href: "/admin/tables", label: "Tables", icon: Armchair },
  { href: "/admin/staff", label: "Staff & users", icon: Users },
  { href: "/admin/discounts", label: "Discounts", icon: Tag },
  { href: "/admin/reports", label: "Reports", icon: BarChart3 },
  { href: "/admin/settings", label: "Settings", icon: Settings },
  { href: "/admin/audit", label: "Audit log", icon: ScrollText },
];

export function AdminNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Admin" className="no-print border-b border-stone-200 bg-white md:w-56 md:shrink-0 md:border-r md:border-b-0">
      <ul className="flex gap-1 overflow-x-auto p-2 md:sticky md:top-14 md:flex-col md:p-3">
        {LINKS.map(({ href, label, icon: Icon }) => {
          const active = href === "/admin" ? pathname === "/admin" : pathname === href || pathname.startsWith(`${href}/`);
          return (
            <li key={href}>
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium whitespace-nowrap",
                  active ? "bg-brand-50 text-brand-800" : "text-stone-700 hover:bg-stone-100",
                )}
              >
                <Icon className="h-4 w-4" aria-hidden />
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
