"use client";

import { useEffect, useState } from "react";
import styles from "./AmplitudeRing.module.css";

export function AmplitudeRing({ volume, active }: { volume: number; active: boolean }) {
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReducedMotion(query.matches);
    const handleChange = () => setReducedMotion(query.matches);
    query.addEventListener("change", handleChange);
    return () => query.removeEventListener("change", handleChange);
  }, []);

  const live = active && !reducedMotion;
  const innerScale = live ? 1 + volume * 0.3 : 1;
  const innerOpacity = live ? 0.4 + volume * 0.5 : 0.35;
  const outerScale = live ? 1 + volume * 0.5 : 1;
  const outerOpacity = live ? 0.15 + volume * 0.35 : 0.2;

  return (
    <div className={styles.wrap} aria-hidden="true">
      <span
        className={styles.ringOuter}
        style={{ transform: `scale(${outerScale})`, opacity: outerOpacity }}
      />
      <span
        className={styles.ring}
        style={{ transform: `scale(${innerScale})`, opacity: innerOpacity }}
      />
    </div>
  );
}
