"use client";

import Link from "next/link";
import { createContext, useContext } from "react";

export type AuthState = {
  /** Google OAuth is configured, so a Sign in link makes sense. */
  signInAvailable: boolean;
  /** Sign-in is enforced (AUTH_REQUIRED); false means the POS is open but sign-in is still offered. */
  signInRequired: boolean;
  user: { email: string; name: string; picture?: string } | null;
};

const AuthContext = createContext<AuthState>({ signInAvailable: false, signInRequired: true, user: null });

export function AuthProvider({ value, children }: { value: AuthState; children: React.ReactNode }) {
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  return useContext(AuthContext);
}

/** Shows who is signed in with a Sign out button, or a Sign in link when sign-in is optional. */
export function AccountMenu() {
  const { signInAvailable, user } = useAuth();
  if (user) {
    return (
      <form method="post" action="/api/auth/logout" className="account-menu">
        <span className="account-name" title={user.email}>{user.name}</span>
        <button className="secondary-button" type="submit">Sign out</button>
      </form>
    );
  }
  if (!signInAvailable) return null;
  return <Link className="secondary-button" href="/login">Sign in</Link>;
}
