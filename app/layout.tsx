import type { Metadata } from "next";
import Link from "next/link";
import { Atkinson_Hyperlegible, JetBrains_Mono } from "next/font/google";
import { DisplayPreferencesProvider } from "@/components/DisplayPreferences";
import { DisplayControls } from "@/components/DisplayControls";
import "./globals.css";
import styles from "./layout.module.css";

const atkinson = Atkinson_Hyperlegible({
  variable: "--font-atkinson",
  subsets: ["latin"],
  weight: ["400", "700"],
});

const mono = JetBrains_Mono({
  variable: "--font-mono-data",
  subsets: ["latin"],
  weight: ["400", "600"],
});

export const metadata: Metadata = {
  title: "Ask — voice access to UAE government services",
  description:
    "Call a voice assistant from a service page and ask your question in plain language. Not an official government service — a mockup UI.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${atkinson.variable} ${mono.variable}`}>
      <body>
        <DisplayPreferencesProvider>
          <a href="#main-content" className="skip-link">
            Skip to main content
          </a>

          <header className={styles.header}>
            <Link href="/" className={styles.brand}>
              <span className={styles.brandMark} aria-hidden="true">
                ●
              </span>
              Ask
            </Link>
            <DisplayControls />
          </header>

          <main id="main-content" className={styles.main}>
            {children}
          </main>

          <footer className={styles.footer}>
            <p className={styles.disclaimer}>
              <strong>Not an official government service.</strong> This is an independent
              project built on publicly available information. For official business, use
              your government&apos;s own channels.
            </p>
            <p className={styles.helplineFooter}>Helpline: 800-555-0142 (placeholder)</p>
          </footer>
        </DisplayPreferencesProvider>
      </body>
    </html>
  );
}
