"use client";

import { useEffect, useState } from "react";
import styles from "./RotatingPrompts.module.css";

const ROTATE_MS = 3600;

export function RotatingPrompts({ prompts }: { prompts: string[] }) {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (prompts.length < 2) return;
    const id = setInterval(() => {
      setIndex((prev) => (prev + 1) % prompts.length);
    }, ROTATE_MS);
    return () => clearInterval(id);
  }, [prompts.length]);

  if (prompts.length === 0) return null;

  return (
    <div className={styles.wrap}>
      <p key={index} className={styles.prompt}>
        “{prompts[index]}”
      </p>
    </div>
  );
}
