import type { Citation } from "@/lib/voice/types";
import styles from "./SourceCard.module.css";

export function SourceCard({ citation }: { citation: Citation }) {
  return (
    <aside className={styles.card} aria-label="Source for this answer">
      <p className={styles.eyebrow}>Source</p>
      <p className={styles.publisher}>
        {citation.publisher} — {citation.section}
      </p>
      <p className={styles.meta}>
        <a href={citation.url} target="_blank" rel="noreferrer">
          {citation.url}
        </a>
      </p>
      <p className={styles.meta}>Checked {citation.checkedOn}</p>
    </aside>
  );
}
