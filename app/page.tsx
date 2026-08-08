import Link from "next/link";
import { getAllServices } from "@/lib/services";
import styles from "./page.module.css";

export default function Home() {
  const services = getAllServices();

  return (
    <div className={styles.wrap}>
      <h1>What do you need help with?</h1>
      <p className={styles.lede}>
        Pick a service below, then call the voice assistant or type your question — it answers
        from the government page and tells you where the answer came from.
      </p>

      <ul className={styles.grid}>
        {services.map((service) => (
          <li key={service.slug}>
            <Link href={`/services/${service.slug}`} className={styles.card}>
              <span className={styles.cardName}>{service.name}</span>
              <span className={styles.cardSummary}>{service.summary}</span>
              <span className={styles.cardCta} aria-hidden="true">
                Open service →
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
