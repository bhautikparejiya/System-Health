"use client";

import { useEffect, useMemo, useState } from "react";
import { AgencyView } from "./AgencyView";
import { Dashboard } from "./Dashboard";

interface SsoResult {
  token: string;
  context: { type: "agency" | "location"; locationId: string | null; companyId: string; userName?: string; installed: boolean };
}

/** Asks the HighLevel parent window for the encrypted user context (Custom Page handshake). */
function requestUserData(timeoutMs = 8000): Promise<string> {
  return new Promise((resolve, reject) => {
    if (window.parent === window) return reject(new Error("not-in-iframe"));
    const timer = setTimeout(() => {
      window.removeEventListener("message", onMessage);
      reject(new Error("timeout"));
    }, timeoutMs);
    function onMessage({ data }: MessageEvent) {
      if (data?.message === "REQUEST_USER_DATA_RESPONSE") {
        clearTimeout(timer);
        window.removeEventListener("message", onMessage);
        resolve(data.payload);
      }
    }
    window.addEventListener("message", onMessage);
    window.parent.postMessage({ message: "REQUEST_USER_DATA" }, "*");
  });
}

export function AppShell() {
  const [sso, setSso] = useState<SsoResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const params = new URLSearchParams(window.location.search);
      let body: unknown;
      if (params.get("demo") === "1") body = { demo: true };
      else {
        try {
          body = { encryptedData: await requestUserData() };
        } catch (e) {
          setError((e as Error).message === "not-in-iframe" ? "not-in-iframe" : "handshake");
          return;
        }
      }
      const res = await fetch(`/api/auth/sso${params.get("agency") === "1" ? "?agency=1" : ""}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({ error: `Sign-in failed (${res.status})` }));
      if (!res.ok) setError(data.error ?? "Sign-in failed");
      else setSso(data);
    })();
  }, []);

  const auth = useMemo(() => ({ token: sso?.token }), [sso]);

  if (error === "not-in-iframe")
    return (
      <div className="center">
        <div>
          <h3>Open this app from inside HighLevel</h3>
          <p className="muted">It appears in the left menu of your sub-account after you install it from the Marketplace.</p>
        </div>
      </div>
    );
  if (error)
    return (
      <div className="center">
        <div>
          <h3>Couldn&apos;t verify your HighLevel session</h3>
          <p className="muted">{error === "handshake" ? "HighLevel didn't send your user details. Reload the page." : error}</p>
        </div>
      </div>
    );
  if (!sso) return <div className="center muted">Connecting to HighLevel…</div>;
  if (!sso.context.installed)
    return (
      <div className="center">
        <div>
          <h3>The app isn&apos;t installed for this account yet</h3>
          <p className="muted">Install System Health Monitor from the HighLevel App Marketplace, then reopen this page.</p>
        </div>
      </div>
    );
  if (sso.context.locationId) return <Dashboard locationId={sso.context.locationId} auth={auth} />;
  return <AgencyView auth={auth} />;
}
