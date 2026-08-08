import styles from "./Orb.module.css";

type OrbProps = {
  active: boolean;
  busy: boolean;
  label: string;
  onToggle: () => void;
  disabled?: boolean;
};

function WaveformIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M3 12h2l2-7 3 14 3-18 3 14 2-7h3"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function Orb({ active, busy, label, onToggle, disabled }: OrbProps) {
  return (
    <div>
      <div className={styles.orbWrap}>
        <div className={styles.orb} data-active={active} aria-hidden="true" />
        <button
          type="button"
          className={styles.pill}
          data-active={active || busy}
          onClick={onToggle}
          disabled={disabled}
          aria-pressed={active}
        >
          <span className={styles.pillIcon}>
            <WaveformIcon />
          </span>
          {label}
        </button>
      </div>
      <p className={styles.poweredBy}>
        Powered by <a href="https://elevenlabs.io" target="_blank" rel="noreferrer">ElevenLabs</a>
      </p>
    </div>
  );
}
