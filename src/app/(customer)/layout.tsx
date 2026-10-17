import type { ReactNode } from "react";
import { SiteFooter, SiteHeader } from "@/components/layout/site-header";

export default function CustomerLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <SiteHeader />
      <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6">
        {children}
      </main>
      <SiteFooter />
    </>
  );
}
