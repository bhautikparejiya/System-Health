export default async function Installed({ searchParams }: { searchParams: Promise<{ count?: string; error?: string }> }) {
  const { count, error } = await searchParams;
  return (
    <div className="center">
      <div className="card" style={{ maxWidth: 520 }}>
        {error ? (
          <>
            <h2>Installation didn&apos;t finish</h2>
            <p className="muted">Something went wrong while connecting to HighLevel. Please try installing again from the Marketplace.</p>
          </>
        ) : (
          <>
            <h2>✅ System Health Monitor is installed</h2>
            <p className="muted">
              {Number(count) > 1 ? `Connected ${count} sub-accounts. ` : ""}Open <b>System Health</b> from the left menu of your
              sub-account. The first scan runs automatically.
            </p>
            <p className="muted small">Next step: add the “Health Check-in” action as the first step of the workflows you want watched.</p>
          </>
        )}
      </div>
    </div>
  );
}
