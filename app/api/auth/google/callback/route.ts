import { NextRequest, NextResponse } from "next/server";
import { isAllowedEmail, OAUTH_STATE_COOKIE, resolveApplicationUrl, SESSION_COOKIE } from "@/lib/auth-config";
import { signSession } from "@/lib/session";

type TokenResponse = { access_token?: string };
type GoogleUser = { email?: string; name?: string; picture?: string; verified_email?: boolean };

export const runtime = "nodejs";

function loginRedirect(request: NextRequest, error: string): NextResponse {
  return NextResponse.redirect(new URL(`/login?error=${encodeURIComponent(error)}`, request.url));
}

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const state = request.nextUrl.searchParams.get("state");
  const expectedState = request.cookies.get(OAUTH_STATE_COOKIE)?.value;
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

  if (!code || !state || !expectedState || state !== expectedState) {
    return loginRedirect(request, "oauth_state_invalid");
  }
  if (!clientId || !clientSecret || !process.env.AUTH_SECRET) {
    return loginRedirect(request, "oauth_not_configured");
  }

  const applicationUrl = resolveApplicationUrl(process.env.NEXT_PUBLIC_APP_URL, request.url);
  const redirectUri = `${applicationUrl}/api/auth/google/callback`;

  try {
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }),
    });
    if (!tokenResponse.ok) return loginRedirect(request, "token_exchange_failed");
    const tokens = (await tokenResponse.json()) as TokenResponse;
    if (!tokens.access_token) return loginRedirect(request, "token_exchange_failed");

    const userResponse = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    if (!userResponse.ok) return loginRedirect(request, "userinfo_failed");
    const user = (await userResponse.json()) as GoogleUser;
    if (!user.email || !user.name || user.verified_email === false || !isAllowedEmail(user.email, process.env.ALLOWED_EMAILS)) {
      return loginRedirect(request, "account_not_allowed");
    }

    const response = NextResponse.redirect(new URL("/", request.url));
    response.cookies.set(OAUTH_STATE_COOKIE, "", { maxAge: 0, path: "/" });
    response.cookies.set(SESSION_COOKIE, await signSession({ email: user.email, name: user.name, picture: user.picture }), {
      httpOnly: true,
      sameSite: "lax",
      secure: applicationUrl.startsWith("https://"),
      maxAge: 60 * 60 * 24 * 7,
      path: "/",
    });
    return response;
  } catch (error) {
    console.error("Google OAuth callback failed", error);
    return loginRedirect(request, "oauth_failed");
  }
}
