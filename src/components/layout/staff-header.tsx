import { ChefHat } from "lucide-react";
import Link from "next/link";
import { SignOutButton } from "@/components/layout/header-client";
import type { Actor } from "@/lib/auth/permissions";
import { humanize } from "@/lib/utils";

export function StaffHeader({ user, area }: { user: Actor; area: string }) {
  return (
    <header className="no-print sticky top-0 z-30 border-b border-stone-800 bg-stone-900 text-stone-100">
      <div className="flex h-14 items-center justify-between gap-4 px-4 sm:px-6">
        <div className="flex items-center gap-3">
          <Link href="/" className="font-display flex items-center gap-2 font-semibold">
            <span className="bg-brand-600 inline-flex h-7 w-7 items-center justify-center rounded-md">
              <ChefHat className="h-4 w-4" aria-hidden />
            </span>
            DineDesk
          </Link>
          <span className="rounded bg-stone-700 px-2 py-0.5 text-xs font-medium tracking-wide uppercase">{area}</span>
        </div>
        <nav aria-label="Staff" className="flex items-center gap-1 text-sm">
          <Link href="/kitchen" className="rounded-md px-2 py-1.5 hover:bg-stone-800">
            Kitchen
          </Link>
          {user.role === "ADMIN" ? (
            <Link href="/admin" className="rounded-md px-2 py-1.5 hover:bg-stone-800">
              Admin
            </Link>
          ) : null}
          <span className="hidden px-2 text-stone-400 sm:inline">
            {user.name} · {humanize(user.role)}
          </span>
          <SignOutButton className="text-stone-100 hover:bg-stone-800" />
        </nav>
      </div>
    </header>
  );
}
