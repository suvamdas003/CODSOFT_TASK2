import { ChefHat } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main id="main" className="to-brand-50 flex flex-1 items-center justify-center bg-gradient-to-br from-stone-100 px-4 py-12">
      <div className="w-full max-w-md">
        <Link href="/" className="font-display mb-6 flex items-center justify-center gap-2 text-xl font-semibold text-stone-900">
          <span className="bg-brand-600 inline-flex h-9 w-9 items-center justify-center rounded-lg text-white">
            <ChefHat className="h-5 w-5" aria-hidden />
          </span>
          DineDesk
        </Link>
        {children}
      </div>
    </main>
  );
}
