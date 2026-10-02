import { identifier } from "@/lib/time";

export const SESSION_COOKIE = "bean-counter-session";
export const OAUTH_STATE_COOKIE = "bean-counter-oauth-state";

export function resolveApplicationUrl(configuredUrl: string | undefined, requestUrl: string): string {
  return (configuredUrl ? new URL(configuredUrl) : new URL(requestUrl)).origin;
}

export function isAllowedEmail(email: string, allowedEmails: string | undefined): boolean {
  const allowed = (allowedEmails ?? "arief0303@gmail.com")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  return allowed.includes(email.trim().toLowerCase());
}

export function createOAuthState(): string {
  return identifier();
}
