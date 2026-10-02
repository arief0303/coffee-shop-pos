import { describe, expect, it } from "vitest";
import { createOAuthState, isAllowedEmail, resolveApplicationUrl } from "@/lib/auth-config";

describe("OAuth configuration", () => {
  it("uses the request origin when no canonical URL is configured", () => {
    expect(resolveApplicationUrl(undefined, "http://100.99.170.84:10020/inventory")).toBe(
      "http://100.99.170.84:10020",
    );
  });

  it("uses the configured canonical URL for OAuth callback construction", () => {
    expect(resolveApplicationUrl("https://coffee-shop-pos.vercel.app", "http://localhost:10020")).toBe(
      "https://coffee-shop-pos.vercel.app",
    );
  });

  it("only authorizes the configured Google account", () => {
    expect(isAllowedEmail("arief0303@gmail.com", "arief0303@gmail.com")).toBe(true);
    expect(isAllowedEmail("someone@example.com", "arief0303@gmail.com")).toBe(false);
  });

  it("generates state values that can be stored in a cookie", () => {
    expect(createOAuthState()).toMatch(/^[a-z0-9-]+$/);
  });
});
