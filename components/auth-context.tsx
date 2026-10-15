"use client";

import { createContext, useContext } from "react";

const SignOutContext = createContext(false);

/** Tells the UI whether Google sign-in is active, so it only offers Sign out when there is a session. */
export function AuthProvider({ signInEnabled, children }: { signInEnabled: boolean; children: React.ReactNode }) {
  return <SignOutContext.Provider value={signInEnabled}>{children}</SignOutContext.Provider>;
}

export function SignOutButton() {
  const enabled = useContext(SignOutContext);
  if (!enabled) return null;
  return (
    <form method="post" action="/api/auth/logout">
      <button className="secondary-button" type="submit">Sign out</button>
    </form>
  );
}
