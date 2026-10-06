import Link from "next/link";

export default function Home() {
  return (
    <div className="page" style={{ maxWidth: 760 }}>
      <span className="pill t-info">HighLevel Marketplace app</span>
      <h1 style={{ fontSize: 32, margin: "12px 0 8px" }}>System Health Monitor</h1>
      <p className="muted" style={{ fontSize: 16 }}>
        One health score for every sub-account. Catch idle or unpublished workflows, AI agents that are switched off, calendars with
        no open slots, quiet forms, unanswered conversations, stale deals and message failures before your clients notice.
      </p>
      <div className="card" style={{ marginTop: 20 }}>
        <h3>How it works</h3>
        <ol>
          <li>Install the app from the HighLevel App Marketplace.</li>
          <li>Open <b>System Health</b> from the sub-account menu.</li>
          <li>Add the <b>Health Check-in</b> action to key workflows to get alerts when no contact enters them.</li>
          <li>Optionally, use the <b>Health issue detected</b> trigger to text or email yourself when something breaks.</li>
        </ol>
      </div>
      <p className="small muted" style={{ marginTop: 20 }}>
        <Link href="/privacy">Privacy policy</Link> · <Link href="/terms">Terms of service</Link>
      </p>
    </div>
  );
}
