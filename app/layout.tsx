import type { Metadata, Viewport } from "next";
import "./globals.css";
import { AuthProvider } from "@/components/auth-context";
import { isAuthRequired } from "@/lib/auth-config";
import { getSession } from "@/lib/session";

export const metadata: Metadata = {
  title: "Prep. POS",
  description: "Offline-first coffee shop point of sale",
  manifest: "/manifest.webmanifest",
};

export const viewport: Viewport = {
  themeColor: "#f8f4ed",
  viewportFit: "cover",
  // Counter tablets: stop accidental pinch/double-tap zoom while tapping fast.
  maximumScale: 1,
  userScalable: false,
};

export const dynamic = "force-dynamic";

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const auth = {
    signInAvailable: Boolean(process.env.GOOGLE_CLIENT_ID),
    signInRequired: isAuthRequired(process.env.AUTH_REQUIRED),
    user: await getSession(),
  };
  return <html lang="en"><body><AuthProvider value={auth}>{children}</AuthProvider><script dangerouslySetInnerHTML={{ __html: `if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js'));` }} /></body></html>;
}
