import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Voice access to UAE government services",
  description:
    "Ask a plain-language question about a UAE government service and get an answer read aloud, with the source it came from.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <a className="skip-link" href="#main">
          Skip to main content
        </a>
        <header className="site-header">
          <nav aria-label="Main">
            <Link href="/">Services</Link>
            <Link href="/triage">Flagged calls</Link>
          </nav>
        </header>
        <main id="main">{children}</main>
      </body>
    </html>
  );
}
