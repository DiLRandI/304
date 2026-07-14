import type { Metadata } from "next";
import Link from "next/link";
import { AccessibilityPreferences } from "../components/accessibility-preferences";
import { ConsentBanner } from "../features/consent/ui/consent-banner";
import "./globals.css";

export const metadata: Metadata = {
  title: "304 Online",
  description: "A private, server-authoritative Sri Lankan 304 card game.",
  robots: {
    index: false,
    follow: false,
  },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en-LK">
      <body>
        <div className="app-frame">
          <header className="site-header">
            <Link aria-label="304 Online home" className="site-brand" href="/">
              <span aria-hidden="true" className="brand-mark">
                304
              </span>
              <span>304 Online</span>
            </Link>
            <nav aria-label="Primary navigation" className="site-nav">
              <Link href="/play">Play</Link>
              <Link href="/rules">Rules</Link>
              <Link href="/privacy">Privacy</Link>
              <Link href="/terms">Terms</Link>
            </nav>
          </header>
          {children}
          <footer className="site-footer">
            <p>Private casual 304 · no money, prizes, or wagering.</p>
            <nav aria-label="Legal information" className="footer-nav">
              <Link href="/privacy">Privacy</Link>
              <Link href="/terms">Terms</Link>
            </nav>
            <AccessibilityPreferences />
          </footer>
        </div>
        <ConsentBanner />
      </body>
    </html>
  );
}
