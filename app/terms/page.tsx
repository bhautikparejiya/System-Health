// TEMPLATE: review with your own details (and ideally a lawyer) before publishing.
export default function Terms() {
  return (
    <div className="page" style={{ maxWidth: 760 }}>
      <h1>Terms of Service</h1>
      <p className="muted small">Last updated: [DATE]</p>
      <p>By installing System Health Monitor (“the app”) from the HighLevel App Marketplace you agree to these terms.</p>
      <h3>Service</h3>
      <p>
        The app monitors your HighLevel account and reports potential issues. It is a monitoring aid: it does not guarantee that every
        problem is detected, and it never changes your workflows or data.
      </p>
      <h3>Billing</h3>
      <p>Paid plans are billed through the HighLevel Marketplace. Cancel any time by uninstalling the app.</p>
      <h3>Support</h3>
      <p>Email [EMAIL]. We reply within 24 hours on business days.</p>
      <h3>Liability</h3>
      <p>The app is provided “as is”. To the extent permitted by law, our liability is limited to the fees paid in the last 3 months.</p>
    </div>
  );
}
