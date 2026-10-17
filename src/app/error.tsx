"use client";

import Link from "next/link";
import { Button, buttonVariants } from "@/components/ui/button";

/** Generic error boundary. Never shows error details (stack traces stay in server logs). */
export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main id="main" className="flex flex-1 flex-col items-center justify-center px-4 py-24 text-center">
      <h1 className="font-display text-3xl font-semibold text-stone-900">Something went wrong</h1>
      <p className="mt-2 max-w-md text-stone-600">An unexpected error occurred. Please try again.</p>
      {error.digest ? <p className="mt-1 text-xs text-stone-400">Reference: {error.digest}</p> : null}
      <div className="mt-6 flex gap-2">
        <Button onClick={reset}>Try again</Button>
        <Link href="/" className={buttonVariants({ variant: "outline" })}>
          Home
        </Link>
      </div>
    </main>
  );
}
