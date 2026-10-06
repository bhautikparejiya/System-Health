// TEMPLATE: review with your own details (company name, contact email, jurisdiction) before publishing.
export default function Privacy() {
  return (
    <div className="page" style={{ maxWidth: 760 }}>
      <h1>Privacy Policy</h1>
      <p className="muted small">Last updated: [DATE]</p>
      <p>[YOUR COMPANY] (“we”) provides System Health Monitor, an app for the HighLevel platform. This policy explains what data the app processes.</p>
      <h3>Data we access</h3>
      <p>
        With your permission (OAuth scopes granted at install) the app reads workflow names and status, Conversation AI and Voice AI agent
        settings and call counts, calendar availability, form submission dates, conversation timestamps, opportunity stage dates and event
        notifications (new contacts, message delivery status, appointments). The app only requests read access.
      </p>
      <h3>Data we store</h3>
      <p>
        We store OAuth tokens, your settings, aggregated daily counts and the latest health results. We do not store message contents,
        contact names, emails or phone numbers.
      </p>
      <h3>Retention and deletion</h3>
      <p>When you uninstall the app, all data for that account is deleted automatically. You can also request deletion at [EMAIL].</p>
      <h3>Sub-processors</h3>
      <p>Hosting: Vercel Inc. Database: Neon Inc. (or your chosen Postgres provider).</p>
      <h3>Contact</h3>
      <p>[EMAIL]</p>
    </div>
  );
}
