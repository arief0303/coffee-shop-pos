import { NextRequest, NextResponse } from "next/server";
import { createOAuthState, OAUTH_STATE_COOKIE, resolveApplicationUrl } from "@/lib/auth-config";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) {
    return NextResponse.redirect(new URL("/login?error=oauth_not_configured", request.url));
  }

  const applicationUrl = resolveApplicationUrl(process.env.NEXT_PUBLIC_APP_URL, request.url);
  const state = createOAuthState();
  const redirectUri = `${applicationUrl}/api/auth/google/callback`;
  const authorizationUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  authorizationUrl.search = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "openid email profile",
    state,
    prompt: "select_account",
  }).toString();

  const response = NextResponse.redirect(authorizationUrl);
  response.cookies.set(OAUTH_STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: "lax",
    secure: applicationUrl.startsWith("https://"),
    maxAge: 600,
    path: "/",
  });
  return response;
}
