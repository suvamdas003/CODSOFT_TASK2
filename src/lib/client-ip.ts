/**
 * Client IP for rate limiting.
 *
 * Trust model: in production DineDesk must run behind a reverse proxy that
 * sets X-Forwarded-For itself (the bundled nginx overwrites it with the real
 * client address). Next.js passes a client-supplied header through unchanged,
 * so only the right-most entry — the one added by the proxy nearest to us — is
 * used; earlier entries can be forged by the client.
 */
export function clientIpFromHeaders(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) {
    const entries = forwarded
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean);
    const nearest = entries.at(-1);
    if (nearest) return nearest.slice(0, 64);
  }
  const realIp = headers.get("x-real-ip")?.trim();
  return realIp ? realIp.slice(0, 64) : "unknown";
}

/** Optional CIDRs of additional trusted proxies (e.g. a load balancer in front of nginx). */
export function trustedProxyCidrs(value = process.env.TRUSTED_PROXY_CIDRS): string[] {
  return (value ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}
