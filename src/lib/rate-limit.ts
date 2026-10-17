import { rateLimitingDisabled } from "@/lib/env";
import { RateLimitError } from "@/lib/errors";

/**
 * Fixed-window, in-memory rate limiter for sensitive application actions
 * (checkout, reservations, payment initiation). Login and sign-up are rate
 * limited separately by Better Auth with database-backed storage.
 *
 * NOTE: memory storage is per server process. For multi-instance deployments,
 * replace the store with a shared one (e.g. Redis) — see docs/SECURITY.md.
 */
type Bucket = { count: number; resetAt: number };

const store = new Map<string, Bucket>();
const MAX_KEYS = 10_000;

export type RateLimitRule = { limit: number; windowMs: number };

export function consumeRateLimit(key: string, rule: RateLimitRule, now = Date.now()) {
  const bucket = store.get(key);
  if (!bucket || bucket.resetAt <= now) {
    if (store.size >= MAX_KEYS) pruneExpired(now);
    store.set(key, { count: 1, resetAt: now + rule.windowMs });
    return { allowed: true, remaining: rule.limit - 1, resetAt: now + rule.windowMs };
  }
  if (bucket.count >= rule.limit) {
    return { allowed: false, remaining: 0, resetAt: bucket.resetAt };
  }
  bucket.count += 1;
  return { allowed: true, remaining: rule.limit - bucket.count, resetAt: bucket.resetAt };
}

/** Throws RateLimitError when the limit is exceeded. */
export function enforceRateLimit(key: string, rule: RateLimitRule) {
  if (rateLimitingDisabled("app")) return;
  const result = consumeRateLimit(key, rule);
  if (!result.allowed) throw new RateLimitError();
}

function pruneExpired(now: number) {
  for (const [key, bucket] of store) {
    if (bucket.resetAt <= now) store.delete(key);
  }
}

export function resetRateLimits() {
  store.clear();
}

export const RATE_LIMITS = {
  placeOrder: { limit: 10, windowMs: 60_000 },
  reservation: { limit: 10, windowMs: 60_000 },
  payment: { limit: 10, windowMs: 60_000 },
  availability: { limit: 60, windowMs: 60_000 },
  quote: { limit: 60, windowMs: 60_000 },
} satisfies Record<string, RateLimitRule>;
