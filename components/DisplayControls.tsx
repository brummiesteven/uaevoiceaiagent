"use client";

import { useDisplayPreferences, type TextScale } from "./DisplayPreferences";
import styles from "./DisplayControls.module.css";

const SIZE_OPTIONS: { scale: TextScale; label: string; description: string }[] = [
  { scale: 1, label: "A", description: "Standard text size" },
  { scale: 1.2, label: "A+", description: "Larger text size" },
  { scale: 1.45, label: "A++", description: "Largest text size" },
];

export function DisplayControls() {
  const { textScale, setTextScale, highContrast, setHighContrast } = useDisplayPreferences();

  return (
    <div className={styles.wrap}>
      <div className={styles.group} role="group" aria-label="Text size">
        {SIZE_OPTIONS.map((option) => (
          <button
            key={option.scale}
            type="button"
            className={styles.sizeButton}
            aria-pressed={textScale === option.scale}
            aria-label={option.description}
            onClick={() => setTextScale(option.scale)}
          >
            {option.label}
          </button>
        ))}
      </div>

      <button
        type="button"
        className={styles.contrastButton}
        aria-pressed={highContrast}
        onClick={() => setHighContrast(!highContrast)}
      >
        <span className={styles.swatch} aria-hidden="true" />
        High contrast
      </button>
    </div>
  );
}
