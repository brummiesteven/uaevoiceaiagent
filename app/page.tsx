import Link from "next/link";
import { getServices } from "@/content";

export default function HomePage() {
  const services = getServices();
  return (
    <>
      <h1>Ask about a UAE government service</h1>
      <p>
        Pick a service and press the call button on its page. Ask your question the way you would
        ask a person. The agent answers from the government page it was given, tells you where the
        answer came from, and passes you to the helpline when it does not know.
      </p>
      <p className="muted">
        Not an official government service. Built on publicly accessible pages.
      </p>

      <h2 id="services-heading">Services</h2>
      <ul aria-labelledby="services-heading" style={{ listStyle: "none", padding: 0 }}>
        {services.map((service) => (
          <li key={service.slug} className="card">
            <h3>
              <Link href={`/services/${service.slug}`}>{service.name}</Link>
            </h3>
            <p className="muted" style={{ margin: "0 0 0.5rem" }}>
              {service.authority}
            </p>
            <p style={{ margin: 0 }}>{service.summary}</p>
          </li>
        ))}
      </ul>
    </>
  );
}
