import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Support loop — UAE voice agent",
  description:
    "Where a caller's report goes after the voice agent files it: a ticket, a coding agent, and an escalation to a human engineer when that is not enough.",
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
            <Link href="/">How it works</Link>
            <Link href="/triage">Reports</Link>
            <Link href="/report">Report a problem</Link>
          </nav>
        </header>
        <main id="main">{children}</main>
      </body>
    </html>
  );
}
