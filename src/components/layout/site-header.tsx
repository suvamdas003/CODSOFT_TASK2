import { ChefHat } from "lucide-react";
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { CartLink, MobileNav, NavLinks, SignOutButton, type NavLink } from "@/components/layout/header-client";
import { getCurrentUser } from "@/lib/auth/session";
import { getSettings } from "@/server/repositories/settings-repository";

export async function SiteHeader() {
  const [user, settings] = await Promise.all([getCurrentUser(), getSettings()]);
  const links: NavLink[] = [
    { href: "/menu", label: "Menu" },
    { href: "/reservations", label: "Reservations" },
  ];
  if (user) links.push({ href: "/orders", label: "My orders" });
  if (user && (user.role === "KITCHEN_STAFF" || user.role === "ADMIN")) links.push({ href: "/kitchen", label: "Kitchen" });
  if (user?.role === "ADMIN") links.push({ href: "/admin", label: "Admin" });

  return (
    <header className="no-print sticky top-0 z-30 border-b border-stone-200 bg-white/95 backdrop-blur">
      <div className="relative mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
        <Link href="/" className="font-display flex items-center gap-2 text-lg font-semibold text-stone-900">
          <span className="bg-brand-600 inline-flex h-8 w-8 items-center justify-center rounded-lg text-white">
            <ChefHat className="h-5 w-5" aria-hidden />
          </span>
          <span className="truncate">{settings.name}</span>
        </Link>
        <nav aria-label="Main" className="hidden items-center gap-1 md:flex">
          <NavLinks links={links} />
        </nav>
        <div className="flex items-center gap-1">
          <CartLink />
          <div className="hidden items-center gap-1 md:flex">
            {user ? (
              <>
                <span className="max-w-40 truncate px-2 text-sm text-stone-500" title={user.email}>
                  {user.name}
                </span>
                <SignOutButton />
              </>
            ) : (
              <>
                <Link href="/login" className={buttonVariants({ variant: "ghost", size: "sm" })}>
                  Sign in
                </Link>
                <Link href="/register" className={buttonVariants({ size: "sm" })}>
                  Create account
                </Link>
              </>
            )}
          </div>
          <MobileNav links={links} signedIn={Boolean(user)} />
        </div>
      </div>
    </header>
  );
}

export async function SiteFooter() {
  const settings = await getSettings();
  return (
    <footer className="no-print mt-16 border-t border-stone-200 bg-white">
      <div className="mx-auto flex max-w-6xl flex-col gap-2 px-4 py-8 text-sm text-stone-500 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <p>
          <span className="font-medium text-stone-700">{settings.name}</span>
          {settings.address ? ` · ${settings.address}` : null}
          {settings.phone ? ` · ${settings.phone}` : null}
        </p>
        <p>Powered by DineDesk</p>
      </div>
    </footer>
  );
}
