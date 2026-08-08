import Link from "next/link";
import { notFound } from "next/navigation";
import { getAllServices, getService } from "@/lib/services";
import { VoiceConsole } from "@/components/voice/VoiceConsole";
import styles from "./page.module.css";

export default function Home() {
  const assistant = getService("general-assistant");
  if (!assistant) notFound();

  const otherServices = getAllServices().filter((s) => s.slug !== "general-assistant");

  return (
    <div className={styles.wrap}>
      <p className={styles.eyebrow}>Alhamadi</p>
      <h1 className={styles.title}>Ask about any government service</h1>

      <VoiceConsole service={assistant} />

      {otherServices.length > 0 && (
        <div className={styles.browse}>
          <p className={styles.browseLabel}>Or browse a service page:</p>
          <div className={styles.browseLinks}>
            {otherServices.map((service) => (
              <Link key={service.slug} href={`/services/${service.slug}`} className={styles.browseLink}>
                {service.name}
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
