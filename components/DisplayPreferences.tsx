"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

export type TextScale = 1 | 1.2 | 1.45;

type DisplayPreferencesValue = {
  textScale: TextScale;
  setTextScale: (scale: TextScale) => void;
  highContrast: boolean;
  setHighContrast: (value: boolean) => void;
};

const STORAGE_KEY = "display-preferences";
const VALID_SCALES: TextScale[] = [1, 1.2, 1.45];

const DisplayPreferencesContext = createContext<DisplayPreferencesValue | null>(null);

export function DisplayPreferencesProvider({ children }: { children: ReactNode }) {
  const [textScale, setTextScale] = useState<TextScale>(1);
  const [highContrast, setHighContrast] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as { textScale?: number; highContrast?: boolean };
        if (parsed.textScale && VALID_SCALES.includes(parsed.textScale as TextScale)) {
          setTextScale(parsed.textScale as TextScale);
        }
        if (typeof parsed.highContrast === "boolean") {
          setHighContrast(parsed.highContrast);
        }
      }
    } catch {
      // Corrupt or blocked storage — fall back to defaults silently.
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    document.documentElement.style.setProperty("--text-scale", String(textScale));
    document.documentElement.setAttribute("data-contrast", highContrast ? "high" : "normal");
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ textScale, highContrast }));
    } catch {
      // Ignore write failures (e.g. private browsing quota).
    }
  }, [textScale, highContrast, hydrated]);

  return (
    <DisplayPreferencesContext.Provider
      value={{ textScale, setTextScale, highContrast, setHighContrast }}
    >
      {children}
    </DisplayPreferencesContext.Provider>
  );
}

export function useDisplayPreferences() {
  const ctx = useContext(DisplayPreferencesContext);
  if (!ctx) {
    throw new Error("useDisplayPreferences must be used within DisplayPreferencesProvider");
  }
  return ctx;
}
