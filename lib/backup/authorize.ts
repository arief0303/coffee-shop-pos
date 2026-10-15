import { timingSafeEqual } from "node:crypto";

/** True when the Authorization header carries the configured CRON_SECRET (used by schedulers and curl). */
export function hasValidBearer(header: string | null, secret: string | undefined): boolean {
  if (!secret || !header?.startsWith("Bearer ")) return false;
  const given = Buffer.from(header.slice("Bearer ".length));
  const expected = Buffer.from(secret);
  return given.length === expected.length && timingSafeEqual(given, expected);
}
