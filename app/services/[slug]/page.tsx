import type { Metadata } from "next";
import { notFound } from "next/navigation";
import CallPanel from "@/components/CallPanel";
import { getService, getServices } from "@/content";
import { optionalEnv } from "@/lib/env";

export function generateStaticParams() {
  return getServices().map((service) => ({ slug: service.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const service = getService((await params).slug);
  if (!service) return { title: "Service not found" };
  return { title: `${service.name} — ${service.authority}`, description: service.summary };
}

export default async function ServicePage({ params }: { params: Promise<{ slug: string }> }) {
  const service = getService((await params).slug);
  if (!service) notFound();

  const required = service.requiredDocuments.filter((d) => d.required);
  const conditional = service.requiredDocuments.filter((d) => !d.required);

  return (
    <>
      <h1>{service.name}</h1>
      <p className="muted">{service.authority}</p>
      <p>{service.summary}</p>

      {!service.source.humanVerified && (
        <p className="notice">
          This page was extracted automatically from{" "}
          <a href={service.source.url}>the government page</a> and has not been checked by a person.
          Confirm anything that affects an application
          {service.helpline ? ` — the helpline is ${service.helpline}` : ""}.
        </p>
      )}

      <CallPanel
        agentId={optionalEnv("NEXT_PUBLIC_ELEVENLABS_AGENT_ID") ?? null}
        serviceSlug={service.slug}
        serviceName={service.name}
        helpline={service.helpline ?? null}
      />

      <h2>What it is</h2>
      <p>{service.description}</p>

      {service.eligibility.length > 0 && (
        <>
          <h2>Who can apply</h2>
          <dl className="facts">
            {service.eligibility.map((criterion) => (
              <div key={criterion.id} style={{ display: "contents" }}>
                <dt>{criterion.question}</dt>
                <dd>{criterion.requirement}</dd>
              </div>
            ))}
          </dl>
        </>
      )}

      {required.length > 0 && (
        <>
          <h2>Documents you need</h2>
          <ul className="checklist">
            {required.map((doc) => (
              <li key={doc.name}>
                {doc.name}
                {doc.notes ? ` — ${doc.notes}` : ""}
              </li>
            ))}
          </ul>
          {conditional.length > 0 && (
            <>
              <h3>Only in some cases</h3>
              <ul className="checklist">
                {conditional.map((doc) => (
                  <li key={doc.name}>
                    {doc.name}
                    {doc.notes ? ` — ${doc.notes}` : ""}
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}

      <h2>Cost and time</h2>
      <dl className="facts">
        {service.fees.map((fee) => (
          <div key={fee.label} style={{ display: "contents" }}>
            <dt>{fee.label}</dt>
            <dd>
              {fee.amountAed === null
                ? "Not published"
                : fee.amountAed === 0
                  ? "Free"
                  : `AED ${fee.amountAed}`}
              {fee.notes ? ` — ${fee.notes}` : ""}
            </dd>
          </div>
        ))}
        <dt>Processing time</dt>
        <dd>{service.processingTime ?? "Not published"}</dd>
        {service.helpline && (
          <>
            <dt>Helpline</dt>
            <dd>{service.helpline}</dd>
          </>
        )}
        <dt>Languages</dt>
        <dd>{service.languages.join(", ")}</dd>
      </dl>

      {service.channels.length > 0 && (
        <>
          <h2>How to apply</h2>
          <ul className="checklist">
            {service.channels.map((channel) => (
              <li key={channel}>{channel}</li>
            ))}
          </ul>
        </>
      )}

      <h2>Source</h2>
      <p>
        <a href={service.source.url}>{service.source.url}</a>
        <br />
        <span className="muted">
          Extracted {new Date(service.source.scrapedAt).toLocaleDateString("en-GB")}.
        </span>
      </p>
    </>
  );
}
