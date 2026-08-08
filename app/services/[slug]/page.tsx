import { notFound } from "next/navigation";
import { getAllServices, getService } from "@/lib/services";
import { VoiceConsole } from "@/components/voice/VoiceConsole";
import styles from "./page.module.css";

export function generateStaticParams() {
  return getAllServices().map((service) => ({ slug: service.slug }));
}

export default async function ServicePage({ params }: PageProps<"/services/[slug]">) {
  const { slug } = await params;
  const service = getService(slug);
  if (!service) notFound();

  return (
    <div className={styles.wrap}>
      {service.fixture && (
        <p className={styles.fixtureBanner}>
          Placeholder content. These details are hand-written examples, not scraped from the
          government page yet — do not rely on them.
        </p>
      )}

      <h1>{service.name}</h1>
      <p className={styles.summary}>{service.summary}</p>

      <VoiceConsole service={service} />

      <div className={styles.sections}>
        <section aria-labelledby="who-qualifies">
          <h2 id="who-qualifies">Who qualifies</h2>
          <ul>
            {service.whoQualifies.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </section>

        <section aria-labelledby="documents">
          <h2 id="documents">Documents you need</h2>
          <ul>
            {service.documentsRequired.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </section>

        <section aria-labelledby="fees">
          <h2 id="fees">What it costs</h2>
          <dl>
            {service.fees.map((fee) => (
              <div key={fee.item}>
                <dt>{fee.item}</dt>
                <dd>{fee.amount}</dd>
              </div>
            ))}
          </dl>
          <p className={styles.processingTime}>
            <strong>Processing time:</strong> {service.processingTime}
          </p>
        </section>

        <section aria-labelledby="how-to-apply">
          <h2 id="how-to-apply">How to apply</h2>
          <ol>
            {service.howToApply.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
        </section>
      </div>

      <footer className={styles.citationFooter}>
        <p>
          Source: {service.publisher} —{" "}
          <a href={service.sourceUrl} target="_blank" rel="noreferrer">
            {service.sourceUrl}
          </a>
        </p>
        <p>Checked {service.lastScrapedAt}</p>
      </footer>
    </div>
  );
}
