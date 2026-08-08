import FeedbackForm from "@/components/FeedbackForm";

export const metadata = {
  title: "Report a problem",
};

export default function ReportPage() {
  return (
    <>
      <h1 id="report-heading">Report a problem</h1>
      <p>
        The agent files reports for you during a call, so you should not normally need this page.
        Use it if the call dropped, if the agent could not take the report down, or if you would
        rather write than talk.
      </p>
      <FeedbackForm />
    </>
  );
}
