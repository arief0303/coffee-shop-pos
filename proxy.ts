import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";
import { isAuthRequired, SESSION_COOKIE } from "@/lib/auth-config";

function sessionKey(): Uint8Array | null {
  const secret = process.env.AUTH_SECRET;
  return secret ? new TextEncoder().encode(secret) : null;
}

async function hasValidSession(token: string | undefined): Promise<boolean> {
  const key = sessionKey();
  if (!token || !key) return false;
  try {
    await jwtVerify(token, key, { algorithms: ["HS256"] });
    return true;
  } catch {
    return false;
  }
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Optional sign-in: with AUTH_REQUIRED=false the POS is open and /login has nothing to do.
  if (!isAuthRequired(process.env.AUTH_REQUIRED) && pathname !== "/login" && !pathname.startsWith("/api/auth/")) {
    return NextResponse.next();
  }

  // The backup route authenticates itself (session or CRON_SECRET bearer) so schedulers can call it.
  if (pathname === "/api/backup") return NextResponse.next();

  if (pathname === "/login" || pathname.startsWith("/api/auth/")) {
    if (pathname === "/login" && await hasValidSession(request.cookies.get(SESSION_COOKIE)?.value)) {
      return NextResponse.redirect(new URL("/", request.url));
    }
    return NextResponse.next();
  }

  if (await hasValidSession(request.cookies.get(SESSION_COOKIE)?.value)) return NextResponse.next();

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }
  return NextResponse.redirect(new URL("/login", request.url));
}

export const config = {
  matcher: ["/", "/inventory/:path*", "/api/:path*", "/login"],
};
