import { describe, expect, it } from "vitest";
import { clientIpFromHeaders, trustedProxyCidrs } from "@/lib/client-ip";
import { rateLimitingDisabled, shouldUseSecureCookies, validateServerEnv } from "@/lib/env";

describe("client IP resolution (regression: spoofable X-Forwarded-For)", () => {
  it("uses the right-most X-Forwarded-For entry added by the nearest proxy", () => {
    expect(clientIpFromHeaders(new Headers({ "x-forwarded-for": "203.0.113.9" }))).toBe("203.0.113.9");
    // A client can prepend anything; only the proxy-appended last hop is trusted.
    expect(clientIpFromHeaders(new Headers({ "x-forwarded-for": "1.2.3.4, 5.6.7.8, 198.51.100.7" }))).toBe("198.51.100.7");
  });

  it("falls back to X-Real-IP and finally to a shared 'unknown' bucket", () => {
    expect(clientIpFromHeaders(new Headers({ "x-real-ip": "192.0.2.1" }))).toBe("192.0.2.1");
    expect(clientIpFromHeaders(new Headers())).toBe("unknown");
  });

  it("parses optional trusted proxy CIDRs", () => {
    expect(trustedProxyCidrs("10.0.0.0/8, 172.16.0.0/12,")).toEqual(["10.0.0.0/8", "172.16.0.0/12"]);
    expect(trustedProxyCidrs(undefined)).toEqual([]);
  });
});

const goodSecret = "Vb7pQ2xT9mK4sL8nR3wY6zA1cE5gH0jU2iO7fD9";
const base = { DATABASE_URL: "postgresql://x", BETTER_AUTH_SECRET: goodSecret, BETTER_AUTH_URL: "https://dinedesk.example.com" };

describe("startup configuration validation (regression: unsafe defaults)", () => {
  it("accepts a sound production configuration", () => {
    expect(validateServerEnv({ ...base, NODE_ENV: "production" })).toEqual([]);
    expect(validateServerEnv({ ...base, NODE_ENV: "production", BETTER_AUTH_URL: "http://localhost:8080" })).toEqual([]);
  });

  it("rejects missing, short and placeholder secrets", () => {
    expect(validateServerEnv({ ...base, BETTER_AUTH_SECRET: "" })).toContainEqual(expect.stringMatching(/not set/));
    expect(validateServerEnv({ ...base, BETTER_AUTH_SECRET: "short" })).toContainEqual(expect.stringMatching(/at least 32/));
    expect(validateServerEnv({ ...base, BETTER_AUTH_SECRET: "replace-with-a-long-random-secret-at-least-32-chars" })).toContainEqual(
      expect.stringMatching(/placeholder/),
    );
  });

  it("requires HTTPS for non-local production URLs and both Stripe secrets together", () => {
    expect(validateServerEnv({ ...base, NODE_ENV: "production", BETTER_AUTH_URL: "http://192.168.1.20:8080" })).toContainEqual(
      expect.stringMatching(/https/),
    );
    expect(validateServerEnv({ ...base, BETTER_AUTH_URL: "not a url" })).toContainEqual(expect.stringMatching(/valid URL/));
    expect(validateServerEnv({ ...base, STRIPE_SECRET_KEY: "sk_test_x" })).toContainEqual(expect.stringMatching(/both/));
  });

  it("refuses rate-limit kill switches in production", () => {
    expect(validateServerEnv({ ...base, NODE_ENV: "production", AUTH_RATE_LIMIT_ENABLED: "false" })).toContainEqual(
      expect.stringMatching(/Rate limiting cannot be disabled/),
    );
    expect(rateLimitingDisabled("auth", { NODE_ENV: "production", AUTH_RATE_LIMIT_ENABLED: "false" })).toBe(false);
    expect(rateLimitingDisabled("app", { NODE_ENV: "production", APP_RATE_LIMIT_DISABLED: "true" })).toBe(false);
    expect(rateLimitingDisabled("auth", { NODE_ENV: "development", AUTH_RATE_LIMIT_ENABLED: "false" })).toBe(true);
    expect(rateLimitingDisabled("app", { NODE_ENV: "development" })).toBe(false);
  });

  it("marks session cookies Secure exactly when the public URL is HTTPS", () => {
    expect(shouldUseSecureCookies("https://dinedesk.example.com")).toBe(true);
    expect(shouldUseSecureCookies("http://localhost:8080")).toBe(false);
    expect(shouldUseSecureCookies(undefined)).toBe(false);
  });
});
