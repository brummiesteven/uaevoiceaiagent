import styles from "./Orb.module.css";

export function Orb({ active }: { active: boolean }) {
  return <div className={styles.orb} data-active={active} aria-hidden="true" />;
}
