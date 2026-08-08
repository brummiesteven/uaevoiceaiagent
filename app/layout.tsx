import type { Metadata } from "next";
import Link from "next/link";
import { Atkinson_Hyperlegible, JetBrains_Mono } from "next/font/google";
import { DisplayPreferencesProvider } from "@/components/DisplayPreferences";
import { DisplayControls } from "@/components/DisplayControls";
import { VoiceProvider } from "@/components/VoiceProvider";
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
  title: "Alhamadi — voice access to UAE government services",
  description:
    "Press and hold to ask a voice assistant about any UAE government service. Not an official government service — a mockup UI.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${atkinson.variable} ${mono.variable}`}>
      <body>
        <DisplayPreferencesProvider>
          <VoiceProvider>
            <a href="#main-content" className="skip-link">
              Skip to main content
            </a>

            <header className={styles.header}>
              <Link href="/" className={styles.brand}>
                Alhamadi
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
          </VoiceProvider>
        </DisplayPreferencesProvider>
      </body>
    </html>
  );
}
