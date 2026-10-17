import { NextResponse } from "next/server";
import { isAppError } from "@/lib/errors";
import { logger } from "@/lib/logger";

const NO_STORE = { "Cache-Control": "no-store" };

export function jsonOk<T>(data: T, init?: ResponseInit) {
  return NextResponse.json(data, { ...init, headers: { ...NO_STORE, ...init?.headers } });
}

/** Maps errors to safe JSON responses; unexpected errors are logged, never echoed. */
export function jsonError(error: unknown, context?: Record<string, unknown>) {
  if (isAppError(error)) {
    return NextResponse.json({ error: error.message, code: error.code }, { status: error.status, headers: NO_STORE });
  }
  logger.error("Unhandled API error", { ...context, error });
  return NextResponse.json({ error: "Internal server error" }, { status: 500, headers: NO_STORE });
}
