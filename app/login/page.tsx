import Link from "next/link";

type LoginPageProps = { searchParams: Promise<{ error?: string }> };

const messages: Record<string, string> = {
  oauth_not_configured: "Google sign-in has not been configured yet.",
  oauth_state_invalid: "Your sign-in request expired. Please try again.",
  token_exchange_failed: "Google could not complete the sign-in request.",
  userinfo_failed: "Google account details could not be verified.",
  account_not_allowed: "This Google account is not allowed to access the POS.",
  oauth_failed: "Google sign-in could not be completed. Please try again.",
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const { error } = await searchParams;
  return (
    <main className="login-page">
      <section className="login-card">
        <span className="brand-mark">☕</span>
        <p className="eyebrow">Bean Counter</p>
        <h1>Coffee shop POS</h1>
        <p>Sign in with your authorised Google account to operate the counter and sync sales.</p>
        {error && <p className="login-error">{messages[error] ?? "Sign-in failed. Please try again."}</p>}
        <Link className="google-button" href="/api/auth/google"><span>G</span> Continue with Google</Link>
        <small>Only approved accounts can access the POS.</small>
      </section>
    </main>
  );
}
