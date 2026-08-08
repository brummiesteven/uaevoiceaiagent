import { getTriageRows } from "@/lib/triage";
import styles from "./page.module.css";

export const metadata = {
  title: "Triage — internal",
};

export default async function TriagePage() {
  const { rows, source } = await getTriageRows();
  const passCount = rows.filter((row) => row.passed).length;

  return (
    <div className={styles.wrap}>
      <p className={styles.internalTag}>Internal — unlinked, unauthenticated</p>
      <h1>Adversarial run — triage</h1>
      <p className={styles.summary}>
        {passCount} of {rows.length} personas passed.{" "}
        {source === "example"
          ? "Showing example rows — no Supabase connection configured."
          : "Live rows from Supabase."}
      </p>

      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th scope="col">Persona</th>
              <th scope="col">Result</th>
              <th scope="col">Calls</th>
              <th scope="col">Transcript</th>
              <th scope="col">Linear issue</th>
              <th scope="col">Devin PR</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <th scope="row" className={styles.personaCell}>
                  <span className={styles.personaName}>{row.persona}</span>
                  <span className={styles.personaScenario}>{row.scenario}</span>
                </th>
                <td>
                  <span
                    className={styles.statusChip}
                    data-status={row.passed ? "pass" : "fail"}
                  >
                    {row.passed ? "Pass" : "Fail"}
                  </span>
                </td>
                <td className={styles.numeric}>{row.callCount}</td>
                <td className={styles.transcriptCell}>{row.transcriptExcerpt}</td>
                <td>
                  {row.linearIssueUrl ? (
                    <a href={row.linearIssueUrl} target="_blank" rel="noreferrer">
                      View issue
                    </a>
                  ) : (
                    <span className={styles.muted}>—</span>
                  )}
                </td>
                <td>
                  {row.devinPrUrl ? (
                    <a href={row.devinPrUrl} target="_blank" rel="noreferrer">
                      View PR
                    </a>
                  ) : (
                    <span className={styles.muted}>—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
