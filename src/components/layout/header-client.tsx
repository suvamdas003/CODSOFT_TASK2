"use client";

import { LogOut, Menu as MenuIcon, ShoppingBag, X } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { useCartCount } from "@/features/cart/cart-store";
import { authClient } from "@/lib/auth/auth-client";
import { cn } from "@/lib/utils";

export function CartLink() {
  const count = useCartCount();
  return (
    <Link
      href="/cart"
      className="relative inline-flex h-10 items-center gap-2 rounded-lg px-3 text-sm font-medium text-stone-700 hover:bg-stone-100"
      aria-label={count ? `Cart, ${count} item${count === 1 ? "" : "s"}` : "Cart, empty"}
    >
      <ShoppingBag className="h-5 w-5" aria-hidden />
      <span className="hidden sm:inline">Cart</span>
      {count > 0 ? (
        <span className="bg-brand-600 absolute -top-0.5 -right-0.5 inline-flex min-w-5 items-center justify-center rounded-full px-1 text-xs font-semibold text-white">
          {count}
        </span>
      ) : null}
    </Link>
  );
}

export function SignOutButton({ className }: { className?: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  return (
    <button
      type="button"
      disabled={pending}
      onClick={async () => {
        setPending(true);
        await authClient.signOut();
        router.push("/");
        router.refresh();
      }}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium text-stone-700 hover:bg-stone-100 disabled:opacity-50",
        className,
      )}
    >
      <LogOut className="h-4 w-4" aria-hidden />
      {pending ? "Signing out…" : "Sign out"}
    </button>
  );
}

export type NavLink = { href: string; label: string };

export function NavLinks({ links }: { links: NavLink[] }) {
  const pathname = usePathname();
  return (
    <>
      {links.map((link) => {
        const active = pathname === link.href || (link.href !== "/" && pathname.startsWith(`${link.href}/`));
        return (
          <Link
            key={link.href}
            href={link.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "rounded-lg px-3 py-2 text-sm font-medium transition-colors",
              active ? "bg-brand-50 text-brand-800" : "text-stone-700 hover:bg-stone-100",
            )}
          >
            {link.label}
          </Link>
        );
      })}
    </>
  );
}

export function MobileNav({ links, signedIn }: { links: NavLink[]; signedIn: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="md:hidden">
      <button
        type="button"
        className="inline-flex h-10 w-10 items-center justify-center rounded-lg text-stone-700 hover:bg-stone-100"
        aria-expanded={open}
        aria-controls="mobile-nav"
        aria-label={open ? "Close menu" : "Open menu"}
        onClick={() => setOpen((value) => !value)}
      >
        {open ? <X className="h-5 w-5" aria-hidden /> : <MenuIcon className="h-5 w-5" aria-hidden />}
      </button>
      {open ? (
        <nav
          id="mobile-nav"
          className="absolute inset-x-0 top-16 z-40 border-b border-stone-200 bg-white px-4 py-3 shadow-md"
          onClick={() => setOpen(false)}
        >
          <div className="flex flex-col gap-1">
            <NavLinks links={links} />
            {signedIn ? (
              <SignOutButton className="justify-start" />
            ) : (
              <>
                <Link href="/login" className="rounded-lg px-3 py-2 text-sm font-medium text-stone-700 hover:bg-stone-100">
                  Sign in
                </Link>
                <Link href="/register" className="rounded-lg px-3 py-2 text-sm font-medium text-stone-700 hover:bg-stone-100">
                  Create account
                </Link>
              </>
            )}
          </div>
        </nav>
      ) : null}
    </div>
  );
}
