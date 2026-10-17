import { getSessionCookie } from "better-auth/cookies";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Optimistic redirect for signed-out visitors on protected pages. This only
 * checks that a session cookie exists; real authentication and role checks
 * happen on the server in every page, server action and route handler.
 */
export function proxy(request: NextRequest) {
  if (!getSessionCookie(request)) {
    const url = new URL("/login", request.url);
    url.searchParams.set("next", `${request.nextUrl.pathname}${request.nextUrl.search}`);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/orders/:path*", "/reservations/:path+", "/kitchen/:path*", "/admin/:path*"],
};
