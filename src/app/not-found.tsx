import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";

export default function NotFound() {
  return (
    <main id="main" className="flex flex-1 flex-col items-center justify-center px-4 py-24 text-center">
      <p className="text-brand-700 text-sm font-semibold tracking-widest uppercase">404</p>
      <h1 className="font-display mt-2 text-3xl font-semibold text-stone-900">Page not found</h1>
      <p className="mt-2 max-w-md text-stone-600">The page you are looking for doesn&apos;t exist, or you don&apos;t have access to it.</p>
      <Link href="/" className={buttonVariants({ className: "mt-6" })}>
        Back to DineDesk
      </Link>
    </main>
  );
}
