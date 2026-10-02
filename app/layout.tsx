import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Bean Counter POS",
  description: "Offline-first coffee shop point of sale",
  manifest: "/manifest.webmanifest",
};

export const viewport: Viewport = {
  themeColor: "#f8f4ed",
  viewportFit: "cover",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}<script dangerouslySetInnerHTML={{ __html: `if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js'));` }} /></body></html>;
}
